'use server';
// 講師（と運営）の操作：計画・コメントの返信・目標・面談・小テスト・配る資料。
// 予定を入れたあとの「範囲の順番」と「小テストの版」は DB のトリガがそろえる（どこから入れても同じ）。
// ここでは、そろえた結果を通知の文にするため、同じ決まりの計算（lib/domain）で先に見通す。
import { revalidatePath } from 'next/cache';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { dateAdd, dow, dur, mdw, range, toMin, toTime, weekStart } from '@/lib/domain/dates';
import {
  blockAt, blockGaps, freeGaps, mat, meetingInWeek, meetingSlots, needsPdf, recommendFill, repack, resequence, typicalDur, unitOf, weekBlocks,
} from '@/lib/domain/plan';
import { matchPdfName, parseFreeEntry } from '@/lib/domain/text-match';
import { mergeSlot } from '@/lib/domain/slots';
import { VAGUE, type Task, type World } from '@/lib/domain/types';
import { loadStudents, loadWorld, type Actor } from '@/lib/data/load';
import { dbError, fail, ok, withActor, zDate, zId, zTime, type Result } from '@/server/result';

const STAFF = ['coach', 'admin'] as const;
const done = () => revalidatePath('/', 'layout');
const zDur = z.number().int().min(5).max(600);
const zVague = z.enum(['buffer', 'mock', 'school', 'weak', 'free']);
let tmp = 0;
const tmpId = () => `tmp-${Date.now()}-${tmp++}`;

/** 範囲の順番がそろったときの一言（モックの seqNote と同じ） */
function seqNote(w: World, sid: string, except?: string) {
  const ch = resequence(w, sid).filter(c => c.t.id !== except);
  return ch.length ? `。${[...new Set(ch.map(c => mat(w, c.t.materialId)?.short))].join('・')}の範囲を日付の順にそろえました` : '';
}
/** 入れた予定の小テストの様子（DB が付けた版を読む） */
async function quizNote(sb: SupabaseClient, w: World, taskId: string) {
  const { data: t } = await sb.from('tasks').select('unit_id, quiz_version_id, no_quiz, quiz_versions(version)').eq('id', taskId).maybeSingle();
  if (!t?.unit_id || t.no_quiz) return '';
  const v = (Array.isArray(t.quiz_versions) ? t.quiz_versions[0] : t.quiz_versions) as { version: number } | null;
  if (v) return ` · 小テスト第${v.version}版`;
  return needsPdf(w, t.unit_id) ? ' · 使える小テストなし' : '';
}
async function worldFor(sb: SupabaseClient, actor: Actor, sid: string) { return loadWorld(sb, actor, [sid]); }

// ---------- 予定を入れる・直す ----------
const AddTask = z.object({
  studentId: zId, date: zDate, time: zTime, duration: zDur,
  unitId: zId.optional(), quiz: z.boolean().default(true),
  vague: zVague.optional(), title: z.string().trim().min(1).max(80).optional(),
});
/**
 * 予定を1件入れる。教材の範囲（unitId）か、時間だけの予定（vague＋題名）のどちらか。
 * 「まだの予定」に入っている範囲を選んだら、二重にせず、その予定をここへ移す（モックと同じ）
 */
