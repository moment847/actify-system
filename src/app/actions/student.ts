'use server';
// 生徒の操作。予定そのものは書き換えられない（RLS）。始める・完了などは DB の関数（RPC）を通す
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { botReply } from '@/lib/ai/actify-bot';
import { pct, mdw, range, toMin, toTime } from '@/lib/domain/dates';
import { bookProgress, mat } from '@/lib/domain/plan';
import { BOT_NAME } from '@/lib/domain/bot-reply';
import { TAGS, type FeedbackTag } from '@/lib/domain/types';
import { loadStudents, loadWorld } from '@/lib/data/load';
import { createAdminClient } from '@/lib/supabase/admin';
import { env } from '@/lib/env';
import { dbError, fail, ok, withActor, zDate, zId, zTime, type Result } from '@/server/result';

const done = () => revalidatePath('/', 'layout');

async function rpc(name: string, args: Record<string, unknown>, message: string): Promise<Result> {
  return withActor(['student', 'coach', 'admin'], async ({ sb }) => {
    const { error } = await sb.rpc(name, args);
    if (error) return fail(dbError(error));
    done();
    return ok(message);
  });
}

export async function startTask(id: string) { return rpc('start_task', { p_task: zId.parse(id) }, 'タイマーを始めました'); }
export async function pauseTask(id: string) { return rpc('pause_task', { p_task: zId.parse(id) }, '一時停止しました'); }
export async function resumeTask(id: string) { return rpc('resume_task', { p_task: zId.parse(id) }, '再開しました'); }
export async function stopTaskTimer(id: string) { return rpc('stop_task_timer', { p_task: zId.parse(id) }, 'タイマーをやめました（記録はしていません）'); }
export async function reopenTask(id: string) { return rpc('reopen_task', { p_task: zId.parse(id) }, '未完了に戻しました'); }

/** 完了（点数・ひとこと）。完了済みなら点数とひとことを直す */
export async function completeTask(input: { id: string; score?: number | null; tag?: FeedbackTag | null; body?: string }): Promise<Result> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const v = z.object({ id: zId, score: z.number().int().min(0).max(1000).nullish(), tag: z.enum(TAGS as [FeedbackTag, ...FeedbackTag[]]).nullish(), body: z.string().max(80).optional() }).parse(input);
    const { data: before } = await sb.from('tasks').select('status, student_id, material_id').eq('id', v.id).maybeSingle();
    if (!before) return fail('予定が見つかりません');
    const { error } = await sb.rpc('complete_task', { p_task: v.id, p_score: v.score ?? null, p_tag: v.tag ?? null, p_body: v.body ?? '' });
    if (error) return fail(dbError(error));
    done();
    if (before.status === 'done') return ok('保存しました');
    if (!before.material_id) return ok('できた！');
    const w = await loadWorld(sb, actor, [before.student_id]);
    const p = bookProgress(w, before.student_id, before.material_id);
    const t = w.tasks.find(x => x.id === v.id);
    const sc = t?.score != null && t.max ? pct(t.score, t.max) : null;
    const lead = sc == null ? 'できた！' : sc >= 80 ? 'すごい！' : sc >= 60 ? 'いいね！' : 'おつかれさま。';
    return ok(`${lead} ${p.m.short} ${p.done}/${p.total}範囲${(v.tag || v.body) && actor.role === 'student' ? '・ひとことを先生に送りました' : ''}`);
  });
}

/** 予備時間に、いちばん古いやり残しを入れる */
export async function fillBuffer(id: string): Promise<Result> {
  return withActor(['student', 'coach', 'admin'], async ({ sb }) => {
    const { data, error } = await sb.rpc('fill_buffer', { p_buffer: zId.parse(id) });
    if (error) return fail(dbError(error));
    done();
    return data ? ok('予備時間にやり残しを入れました') : ok('入れるやり残しはありません');
  });
}

// ---------- 面談 ----------
/** 面談を予約する（同じ週の予約は入れ替え）。生徒は前日まで。講師・運営は studentId を渡す */
export async function bookMeeting(input: { date: string; time: string; studentId?: string }): Promise<Result<{ id: string }>> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const v = z.object({ date: zDate, time: zTime, studentId: zId.optional() }).parse(input);
    const { data, error } = await sb.rpc('book_meeting', { p_on_date: v.date, p_start: v.time, p_student: actor.role === 'student' ? null : v.studentId ?? null, p_coach: null });
    if (error) return fail(dbError(error));
    done();
    const { data: m } = await sb.from('meetings').select('length_min').eq('id', data as string).maybeSingle();
    const end = toTime(toMin(v.time) + (m?.length_min ?? 30));
    return ok(`${mdw(v.date)} ${range(v.time, end)} で予約しました`, { id: data as string });
  });
}

export async function cancelMeeting(id: string) { return rpc('cancel_meeting', { p_meeting: zId.parse(id) }, '予約を取り消しました'); }

