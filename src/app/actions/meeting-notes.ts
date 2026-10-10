'use server';
// 面談の記録（議事録・自由なメモ）と、AI の予定の提案。講師と運営だけ（生徒は記録を読めない。共有欄だけを my_meeting_todos で受け取る）
// - 記録：面談ごとの議事録（kind=minutes）と、いつでも書ける自由なメモ（kind=memo）。「次回までにやること」だけを生徒に共有する
// - AI の要約：記録を「決めたこと・宿題・気になること」と、生徒に見せる「次回までにやること」の案に整理する（共有は講師が確かめてから）
// - AI の予定の提案：記録と数字から「方針」を AI が決め、日時は今までの計算で置く。保存して、講師が選んだ項目だけを予定に入れる
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { summarizeMeeting, type MeetingSummary } from '@/lib/ai/meeting-summary';
import { adviseWeekPlan } from '@/lib/ai/plan-advice';
import { studentContext } from '@/lib/domain/bot-reply';
import { dow, weekDays } from '@/lib/domain/dates';
import { cleanAdvice, planContext, proposalItems, type NoteForContext, type PlanAdvice, type PlanItem } from '@/lib/domain/plan-advice';
import { loadStudents, loadWorld, studentToday } from '@/lib/data/load';
import { env } from '@/lib/env';
import { reserveAi, settleAi, type AiBlock } from '@/server/ai-budget';
import { changed, dbError, fail, ok, withActor, zDate, zId, type Result } from '@/server/result';

const STAFF = ['coach', 'admin'] as const;
const done = () => revalidatePath('/', 'layout');
const BLOCKED: Record<AiBlock, string> = {
  busy: '前の AI の処理が終わるのを待ってください',
  daily_limit: '今日の AI の回数の上限に達しました',
  budget: '今月の AI の予算に達しました（運営にお問い合わせください）',
  unknown: 'AI を使えませんでした',
};

export interface MeetingNote {
  id: string; studentId: string; meetingId: string | null; kind: 'minutes' | 'memo'; onDate: string;
  body: string; summary: Partial<MeetingSummary> | null; sharedTodo: string; createdBy: string | null; createdAt: string; updatedAt: string;
}
const toNote = (r: Record<string, unknown>): MeetingNote => ({
  id: r.id as string, studentId: r.student_id as string, meetingId: (r.meeting_id as string) ?? null, kind: r.kind as MeetingNote['kind'], onDate: r.on_date as string,
  body: r.body as string, summary: (r.summary as MeetingNote['summary']) ?? null, sharedTodo: r.shared_todo as string,
  createdBy: (r.created_by as string) ?? null, createdAt: r.created_at as string, updatedAt: r.updated_at as string,
});
const COLS = 'id, student_id, meeting_id, kind, on_date, body, summary, shared_todo, created_by, created_at, updated_at';

// ---------- 記録 ----------
const SaveNote = z.object({
  id: zId.optional(), studentId: zId, meetingId: zId.nullish(), kind: z.enum(['minutes', 'memo']), onDate: zDate.optional(),
  body: z.string().max(8000), sharedTodo: z.string().max(1000).optional(),
});
/** 記録を書く・直す。日付は面談の日（無ければ生徒の今日） */
export async function saveMeetingNote(input: z.input<typeof SaveNote>): Promise<Result<{ id: string }>> {
  return withActor([...STAFF], async ({ sb }) => {
    const v = SaveNote.parse(input);
    const body = v.body.trim(), todo = (v.sharedTodo ?? '').trim();
    if (!body && !todo) return fail('記録を書いてください');
    let onDate = v.onDate;
    if (!onDate && v.meetingId) onDate = (await sb.from('meetings').select('on_date').eq('id', v.meetingId).maybeSingle()).data?.on_date ?? undefined;
    if (!onDate) onDate = (await studentToday(sb, v.studentId)) ?? undefined;
    if (!onDate) return fail('生徒が見つかりません');
    const row = { student_id: v.studentId, meeting_id: v.meetingId ?? null, kind: v.kind, on_date: onDate, body, shared_todo: todo };
    if (v.id) {
      const bad = changed(await sb.from('meeting_notes').update(row, { count: 'exact' }).eq('id', v.id).eq('student_id', v.studentId), '記録が見つかりません');
      if (bad) return fail(bad);
      done(); return ok(todo ? '保存しました（「次回までにやること」は生徒にも見えます）' : '保存しました', { id: v.id });
    }
    const { data, error } = await sb.from('meeting_notes').insert(row).select('id').single();
    if (error) return fail(dbError(error));
    done(); return ok(todo ? '記録を残しました（「次回までにやること」は生徒にも見えます）' : '記録を残しました', { id: data.id });
  });
}