export async function addTask(input: z.input<typeof AddTask>): Promise<Result<{ id: string }>> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = AddTask.parse(input);
    const w = await worldFor(sb, actor, v.studentId);
    if (v.unitId) {
      const u = unitOf(w, v.unitId); if (!u) return fail('範囲が見つかりません');
      const planned = w.tasks.find(t => t.studentId === v.studentId && t.unitId === v.unitId && t.status !== 'done');
      if (planned) {
        planned.date = v.date; planned.time = v.time; planned.duration = v.duration;
        const note = seqNote(w, v.studentId, planned.id);
        const { error } = await sb.from('tasks').update({ on_date: v.date, start_time: v.time, duration_min: v.duration, no_quiz: !v.quiz }).eq('id', planned.id);
        if (error) return fail(dbError(error));
        done();
        return ok(`${mdw(planned.date)}に入っていた予定をここへ移しました${note}`, { id: planned.id });
      }
      const t: Task = { id: tmpId(), studentId: v.studentId, date: v.date, time: v.time, duration: v.duration, materialId: u.m.id, unitId: v.unitId, vague: null, title: null, status: 'todo', quizVersionId: null, max: null, noQuiz: !v.quiz, retest: false, score: null, actual: null };
      w.tasks.push(t);
      const note = seqNote(w, v.studentId, t.id);
      const { data, error } = await sb.from('tasks').insert({ student_id: v.studentId, on_date: v.date, start_time: v.time, duration_min: v.duration, material_id: u.m.id, unit_id: v.unitId, no_quiz: !v.quiz, created_by: actor.id }).select('id, unit_id, is_retest').single();
      if (error) return fail(dbError(error));
      done();
      const lbl = unitOf(w, data.unit_id)?.unit.label ?? u.unit.label;
      return ok(`${v.time}〜 ${dur(v.duration)} ${u.m.short} ${lbl}${data.is_retest ? '（再テスト）' : ''}${await quizNote(sb, w, data.id)}${note}`, { id: data.id });
    }
    const kind = v.vague ?? 'free';
    const title = v.title ?? VAGUE.find(x => x.k === kind)?.label;
    if (!title) return fail('何をするかを書いてください');
    const { data, error } = await sb.from('tasks').insert({ student_id: v.studentId, on_date: v.date, start_time: v.time, duration_min: v.duration, vague: kind, title, no_quiz: true, created_by: actor.id }).select('id').single();
    if (error) return fail(dbError(error));
    done();
    return ok(`${v.time}〜 ${dur(v.duration)} ${title}を入れました`, { id: data.id });
  });
}

const UpdateTask = z.object({
  id: zId, date: zDate, time: zTime, duration: zDur,
  unitId: zId.nullable().optional(), quiz: z.boolean().optional(), title: z.string().trim().min(1).max(80).optional(), vague: zVague.optional(),
});
/** 予定を直す（日付・時刻・長さ・範囲・小テストを付けるか）。カレンダーで動かす・端を引っぱるのもこれ */
export async function updateTask(input: z.input<typeof UpdateTask>): Promise<Result> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = UpdateTask.parse(input);
    const { data: cur } = await sb.from('tasks').select('student_id, status').eq('id', v.id).maybeSingle();
    if (!cur) return fail('予定が見つかりません');
    const w = await worldFor(sb, actor, cur.student_id);
    const t = w.tasks.find(x => x.id === v.id)!;
    const patch: Record<string, unknown> = { on_date: v.date, start_time: v.time, duration_min: v.duration };
    if (v.unitId !== undefined && v.unitId !== t.unitId) {
      if (v.unitId === null) return fail('範囲を選んでください');
      const u = unitOf(w, v.unitId); if (!u) return fail('範囲が見つかりません');
      if (w.tasks.some(x => x.studentId === t.studentId && x.unitId === v.unitId && x.status !== 'done' && x.id !== t.id)) return fail('その範囲はほかの日に入っています');
      Object.assign(patch, { material_id: u.m.id, unit_id: v.unitId, quiz_version_id: null });
      t.unitId = v.unitId; t.materialId = u.m.id;
    }
    if (v.quiz !== undefined && t.unitId) Object.assign(patch, { no_quiz: !v.quiz, ...(v.quiz ? {} : { quiz_version_id: null }) });
    if (t.vague) { if (v.title) patch.title = v.title; if (v.vague) patch.vague = v.vague; }
    t.date = v.date; t.time = v.time; t.duration = v.duration;
    const note = cur.status === 'todo' ? seqNote(w, t.studentId) : '';
    const { error } = await sb.from('tasks').update(patch).eq('id', v.id);
    if (error) return fail(dbError(error));
    done();
    return ok(`保存しました${note}`);
  });
}

