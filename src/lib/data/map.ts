// DB の行（PostgREST が返す形）→ 計算に使う World。画面にも Supabase にも依存しない（テストで使う）
import type { DateStr, FeedbackTag, MaterialKind, Subject, Task, VagueKind, World } from '@/lib/domain/types';

export interface Rows {
  materials: { id: string; name: string; short_name: string; subject: Subject; kind: MaterialKind; review_intervals: number[]; keywords: string[]; archived_at: string | null }[];
  units: { id: string; material_id: string; seq: number; label: string }[];
  quizVersions: { id: string; unit_id: string; version: number; max_score: number }[];
  tasks: {
    id: string; student_id: string; on_date: string; start_time: string; duration_min: number; material_id: string | null; unit_id: string | null;
    vague: VagueKind | null; title: string | null; status: 'todo' | 'done'; quiz_version_id: string | null; max_score: number | null; no_quiz: boolean;
    is_retest: boolean; score: number | null; actual_min: number | null; started_at: string | null; paused_at: string | null; paused_ms: number; created_at: string;
  }[];
  feedback: { task_id: string; tag: FeedbackTag | null; body: string; created_at: string }[];
  replies: { task_id: string; body: string; created_at: string }[];
  slots: { id: string; student_id: string; on_date: string | null; weekday: number | null; start_time: string; end_time: string; label: string }[];
  slotSkips: { slot_id: string; on_date: string }[];
  books: { student_id: string; material_id: string; start_on: string; target_on: string }[];
  meetings: { id: string; student_id: string; coach_id: string; on_date: string; start_time: string; length_min: number }[];
  coachOpen: { id: string; on_date: string | null; weekday: number | null; start_time: string; end_time: string }[];
  reviewSkips: { student_id: string; unit_id: string; attempt: number }[];
  meetingLength: number;
}

/** 'HH:MM:SS' → 'HH:MM' */
export const hm = (t: string) => t.slice(0, 5);
/** timestamptz → その日（UTC ではなく、渡したタイムゾーンの暦日） */
export const dayIn = (ts: string, timeZone: string): DateStr =>
  new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(ts));

export function rowsToWorld(r: Rows, today: DateStr, timeZone = 'Asia/Tokyo'): World {
  const fb = new Map(r.feedback.map(f => [f.task_id, f])), rp = new Map(r.replies.map(x => [x.task_id, x]));
  // 予定は「日付 → 時刻 → 入れた順」に並べる（同じ時刻のときモックと同じく入れた順）
  const tasks = [...r.tasks].sort((a, b) => a.created_at.localeCompare(b.created_at));
  return {
    today,
    materials: r.materials.map(m => ({
      id: m.id, name: m.name, short: m.short_name, subject: m.subject, kind: m.kind, intervals: m.review_intervals ?? [], keywords: m.keywords ?? [],
      archived: !!m.archived_at,
      units: r.units.filter(u => u.material_id === m.id).sort((a, b) => a.seq - b.seq).map(u => ({ id: u.id, label: u.label })),
    })),
    quizVersions: r.quizVersions.map(q => ({ id: q.id, unitId: q.unit_id, version: q.version, max: q.max_score })),
    tasks: tasks.map((t): Task => {
      const f = fb.get(t.id), x = rp.get(t.id);
      return {
        id: t.id, studentId: t.student_id, date: t.on_date, time: hm(t.start_time), duration: t.duration_min,
        materialId: t.material_id, unitId: t.unit_id, vague: t.vague, title: t.title, status: t.status,
        quizVersionId: t.quiz_version_id, max: t.max_score, noQuiz: t.no_quiz, retest: t.is_retest, score: t.score, actual: t.actual_min,
        startedAt: t.started_at, pausedAt: t.paused_at, pausedMs: Number(t.paused_ms ?? 0),
        feedback: f ? { tag: f.tag, body: f.body, date: dayIn(f.created_at, timeZone) } : null,
        reply: x ? { body: x.body, date: dayIn(x.created_at, timeZone) } : null,
      };
    }),
    slots: r.slots.map(a => ({ id: a.id, studentId: a.student_id, date: a.on_date, weekday: a.weekday, start: hm(a.start_time), end: hm(a.end_time), label: a.label || '' })),
    slotSkips: new Set(r.slotSkips.map(x => `${x.slot_id}:${x.on_date}`)),
    books: r.books.map(b => ({ studentId: b.student_id, materialId: b.material_id, start: b.start_on, target: b.target_on })),
    meetings: r.meetings.map(m => ({ id: m.id, studentId: m.student_id, coachId: m.coach_id, date: m.on_date, time: hm(m.start_time), len: m.length_min })),
    coachOpen: r.coachOpen.map(o => ({ id: o.id, date: o.on_date, weekday: o.weekday, start: hm(o.start_time), end: hm(o.end_time) })),
    meetingLength: r.meetingLength,
    reviewSkips: new Set(r.reviewSkips.map(s => `rv:${s.student_id}:${s.unit_id}:${s.attempt}`)),
  };
}