/** 生徒の記録（新しい順） */
export async function listMeetingNotes(studentId: string): Promise<Result<MeetingNote[]>> {
  return withActor([...STAFF], async ({ sb }) => {
    const { data, error } = await sb.from('meeting_notes').select(COLS).eq('student_id', zId.parse(studentId))
      .order('on_date', { ascending: false }).order('created_at', { ascending: false }).limit(100);
    if (error) return fail(dbError(error));
    return ok(undefined, (data ?? []).map(toNote));
  });
}

/** 記録を消す（書いた本人と運営だけ。DB でも止める） */
export async function deleteMeetingNote(id: string): Promise<Result> {
  return withActor([...STAFF], async ({ sb }) => {
    const bad = changed(await sb.from('meeting_notes').delete({ count: 'exact' }).eq('id', zId.parse(id)), '記録が見つからないか、消せるのは書いた人と運営だけです');
    if (bad) return fail(bad);
    done(); return ok('記録を消しました');
  });
}

/**
 * AI で記録を整理する（決めたこと・宿題・気になること）。要約は記録に保存する。
 * 生徒に見せる「次回までにやること」は案として返すだけで、共有は講師が確かめて saveMeetingNote で保存する
 */
export async function summarizeMeetingNote(id: string): Promise<Result<{ summary: MeetingSummary }>> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const { data: n } = await sb.from('meeting_notes').select('id, body').eq('id', zId.parse(id)).maybeSingle();
    if (!n) return fail('記録が見つかりません');
    if (n.body.trim().length < 10) return fail('整理するには記録が短すぎます');
    if (!env.anthropicApiKey()) return fail('AI の設定がまだです');
    const r = await reserveAi(actor.schoolId, actor.id, 'note_summary', env.aiNoteEstimateJpy());
    if ('blocked' in r) return fail(BLOCKED[r.blocked]);
    let call: Awaited<ReturnType<typeof summarizeMeeting>>['call'] = null;
    try {
      const s = await summarizeMeeting(n.body);
      call = s.call;
      if (!s.result) return fail('AI で整理できませんでした。もう一度試してください');
      const { decided, homework, concerns } = s.result;
      const bad = changed(await sb.from('meeting_notes').update({ summary: { decided, homework, concerns } }, { count: 'exact' }).eq('id', n.id), '記録が見つかりません');
      if (bad) return fail(bad);
      done();
      return ok('整理しました。「次回までにやること」の案を確かめてから共有してください', { summary: s.result });
    } finally {
      await settleAi(r.id, call, env.aiNoteEstimateJpy());
    }
  });
}

// ---------- AI の予定の提案 ----------
export interface PlanProposal { id: string; weekStart: string; advice: PlanAdvice; items: PlanItem[]; aiUsed: boolean; aiNote?: string }

const NEUTRAL: PlanAdvice = { summary: '', focus: [], lighterDays: [], notes: [] };

/**
 * 次の週（weekStart の週）の予定の案を作る。AI が方針を決め、計算が日時に置く。予定にはまだ入れない（保存だけ）。
 * AI が使えないとき（キーが無い・上限・失敗）は、方針なしの計算だけの案にして、その理由を返す
 */