/** 予定を外す。repack を渡すと、その時間のまとまりの後ろを詰める（右の一覧の ×） */
export async function deleteTask(input: { id: string; repack?: boolean }): Promise<Result> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ id: zId, repack: z.boolean().optional() }).parse(input);
    const { data: cur } = await sb.from('tasks').select('student_id, on_date, start_time, title, unit_id').eq('id', v.id).maybeSingle();
    if (!cur) return fail('予定が見つかりません');
    const w = await worldFor(sb, actor, cur.student_id);
    const label = cur.title || `${mat(w, w.tasks.find(t => t.id === v.id)?.materialId)?.short ?? ''} ${unitOf(w, cur.unit_id)?.unit.label ?? ''}`.trim();
    const { error } = await sb.from('tasks').delete().eq('id', v.id);
    if (error) return fail(dbError(error));
    if (v.repack) {
      w.tasks = w.tasks.filter(t => t.id !== v.id);
      const b = blockAt(w, cur.student_id, cur.on_date, toMin(cur.start_time.slice(0, 5)));
      if (b) for (const m of repack(w, cur.student_id, b)) await sb.from('tasks').update({ start_time: m.time }).eq('id', m.id);
    }
    done();
    return ok(`「${label}」を外しました${v.repack ? '（後ろは詰めました）' : '（小テストの版は空きに戻りました）'}`);
  });
}

/** 右の一覧の −／＋：長さを5分ずつ変えて、まとまりの中を詰め直す */
export async function adjustTaskDuration(input: { id: string; delta: number }): Promise<Result> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ id: zId, delta: z.number().int().min(-120).max(120) }).parse(input);
    const { data: cur } = await sb.from('tasks').select('student_id, on_date, start_time, duration_min').eq('id', v.id).maybeSingle();
    if (!cur) return fail('予定が見つかりません');
    const w = await worldFor(sb, actor, cur.student_id);
    const t = w.tasks.find(x => x.id === v.id)!;
    t.duration = Math.max(10, t.duration + v.delta);
    const { error } = await sb.from('tasks').update({ duration_min: t.duration }).eq('id', v.id);
    if (error) return fail(dbError(error));
    const b = blockAt(w, cur.student_id, cur.on_date, toMin(cur.start_time.slice(0, 5)));
    if (b) for (const m of repack(w, cur.student_id, b)) await sb.from('tasks').update({ start_time: m.time }).eq('id', m.id);
    done();
    return ok();
  });
}

/**
 * 空きを押して開いた「残りの時間に入れる」欄から入れる（既定は自由に書く）。
 * text：「模試の直し」→ 時間だけ、「ターゲット 801」→ その範囲、「古文」→ 次の範囲。unitId を渡したら教材を選んだ入れ方
 */
export async function placeInGap(input: { studentId: string; date: string; blockStart: string; duration: number; text?: string; unitId?: string; quiz?: boolean }): Promise<Result<{ id: string }>> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ studentId: zId, date: zDate, blockStart: zTime, duration: zDur, text: z.string().max(80).optional(), unitId: zId.optional(), quiz: z.boolean().optional() }).parse(input);
    const w = await worldFor(sb, actor, v.studentId);
    const b = blockAt(w, v.studentId, v.date, toMin(v.blockStart));
    if (!b) return fail('勉強できる時間が見つかりません（今日より後の時間だけ入れられます）');
    const g0 = blockGaps(w, v.studentId, b)[0]; if (!g0) return fail('この時間はいっぱいです');
    const d = Math.min(g0[1] - g0[0], v.duration), time = toTime(g0[0]);
    if (v.unitId) return addTask({ studentId: v.studentId, date: v.date, time, duration: d, unitId: v.unitId, quiz: v.quiz ?? true });
    const pe = parseFreeEntry(w, v.studentId, v.text ?? '');
    if (!pe) return fail('何をするかを書いてください');
    if (pe.kind === 'vague') return addTask({ studentId: v.studentId, date: v.date, time, duration: d, vague: pe.v.k });
    if (pe.kind === 'free') return addTask({ studentId: v.studentId, date: v.date, time, duration: d, vague: 'free', title: pe.title });
    if (!pe.node) return fail(`${pe.m.short}は1周ぶん済み・予定済みです。教材を選んで範囲を指定してください`);
    return addTask({ studentId: v.studentId, date: v.date, time, duration: d, unitId: pe.node, quiz: v.quiz ?? true });
  });
}

