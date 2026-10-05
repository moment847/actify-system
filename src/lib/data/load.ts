import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/server';
import { localToday } from '@/lib/domain/dates';
import type { World } from '@/lib/domain/types';
import { rowsToWorld, type Rows } from './map';

export type Role = 'student' | 'coach' | 'admin';
export interface Actor {
  id: string;
  schoolId: string;
  schoolName: string;
  role: Role;
  name: string;
  timeZone: string;
  /** その人の「今日」（本人のタイムゾーン） */
  today: string;
}

/** ログインしている人。ログインしていない・休会中・退会・プロフィールが無いときは null（休会中は請求に数えないので使えない。DB の my_role も同じ） */
export async function loadActor(supabase?: SupabaseClient): Promise<Actor | null> {
  const sb = supabase ?? (await createClient());
  const { data: claims } = await sb.auth.getClaims();
  const uid = claims?.claims?.sub as string | undefined;
  if (!uid) return null;
  const { data: p } = await sb.from('profiles')
    .select('id, school_id, role, display_name, status, timezone, schools(name, timezone)')
    .eq('id', uid).maybeSingle();
  if (!p || p.status !== 'active') return null;
  const school = (Array.isArray(p.schools) ? p.schools[0] : p.schools) as { name: string; timezone: string } | null;
  const timeZone = p.timezone || school?.timezone || 'Asia/Tokyo';
  return { id: p.id, schoolId: p.school_id, schoolName: school?.name ?? '', role: p.role as Role, name: p.display_name, timeZone, today: localToday(timeZone) };
}

const PAGE = 1000; // PostgREST の max_rows に合わせる
/** 1,000 行ずつ全部読む */
async function all<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await make(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) return out;
  }
}

/**
 * 生徒たちの計算に要るものを読む（RLS が効くので、見えない行は入らない）。
 * - 生徒本人：自分の分だけ。小テストの版は見えない（予定に付いた版の満点は予定の行にある）。面談は主担当の講師の埋まっている時間も読む
 * - 教材は塾で絞る（service_role で読む定期処理でも、ほかの塾の教材を読まない）
 * - 講師・運営：渡した生徒の分。小テストの版と、面談の枠・予約も読む
 */