export async function proposeWeekPlan(input: { studentId: string; weekStart: string }): Promise<Result<PlanProposal>> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ studentId: zId, weekStart: zDate }).parse(input);
    if (dow(v.weekStart) !== 0) return fail('週の始まり（月曜）を指定してください');
    const [st] = (await loadStudents(sb, actor)).filter(s => s.id === v.studentId);
    if (!st) return fail('生徒が見つかりません');
    const w = await loadWorld(sb, actor, [v.studentId]);
    if (!weekDays(v.weekStart).some(d => d > w.today)) return fail('過ぎた週には案を作れません');

    const { data: notes } = await sb.from('meeting_notes').select(COLS).eq('student_id', v.studentId)
      .order('on_date', { ascending: false }).order('created_at', { ascending: false }).limit(5);
    const forCtx: NoteForContext[] = (notes ?? []).map(toNote).map(n => ({ onDate: n.onDate, kind: n.kind, body: n.body, summary: n.summary, sharedTodo: n.sharedTodo }));
    const base = studentContext(w, v.studentId, { name: st.name, goal: `${st.goalSchool} ${st.goalFaculty}`.trim(), examOn: st.examOn });
    const context = planContext(w, v.studentId, v.weekStart, base, forCtx);

    let advice = NEUTRAL, aiUsed = false, aiNote: string | undefined, model = '', promptVersion = '';
    if (!env.anthropicApiKey()) aiNote = 'AI の設定がまだなので、点数と進みだけで案を作りました';
    else {
      const r = await reserveAi(actor.schoolId, actor.id, 'plan_advice', env.aiPlanEstimateJpy());
      if ('blocked' in r) aiNote = `${BLOCKED[r.blocked]}。点数と進みだけで案を作りました`;
      else {
        let call: Awaited<ReturnType<typeof adviseWeekPlan>>['call'] = null;
        try {
          const a = await adviseWeekPlan(context);
          call = a.call;
          if (a.result) { advice = cleanAdvice(a.result, w, v.studentId, v.weekStart); aiUsed = true; model = a.call?.model ?? ''; promptVersion = a.call?.promptVersion ?? ''; }
          else aiNote = 'AI の提案を作れなかったので、点数と進みだけで案を作りました';
        } finally {
          await settleAi(r.id, call, env.aiPlanEstimateJpy());
        }
      }
    }
    const items = proposalItems(w, v.studentId, v.weekStart, advice);
    const { data, error } = await sb.from('plan_proposals')
      .insert({ student_id: v.studentId, week_start: v.weekStart, advice, items, model, prompt_version: promptVersion }).select('id').single();
    if (error) return fail(dbError(error));
    return ok(aiNote, { id: data.id, weekStart: v.weekStart, advice, items, aiUsed, aiNote });
  });
}

/**
 * 案のうち、講師が選んだ項目を予定に入れる。案を作ったあとで予定が変わっていたら、入れられない項目は理由を返す（DB が重なりなどを止める）。
 * やり残しは元の予定をその日時へ動かし、次の範囲・再テストは新しく入れる（再テストかどうかは DB が決める）
 */
export async function adoptPlanItems(input: { proposalId: string; keys: string[] }): Promise<Result<{ added: number; failed: { key: string; label: string; why: string }[] }>> {
  return withActor([...STAFF], async ({ sb, actor }) => {
    const v = z.object({ proposalId: zId, keys: z.array(z.string().max(200)).min(1).max(60) }).parse(input);
    const { data: p } = await sb.from('plan_proposals').select('id, student_id, items, status, adopted_keys').eq('id', v.proposalId).maybeSingle();
    if (!p) return fail('案が見つかりません');
    const today = (await studentToday(sb, p.student_id)) ?? actor.today;
    const want = new Set(v.keys), already = new Set<string>(p.adopted_keys ?? []);
    const items = (p.items as PlanItem[]).filter(i => want.has(i.key) && !already.has(i.key));
    const failed: { key: string; label: string; why: string }[] = [];
    const adopted: string[] = [];
    for (const it of items) {
      if (it.date <= today) { failed.push({ key: it.key, label: it.label, why: '過ぎた日・今日の案は入れられません' }); continue; }
      if (it.kind === 'move' && it.taskId) {
        const r = await sb.from('tasks').update({ on_date: it.date, start_time: it.time, duration_min: it.dur }, { count: 'exact' })
          .eq('id', it.taskId).eq('student_id', p.student_id).eq('status', 'todo');
        const bad = changed(r, 'もう終わったか、消された予定です');
        if (bad) { failed.push({ key: it.key, label: it.label, why: bad }); continue; }
      } else {
        const { error } = await sb.from('tasks').insert({ student_id: p.student_id, on_date: it.date, start_time: it.time, duration_min: it.dur, material_id: it.materialId, unit_id: it.unitId, created_by: actor.id });
        if (error) { failed.push({ key: it.key, label: it.label, why: dbError(error) }); continue; }
      }
      adopted.push(it.key);
    }
    if (adopted.length) {
      const { error } = await sb.from('plan_proposals').update({ status: 'adopted', adopted_keys: [...already, ...adopted] }).eq('id', p.id);
      if (error) console.error('[plan] adopted keys not saved', { id: p.id, message: error.message });
    }
    done();
    return ok(`${adopted.length}件を予定に入れました${failed.length ? `（${failed.length}件は入れられませんでした）` : ''}`, { added: adopted.length, failed });
  });
}

/** 案を見送る（記録として残す） */
export async function dismissPlanProposal(id: string): Promise<Result> {
  return withActor([...STAFF], async ({ sb }) => {
    const bad = changed(await sb.from('plan_proposals').update({ status: 'dismissed' }, { count: 'exact' }).eq('id', zId.parse(id)).eq('status', 'open'), '案が見つからないか、もう使った案です');
    if (bad) return fail(bad);
    return ok('案を見送りました');
  });
}