/** 「おすすめで残りを埋める」：その時間のまとまり（blockStart を含む）の空きに、長さにぴったりの組み合わせを入れる */
export async function fillBlockWithRecommendations(input: { studentId: string; date: string; blockStart: string }): Promise<Result<{ count: number }>> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ studentId: zId, date: zDate, blockStart: zTime }).parse(input);
    const w = await worldFor(sb, actor, v.studentId);
    const b = blockAt(w, v.studentId, v.date, toMin(v.blockStart));
    if (!b) return fail('勉強できる時間が見つかりません');
    return insertRecommended(sb, actor, w, v.studentId, [b]);
  });
}

/** 週の空きを、まとまりごとにおすすめで埋める */
export async function fillWeekWithRecommendations(input: { studentId: string; weekStart: string }): Promise<Result<{ count: number }>> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ studentId: zId, weekStart: zDate }).parse(input);
    const w = await worldFor(sb, actor, v.studentId);
    return insertRecommended(sb, actor, w, v.studentId, weekBlocks(w, v.studentId, weekStart(v.weekStart)));
  });
}

async function insertRecommended(sb: SupabaseClient, actor: Actor, w: World, sid: string, blocks: ReturnType<typeof weekBlocks>): Promise<Result<{ count: number }>> {
  const put = blocks.flatMap(b => recommendFill(w, sid, b, tmpId));
  if (!put.length) return ok('入れられるおすすめがありません', { count: 0 });
  const moved = put.filter(t => !t.id.startsWith('tmp-')), fresh = put.filter(t => t.id.startsWith('tmp-'));
  for (const t of moved) {
    const { error } = await sb.from('tasks').update({ on_date: t.date, start_time: t.time, duration_min: t.duration }).eq('id', t.id);
    if (error) return fail(dbError(error));
  }
  if (fresh.length) {
    const { error } = await sb.from('tasks').insert(fresh.map(t => ({ student_id: sid, on_date: t.date, start_time: t.time, duration_min: t.duration, material_id: t.materialId, unit_id: t.unitId, created_by: actor.id })));
    if (error) return fail(dbError(error));
  }
  const lack = put.filter(t => !t.quizVersionId && t.unitId && needsPdf(w, t.unitId)).length;
  done();
  return ok(`おすすめを${put.length}件入れました${lack ? `（使える小テストがない予定が${lack}件）` : '（小テストは自動で付けています）'}`, { count: put.length });
}

/** 済んだ予定の「次の範囲」を、2週間以内で最初に空いている所へ入れる */
export async function placeNextUnit(taskId: string): Promise<Result<{ id: string }>> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const { data: cur } = await sb.from('tasks').select('student_id').eq('id', zId.parse(taskId)).maybeSingle();
    if (!cur) return fail('予定が見つかりません');
    const w = await worldFor(sb, actor, cur.student_id);
    const t = w.tasks.find(x => x.id === taskId)!, u = unitOf(w, t.unitId);
    if (!u) return fail('教材の予定ではありません');
    const next = u.m.units[u.index + 1]; if (!next) return fail('この教材の最後の範囲です');
    const len = typicalDur(w, t.studentId, u.m.id);
    for (let i = 0; i < 14; i++) {
      const d = dateAdd(t.date, i); if (d <= w.today) continue;
      const g = freeGaps(w, t.studentId, d).find(([s, e]) => e - s >= len && (i > 0 || s >= toMin(t.time) + t.duration));
      if (g) return addTask({ studentId: t.studentId, date: d, time: toTime(Math.ceil(g[0] / 5) * 5), duration: len, unitId: next.id });
    }
    return fail('2週間以内に空き時間がありません。カレンダーで直接入れてください');
  });
}

