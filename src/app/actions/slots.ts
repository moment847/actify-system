'use server';
// 勉強できる時間（生徒が週ごとに登録。講師・運営も「勉強できる時間を直す」で書ける。RLS が本人か担当かを確かめる）
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { dow, mdw, range, WD } from '@/lib/domain/dates';
import { availCopyFromLastWeek } from '@/lib/domain/plan';
import { mergeSlot } from '@/lib/domain/slots';
import { loadWorld } from '@/lib/data/load';
import { dbError, fail, ok, withActor, zDate, zId, zTime, type Result } from '@/server/result';

const Who = z.object({ studentId: zId.optional() });
const target = (actorId: string, role: string, studentId?: string) => (role === 'student' ? actorId : studentId);

/** 枠を足す（この週だけ）。同じ日の重なる枠はまとめる */
export async function addStudySlot(input: { studentId?: string; date: string; start: string; end: string; label?: string }): Promise<Result<{ id: string }>> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const v = Who.extend({ date: zDate, start: zTime, end: zTime, label: z.string().max(20).optional() }).parse(input);
    const sid = target(actor.id, actor.role, v.studentId); if (!sid) return fail('生徒を選んでください');
    if (v.start >= v.end) return fail('終わりの時刻を始まりより後にしてください');
    const { data: same, error: e1 } = await sb.from('study_slots').select('id, start_time, end_time, label').eq('student_id', sid).eq('on_date', v.date);
    if (e1) return fail(dbError(e1));
    const m = mergeSlot((same ?? []).map(a => ({ id: a.id, start: a.start_time.slice(0, 5), end: a.end_time.slice(0, 5), label: a.label })), v.start, v.end);
    const { data, error } = await sb.from('study_slots').insert({ student_id: sid, on_date: v.date, start_time: m.start, end_time: m.end, label: v.label || m.label, created_by: actor.id }).select('id').single();
    if (error) return fail(dbError(error));
    if (m.removeIds.length) await sb.from('study_slots').delete().in('id', m.removeIds);
    revalidatePath('/', 'layout');
    return ok(`${mdw(v.date)} ${range(m.start, m.end)} を勉強できる時間にしました${actor.role !== 'student' ? '（生徒の「予定」に出ます）' : ''}`, { id: data.id });
  });
}

/** 枠を直す：時刻・ラベル・毎週くり返す の切り替え。date は「この週だけ」に戻すときの日 */
export async function updateStudySlot(input: { id: string; start: string; end: string; label?: string; repeat: boolean; date: string }): Promise<Result> {
  return withActor(['student', 'coach', 'admin'], async ({ sb }) => {
    const v = z.object({ id: zId, start: zTime, end: zTime, label: z.string().max(20).optional(), repeat: z.boolean(), date: zDate }).parse(input);
    if (v.start >= v.end) return fail('終わりの時刻を始まりより後にしてください');
    const { data: cur, error: e1 } = await sb.from('study_slots').select('id, on_date, weekday').eq('id', v.id).maybeSingle();
    if (e1 || !cur) return fail('枠が見つかりません');
    const patch: Record<string, unknown> = { start_time: v.start, end_time: v.end, label: v.label ?? '' };
    if (cur.weekday !== null && !v.repeat) Object.assign(patch, { weekday: null, on_date: v.date });
    else if (cur.weekday === null && v.repeat) Object.assign(patch, { weekday: dow(cur.on_date), on_date: null });
    const { error } = await sb.from('study_slots').update(patch).eq('id', v.id);
    if (error) return fail(dbError(error));
    revalidatePath('/', 'layout');
    return ok(v.repeat && cur.weekday === null ? `毎週${WD[dow(cur.on_date)]}曜 ${range(v.start, v.end)} にしました` : '保存しました');
  });
}

export async function deleteStudySlot(id: string): Promise<Result> {
  return withActor(['student', 'coach', 'admin'], async ({ sb }) => {
    const { error, count } = await sb.from('study_slots').delete({ count: 'exact' }).eq('id', zId.parse(id));
    if (error) return fail(dbError(error));
    if (!count) return fail('枠が見つかりません');
    revalidatePath('/', 'layout');
    return ok('勉強できる時間を消しました');
  });
}

/** 毎週の枠を、その日だけ休む */
export async function skipStudySlotDay(input: { id: string; date: string }): Promise<Result> {
  return withActor(['student', 'coach', 'admin'], async ({ sb }) => {
    const v = z.object({ id: zId, date: zDate }).parse(input);
    const { error } = await sb.from('study_slot_skips').insert({ slot_id: v.id, on_date: v.date });
    if (error) return fail(dbError(error));
    revalidatePath('/', 'layout');
    return ok(`${mdw(v.date)}は休みにしました`);
  });
}

/** 先週と同じ時間を、この週に写す */
export async function copyStudySlotsFromLastWeek(input: { studentId?: string; weekStart: string }): Promise<Result<{ count: number }>> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const v = Who.extend({ weekStart: zDate }).parse(input);
    const sid = target(actor.id, actor.role, v.studentId); if (!sid) return fail('生徒を選んでください');
    if (dow(v.weekStart) !== 0) return fail('週の始まり（月曜）を渡してください');
    const w = await loadWorld(sb, actor, [sid]);
    const rows = availCopyFromLastWeek(w, sid, v.weekStart);
    if (!rows.length) return ok('先週の登録がありません', { count: 0 });
    const { error } = await sb.from('study_slots').insert(rows.map(r => ({ student_id: sid, on_date: r.date, start_time: r.start, end_time: r.end, label: r.label, created_by: actor.id })));
    if (error) return fail(dbError(error));
    revalidatePath('/', 'layout');
    return ok(`先週と同じ${rows.length}枠を入れました${actor.role !== 'student' ? '（仮の登録。生徒の「予定」に出ます）' : ''}`, { count: rows.length });
  });
}