export async function loadWorld(sb: SupabaseClient, actor: Actor, studentIds: string[]): Promise<World> {
  if (!studentIds.length) return rowsToWorld(emptyRows(), actor.today, actor.timeZone);
  const staff = actor.role !== 'student';
  const [materials, units, quizVersions, tasks, slots, books, reviewSkips] = await Promise.all([
    all<Rows['materials'][number]>((a, b) => sb.from('materials').select('id, name, short_name, subject, kind, review_intervals, keywords, archived_at').eq('school_id', actor.schoolId).order('created_at').range(a, b)),
    all<Rows['units'][number]>((a, b) => sb.from('material_units').select('id, material_id, seq, label').eq('school_id', actor.schoolId).order('material_id').order('seq').range(a, b)),
    staff ? all<Rows['quizVersions'][number]>((a, b) => sb.from('quiz_versions').select('id, unit_id, version, max_score').eq('school_id', actor.schoolId).order('unit_id').order('version').range(a, b)) : Promise.resolve([]),
    all<Rows['tasks'][number]>((a, b) => sb.from('tasks')
      .select('id, student_id, on_date, start_time, duration_min, material_id, unit_id, vague, title, status, quiz_version_id, max_score, no_quiz, is_retest, score, actual_min, started_at, paused_at, paused_ms, created_at')
      .in('student_id', studentIds).order('on_date').order('start_time').order('id').range(a, b)),
    all<Rows['slots'][number]>((a, b) => sb.from('study_slots').select('id, student_id, on_date, weekday, start_time, end_time, label').in('student_id', studentIds).order('id').range(a, b)),
    all<Rows['books'][number]>((a, b) => sb.from('student_books').select('student_id, material_id, start_on, target_on').in('student_id', studentIds).range(a, b)),
    all<Rows['reviewSkips'][number]>((a, b) => sb.from('review_skips').select('student_id, unit_id, attempt').in('student_id', studentIds).range(a, b)),
  ]);
  const taskIds = tasks.map(t => t.id);
  const chunks = <T,>(xs: T[], n = 300) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));
  const [feedback, replies, slotSkips] = await Promise.all([
    Promise.all(chunks(taskIds).map(c => all<Rows['feedback'][number]>((a, b) => sb.from('task_feedback').select('task_id, tag, body, created_at').in('task_id', c).range(a, b)))).then(x => x.flat()),
    Promise.all(chunks(taskIds).map(c => all<Rows['replies'][number]>((a, b) => sb.from('task_replies').select('task_id, body, created_at').in('task_id', c).range(a, b)))).then(x => x.flat()),
    Promise.all(chunks(slots.map(s => s.id)).map(c => all<Rows['slotSkips'][number]>((a, b) => sb.from('study_slot_skips').select('slot_id, on_date').in('slot_id', c).range(a, b)))).then(x => x.flat()),
  ]);

  // 面談：講師なら自分の予約・枠。生徒なら主担当の講師の枠と、埋まっている時間（ほかの生徒の名前は出ない）
  let meetings: Rows['meetings'] = [], coachOpen: Rows['coachOpen'] = [], meetingLength = 30;
  const coachId = actor.role === 'coach' ? actor.id
    : (await sb.from('coach_assignments').select('coach_id').eq('student_id', studentIds[0]).order('is_main', { ascending: false }).order('created_at').limit(1)).data?.[0]?.coach_id;
  if (coachId) {
    const [open, setting] = await Promise.all([
      all<Rows['coachOpen'][number]>((a, b) => sb.from('coach_open_slots').select('id, on_date, weekday, start_time, end_time').eq('coach_id', coachId).range(a, b)),
      sb.from('booking_settings').select('length_min').eq('coach_id', coachId).maybeSingle(),
    ]);
    coachOpen = open; meetingLength = setting.data?.length_min ?? 30;
    if (staff) {
      meetings = await all<Rows['meetings'][number]>((a, b) => sb.from('meetings').select('id, student_id, coach_id, on_date, start_time, length_min').eq('coach_id', coachId).range(a, b));
    } else {
      const own = await all<Rows['meetings'][number]>((a, b) => sb.from('meetings').select('id, student_id, coach_id, on_date, start_time, length_min').eq('student_id', actor.id).range(a, b));
      const from = new Date(Date.parse(actor.today + 'T12:00:00Z') - 14 * 864e5).toISOString().slice(0, 10);
      const to = new Date(Date.parse(actor.today + 'T12:00:00Z') + 42 * 864e5).toISOString().slice(0, 10);
      const { data: busy } = await sb.rpc('meeting_busy', { p_coach: coachId, p_from: from, p_to: to });
      const others = ((busy ?? []) as { on_date: string; start_time: string; length_min: number; mine: boolean }[])
        .filter(b => !b.mine).map((b, i) => ({ id: `busy-${i}`, student_id: 'other', coach_id: coachId, on_date: b.on_date, start_time: b.start_time, length_min: b.length_min }));
      meetings = [...own, ...others];
    }
  }
  return rowsToWorld({ materials, units, quizVersions, tasks, feedback, replies, slots, slotSkips, books, meetings, coachOpen, reviewSkips, meetingLength }, actor.today, actor.timeZone);
}

export function emptyRows(): Rows {
  return { materials: [], units: [], quizVersions: [], tasks: [], feedback: [], replies: [], slots: [], slotSkips: [], books: [], meetings: [], coachOpen: [], reviewSkips: [], meetingLength: 30 };
}

/** 講師の担当の生徒（運営なら塾の全生徒）。名前と目標つき */
export async function loadStudents(sb: SupabaseClient, actor: Actor) {
  let ids: string[] | null = null;
  if (actor.role === 'coach') {
    const { data } = await sb.from('coach_assignments').select('student_id').eq('coach_id', actor.id);
    ids = (data ?? []).map(r => r.student_id);
  } else if (actor.role === 'student') ids = [actor.id];
  let q = sb.from('students').select('id, grade, goal_school, goal_faculty, exam_on, coach_message, profiles!inner(display_name, status)');
  if (ids) q = q.in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map(s => {
    const p = (Array.isArray(s.profiles) ? s.profiles[0] : s.profiles) as { display_name: string; status: string };
    return { id: s.id, name: p.display_name, status: p.status, grade: s.grade, goalSchool: s.goal_school, goalFaculty: s.goal_faculty, examOn: s.exam_on as string | null, coachMessage: s.coach_message };
  }).filter(s => s.status !== 'withdrawn');
}