/** 再テストを今回は見送る */
export async function skipReview(input: { studentId: string; unitId: string; attempt: number }): Promise<Result> {
  return withActor([...STAFF], async ({ sb }) => {
    const v = z.object({ studentId: zId, unitId: zId, attempt: z.number().int().min(1) }).parse(input);
    const { error } = await sb.from('review_skips').insert({ student_id: v.studentId, unit_id: v.unitId, attempt: v.attempt });
    if (error) return fail(dbError(error));
    done();
    return ok('今回の再テストは見送りました');
  });
}

// ---------- コメントと目標 ----------
export async function replyToFeedback(input: { taskId: string; body: string }): Promise<Result> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ taskId: zId, body: z.string().trim().min(1, '返信を書いてください').max(400) }).parse(input);
    const { error } = await sb.from('task_replies').upsert({ task_id: v.taskId, coach_id: actor.id, body: v.body });
    if (error) return fail(dbError(error));
    done();
    return ok('返信しました（生徒の「記録」に出ます）');
  });
}

/** 生徒へのメッセージ（ホームに出る）と、講師メモ（生徒には見えない） */
export async function saveStudentNotes(input: { studentId: string; message: string; memo: string }): Promise<Result> {
  return withActor([...STAFF], async ({ sb }) => {
    const v = z.object({ studentId: zId, message: z.string().max(400), memo: z.string().max(2000) }).parse(input);
    const [a, b] = await Promise.all([
      sb.from('students').update({ coach_message: v.message }).eq('id', v.studentId),
      sb.from('coach_notes').upsert({ student_id: v.studentId, memo: v.memo }),
    ]);
    if (a.error || b.error) return fail(dbError(a.error || b.error));
    done();
    return ok('保存しました');
  });
}

/** 担当の参考書と「いつまでに1周」 */
export async function setBook(input: { studentId: string; materialId: string; target?: string; remove?: boolean }): Promise<Result> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ studentId: zId, materialId: zId, target: zDate.optional(), remove: z.boolean().optional() }).parse(input);
    if (v.remove) {
      const { error } = await sb.from('student_books').delete().eq('student_id', v.studentId).eq('material_id', v.materialId);
      if (error) return fail(dbError(error));
      done(); return ok('参考書を外しました');
    }
    const { data: cur } = await sb.from('student_books').select('start_on').eq('student_id', v.studentId).eq('material_id', v.materialId).maybeSingle();
    const { error } = await sb.from('student_books').upsert({ student_id: v.studentId, material_id: v.materialId, start_on: cur?.start_on ?? actor.today, target_on: v.target ?? dateAdd(actor.today, 90) });
    if (error) return fail(dbError(error));
    done();
    return ok(cur ? '目標日を保存しました' : '参考書を追加しました。目標日を決めてください');
  });
}