// ---------- ファイル（期限つきのURL） ----------
/** 予定に付いた小テストの問題・解答を開く。その予定が見えるか（RLS）を確かめてから、サーバがURLを作る */
export async function openQuizFile(input: { taskId: string; which: 'problem' | 'answer' }): Promise<Result<{ url: string }>> {
  return withActor(['student', 'coach', 'admin'], async ({ sb }) => {
    const v = z.object({ taskId: zId, which: z.enum(['problem', 'answer']) }).parse(input);
    const { data: t } = await sb.from('tasks').select('quiz_version_id').eq('id', v.taskId).maybeSingle();
    if (!t?.quiz_version_id) return fail('この予定に小テストは付いていません');
    const admin = createAdminClient();
    const { data: q } = await admin.from('quiz_versions').select('problem_path, answer_path').eq('id', t.quiz_version_id).maybeSingle();
    if (!q) return fail('小テストが見つかりません');
    const { data: url, error } = await admin.storage.from('quiz-pdfs').createSignedUrl(v.which === 'problem' ? q.problem_path : q.answer_path, env.signedUrlSeconds());
    if (error || !url) return fail('ファイルを開けませんでした');
    return ok(undefined, { url: url.signedUrl });
  });
}

/** 配られた資料を開く（自分あて・全員あての資料だけ。RLS で確かめる） */
export async function openResource(id: string): Promise<Result<{ url: string }>> {
  return withActor(['student', 'coach', 'admin'], async ({ sb }) => {
    const { data: r } = await sb.from('resources').select('file_path').eq('id', zId.parse(id)).maybeSingle();
    if (!r) return fail('資料が見つかりません');
    const { data: url, error } = await createAdminClient().storage.from('resources').createSignedUrl(r.file_path, env.signedUrlSeconds());
    if (error || !url) return fail('ファイルを開けませんでした');
    return ok(undefined, { url: url.signedUrl });
  });
}

// ---------- AI相談（Actifyくん） ----------
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

/**
 * 生徒の相談を保存し、Actifyくんの返事を書いて返す。
 * 写真は先に chat-images/{塾}/{生徒}/… へ置いてから、そのパスを渡す（RLS で自分のフォルダだけ）
 */
export async function sendChat(input: { text: string; imagePath?: string }): Promise<Result<{ reply: string; mood: string }>> {
  return withActor(['student'], async ({ sb, actor }) => {
    const v = z.object({ text: z.string().max(2000), imagePath: z.string().max(300).optional() }).parse(input);
    const text = v.text.trim();
    if (!text && !v.imagePath) return fail('聞きたいことを書いてください');
    if (v.imagePath && !v.imagePath.startsWith(`${actor.schoolId}/${actor.id}/`)) return fail('写真の場所が正しくありません');

    const { error: e1 } = await sb.from('chat_messages').insert({ student_id: actor.id, sender: 'student', body: text, image_path: v.imagePath ?? null });
    if (e1) return fail(dbError(e1));

    const [{ data: hist }, world, me] = await Promise.all([
      sb.from('chat_messages').select('sender, body').eq('student_id', actor.id).order('id', { ascending: false }).limit(21),
      loadWorld(sb, actor, [actor.id]),
      loadStudents(sb, actor).then(x => x[0]),
    ]);
    const { data: ca } = await sb.from('coach_assignments').select('coach_id').eq('student_id', actor.id).order('created_at').limit(1).maybeSingle();
    const coachName = ca ? (await sb.from('profiles').select('display_name').eq('id', ca.coach_id).maybeSingle()).data?.display_name : undefined;

    let image: { mediaType: (typeof IMAGE_TYPES)[number]; base64: string } | undefined;
    const admin = createAdminClient();
    if (v.imagePath) {
      const { data: blob } = await admin.storage.from('chat-images').download(v.imagePath);
      const type = blob?.type as (typeof IMAGE_TYPES)[number];
      if (blob && IMAGE_TYPES.includes(type) && blob.size <= 5 * 1024 * 1024) image = { mediaType: type, base64: Buffer.from(await blob.arrayBuffer()).toString('base64') };
    }
    const history = (hist ?? []).reverse().slice(0, -1).map(h => ({ sender: h.sender as 'student' | 'bot', body: h.body }));
    const r = await botReply({
      world, studentId: actor.id, history, text, image,
      info: { name: me?.name ?? '', goal: me ? `${me.goalSchool} ${me.goalFaculty}`.trim() : undefined, examOn: me?.examOn, coachName: coachName ? `${coachName}先生` : undefined },
    });
    // 返事と原価はサーバが書く（生徒は Actifyくんの発言を書けない）
    await admin.from('chat_messages').insert({ school_id: actor.schoolId, student_id: actor.id, sender: 'bot', body: r.reply.text, mood: r.reply.mood });
    if (r.call) await admin.from('ai_calls').insert({ school_id: actor.schoolId, user_id: actor.id, purpose: 'chat', model: r.call.model, prompt_version: r.call.promptVersion, input_tokens: r.call.inputTokens, output_tokens: r.call.outputTokens, cost_jpy: r.call.costJpy, error: r.call.error ?? null });
    return ok(undefined, { reply: r.reply.text, mood: r.reply.mood });
  });
}

/** 目標・プロフィール（読むだけ。目標は面談で先生と決める） */
export async function myProfile(): Promise<Result<{ name: string; grade: string; goal: string; examOn: string | null; books: { name: string; target: string }[]; botName: string }>> {
  return withActor(['student'], async ({ sb, actor }) => {
    const [me] = await loadStudents(sb, actor);
    const w = await loadWorld(sb, actor, [actor.id]);
    return ok(undefined, {
      name: me?.name ?? actor.name, grade: me?.grade ?? '', goal: me ? `${me.goalSchool} ${me.goalFaculty}`.trim() : '', examOn: me?.examOn ?? null, botName: BOT_NAME,
      books: w.books.map(b => ({ name: mat(w, b.materialId)?.name ?? '', target: b.target })),
    });
  });
}