// ---------- 面談 ----------
export async function addCoachOpenSlot(input: { date: string; start: string; end: string; coachId?: string }): Promise<Result> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ date: zDate, start: zTime, end: zTime, coachId: zId.optional() }).parse(input);
    const coach = actor.role === 'coach' ? actor.id : v.coachId; if (!coach) return fail('講師を選んでください');
    if (v.start >= v.end) return fail('終わりの時刻を始まりより後にしてください');
    const { data: same } = await sb.from('coach_open_slots').select('id, start_time, end_time').eq('coach_id', coach).eq('on_date', v.date);
    const m = mergeSlot((same ?? []).map(o => ({ id: o.id, start: o.start_time.slice(0, 5), end: o.end_time.slice(0, 5) })), v.start, v.end);
    const { error } = await sb.from('coach_open_slots').insert({ coach_id: coach, on_date: v.date, start_time: m.start, end_time: m.end });
    if (error) return fail(dbError(error));
    if (m.removeIds.length) await sb.from('coach_open_slots').delete().in('id', m.removeIds);
    done();
    return ok(`${mdw(v.date)} ${range(m.start, m.end)} を面談できる時間にしました`);
  });
}

export async function updateCoachOpenSlot(input: { id: string; start: string; end: string }): Promise<Result> {
  return withActor([...STAFF], async ({ sb }) => {
    const v = z.object({ id: zId, start: zTime, end: zTime }).parse(input);
    if (v.start >= v.end) return fail('終わりの時刻を始まりより後にしてください');
    const { error } = await sb.from('coach_open_slots').update({ start_time: v.start, end_time: v.end }).eq('id', v.id);
    if (error) return fail(dbError(error));
    done(); return ok('保存しました');
  });
}

export async function deleteCoachOpenSlot(id: string): Promise<Result> {
  return withActor([...STAFF], async ({ sb }) => {
    const { error } = await sb.from('coach_open_slots').delete().eq('id', zId.parse(id));
    if (error) return fail(dbError(error));
    done(); return ok('面談できる時間から外しました（入っている予約はそのまま）');
  });
}

export async function copyCoachOpenFromLastWeek(weekStartDate: string): Promise<Result<{ count: number }>> {
  return withActor(['coach'], async ({ sb, actor }) => {
    const start = zDate.parse(weekStartDate); if (dow(start) !== 0) return fail('週の始まり（月曜）を渡してください');
    const { data } = await sb.from('coach_open_slots').select('on_date, weekday, start_time, end_time').eq('coach_id', actor.id);
    const rows = data ?? [];
    const on = (d: string) => rows.filter(o => (o.weekday !== null ? o.weekday === dow(d) : o.on_date === d));
    const add: { coach_id: string; on_date: string; start_time: string; end_time: string }[] = [];
    for (let i = 0; i < 7; i++) {
      const prev = dateAdd(start, i - 7), nd = dateAdd(start, i);
      for (const o of on(prev)) if (!on(nd).some(x => x.start_time === o.start_time && x.end_time === o.end_time)) add.push({ coach_id: actor.id, on_date: nd, start_time: o.start_time, end_time: o.end_time });
    }
    if (!add.length) return ok('先週の登録がありません', { count: 0 });
    const { error } = await sb.from('coach_open_slots').insert(add);
    if (error) return fail(dbError(error));
    done(); return ok(`先週と同じ${add.length}枠を入れました`, { count: add.length });
  });
}

export async function setBookingSettings(input: { length?: 20 | 30 | 45 | 60; published?: boolean }): Promise<Result> {
  return withActor(['coach'], async ({ sb, actor }) => {
    const v = z.object({ length: z.union([z.literal(20), z.literal(30), z.literal(45), z.literal(60)]).optional(), published: z.boolean().optional() }).parse(input);
    const { data: cur } = await sb.from('booking_settings').select('length_min, published').eq('coach_id', actor.id).maybeSingle();
    const next = { coach_id: actor.id, length_min: v.length ?? cur?.length_min ?? 30, published: v.published ?? cur?.published ?? true };
    const { error } = await sb.from('booking_settings').upsert(next);
    if (error) return fail(dbError(error));
    done();
    if (v.length) return ok(`これからの予約は1回${v.length}分にします`);
    return ok(next.published ? '予約の受付を始めました。生徒の「予定」から予約できます' : '予約の受付を止めました（入っている予約はそのまま）');
  });
}

/** その週にまだ予約していない生徒を、まとめて入れる（先週と同じ時間 → 勉強できる時間と重なる所 → 週末 の順） */
export async function autoBookMeetings(weekStartDate: string): Promise<Result<{ count: number }>> {
  return withActor(['coach'], async ({ sb, actor }) => {
    const start = zDate.parse(weekStartDate);
    const students = await loadStudents(sb, actor);
    const w = await loadWorld(sb, actor, students.map(s => s.id));
    let n = 0;
    for (const s of students) {
      if (meetingInWeek(w, s.id, start)) continue;
      const sl = meetingSlots(w, s.id, start), o = sl.find(x => x.same) || sl.find(x => x.fit) || sl[0];
      if (!o) continue;
      const { data, error } = await sb.rpc('book_meeting', { p_on_date: o.date, p_start: o.time, p_student: s.id, p_coach: actor.id });
      if (error) continue;
      w.meetings.push({ id: data as string, studentId: s.id, coachId: actor.id, date: o.date, time: o.time, len: w.meetingLength });
      n++;
    }
    done();
    return ok(n ? `${n}人の面談を入れました（生徒の「予定」に出ます）` : '入れられる生徒はいませんでした', { count: n });
  });
}

// ---------- 小テスト（問題と解答のPDF） ----------
/**
 * 登録の前の確認：ファイル名から教材・範囲・問題/解答を読み取り、同じ範囲の問題と解答を1つの版にまとめる。
 * ファイルそのものは、画面が quiz-pdfs/{塾}/… へ先に置いておく
 */
export async function prepareQuizUpload(input: { files: { name: string; path: string }[] }): Promise<Result<{ rows: { problem: { name: string; path: string }; answer: { name: string; path: string } | null; materialId: string | null; unitId: string | null; sure: boolean; version: number | null; max: number }[] }>> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ files: z.array(z.object({ name: z.string().max(200), path: z.string().max(300) })).max(300) }).parse(input);
    if (v.files.some(f => !f.path.startsWith(actor.schoolId + '/'))) return fail('ファイルの場所が正しくありません');
    const w = await loadWorld(sb, actor, []);
    const [{ data: mats }, { data: units }, { data: qv }] = await Promise.all([
      sb.from('materials').select('id, name, short_name, subject, kind, review_intervals, keywords, archived_at'),
      sb.from('material_units').select('id, material_id, seq, label').order('seq'),
      sb.from('quiz_versions').select('unit_id, version, max_score'),
    ]);
    w.materials = (mats ?? []).map(m => ({ id: m.id, name: m.name, short: m.short_name, subject: m.subject, kind: m.kind, intervals: m.review_intervals, keywords: m.keywords, archived: !!m.archived_at,
      units: (units ?? []).filter(u => u.material_id === m.id).map(u => ({ id: u.id, label: u.label })) }));
    const groups = new Map<string, { r: ReturnType<typeof matchPdfName>; problems: typeof v.files; answers: typeof v.files }>(), loose: { f: (typeof v.files)[number]; materialId: string | null }[] = [];
    for (const f of v.files.filter(x => /\.pdf$/i.test(x.name))) {
      const r = matchPdfName(f.name, w.materials);
      if (!r.node) { loose.push({ f, materialId: r.material }); continue; }
      const g = groups.get(r.node) ?? { r, problems: [], answers: [] }; groups.set(r.node, g);
      (r.role === 'answer' ? g.answers : g.problems).push(f);
    }
    const lastV = (unit: string) => Math.max(0, ...(qv ?? []).filter(q => q.unit_id === unit).map(q => q.version));
    const maxOf = (mid: string | null) => (qv ?? []).filter(q => units?.find(u => u.id === q.unit_id)?.material_id === mid).at(-1)?.max_score ?? 20;
    const nextV: Record<string, number> = {};
    const rows: { problem: { name: string; path: string }; answer: { name: string; path: string } | null; materialId: string | null; unitId: string | null; sure: boolean; version: number | null; max: number }[] = [];
    groups.forEach(({ r, problems, answers }, unit) => {
      for (let i = 0; i < Math.max(problems.length, answers.length); i++) {
        nextV[unit] = (nextV[unit] ?? lastV(unit)) + 1;
        rows.push({ problem: problems[i] || answers[i], answer: problems[i] ? answers[i] ?? null : null, materialId: r.material, unitId: unit, sure: r.sure, version: nextV[unit], max: maxOf(r.material) });
      }
    });
    loose.forEach(x => rows.push({ problem: x.f, answer: null, materialId: x.materialId, unitId: null, sure: false, version: null, max: maxOf(x.materialId) }));
    const bad = rows.filter(r => !r.unitId).length;
    return ok(bad ? `${bad}件は範囲を選んでください` : 'すべて読み取れました', { rows });
  });
}

/** 確認した版を登録する。版の番号はサーバが付ける。待っていた予定には DB が自動で付ける */
export async function registerQuizVersions(input: { rows: { unitId: string; max: number; problemPath: string; answerPath?: string | null; fileName: string }[] }): Promise<Result<{ count: number; attached: number }>> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ rows: z.array(z.object({ unitId: zId, max: z.number().int().min(1).max(1000), problemPath: z.string().max(300), answerPath: z.string().max(300).nullish(), fileName: z.string().max(200) })).min(1).max(300) }).parse(input);
    if (v.rows.some(r => !r.problemPath.startsWith(actor.schoolId + '/') || (r.answerPath && !r.answerPath.startsWith(actor.schoolId + '/')))) return fail('ファイルの場所が正しくありません');
    const units = [...new Set(v.rows.map(r => r.unitId))];
    const { data: qv } = await sb.from('quiz_versions').select('unit_id, version').in('unit_id', units);
    const { count: before } = await sb.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'todo').is('quiz_version_id', null).in('unit_id', units);
    const last: Record<string, number> = {};
    for (const q of qv ?? []) last[q.unit_id] = Math.max(last[q.unit_id] ?? 0, q.version);
    const rows = v.rows.map(r => { last[r.unitId] = (last[r.unitId] ?? 0) + 1;
      return { unit_id: r.unitId, version: last[r.unitId], max_score: r.max, problem_path: r.problemPath, answer_path: r.answerPath || r.problemPath, file_name: r.fileName, created_by: actor.id }; });
    const { error } = await sb.from('quiz_versions').insert(rows);
    if (error) return fail(dbError(error));
    const { count: after } = await sb.from('tasks').select('id', { count: 'exact', head: true }).eq('status', 'todo').is('quiz_version_id', null).in('unit_id', units);
    const attached = Math.max(0, (before ?? 0) - (after ?? 0));
    done();
    return ok(`${rows.length}件を登録しました${attached ? `。小テストが無かった予定 ${attached}件に自動で付けました` : ''}`, { count: rows.length, attached });
  });
}

// ---------- 配る資料 ----------
export async function registerResource(input: { name: string; path: string; targetStudentId?: string | null }): Promise<Result> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ name: z.string().trim().min(1).max(120), path: z.string().max(300), targetStudentId: zId.nullish() }).parse(input);
    if (!v.path.startsWith(actor.schoolId + '/')) return fail('ファイルの場所が正しくありません');
    const { error } = await sb.from('resources').insert({ name: v.name, file_path: v.path, target_student_id: v.targetStudentId ?? null, created_by: actor.id });
    if (error) return fail(dbError(error));
    done();
    return ok(`配りました（${v.targetStudentId ? '指定した生徒' : '全員'}）`);
  });
}

export async function deleteResource(id: string): Promise<Result> {
  return withActor([...STAFF], async ({ sb }) => {
    const { error } = await sb.from('resources').delete().eq('id', zId.parse(id));
    if (error) return fail(dbError(error));
    done(); return ok('取り下げました');
  });
}

