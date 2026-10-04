'use server';
// 運営（塾の admin）の操作：教材（目次の写真から登録）とアカウント
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { readToc } from '@/lib/ai/toc-ocr';
import { pathIn } from '@/lib/domain/paths';
import { env } from '@/lib/env';
import { reserveAi, settleAi, type AiBlock } from '@/server/ai-budget';
import { parsePastedBooks } from '@/lib/domain/materials';
import { createAdminClient } from '@/lib/supabase/admin';
import { dateAdd, localToday, weekStart } from '@/lib/domain/dates';
import { schoolMetrics, type SchoolMetrics } from '@/lib/domain/metrics';
import { seal } from '@/lib/integrations/secret-box';
import { createCheckout, createCustomer, createPortal } from '@/lib/integrations/stripe';
import { countSeats } from '@/server/billing';
import { changed, dbError, fail, ok, withActor, zId, type Result } from '@/server/result';

const done = () => revalidatePath('/', 'layout');
const zSubject = z.enum(['english', 'math', 'japanese', 'science', 'social', 'other']);
const zKind = z.enum(['input', 'practice']);
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export interface TocDraft { name: string; subject: z.infer<typeof zSubject>; kind: z.infer<typeof zKind>; lines: string[]; imagePath: string | null; unread: boolean }

/**
 * 目次の写真を読み取って、登録前の下書きにする（1枚1冊）。写真は先に toc-images/{塾}/… へ置いておく。
 * AI のキーが無い・読めなかった写真は、空の下書き（手で入れる）にする
 */
export async function readTocImages(input: { paths: string[] }): Promise<Result<{ drafts: TocDraft[] }>> {
  return withActor(['admin'], async ({ actor }) => {
    const v = z.object({ paths: z.array(z.string().max(300)).min(1).max(30) }).parse(input);
    if (v.paths.some(p => !pathIn(p, actor.schoolId + '/'))) return fail('写真の場所が正しくありません');
    const admin = createAdminClient(), drafts: TocDraft[] = [];
    let stop: AiBlock | null = env.anthropicApiKey() ? null : 'unknown';
    for (const path of v.paths) {
      const fileName = path.split('/').pop()!.replace(/\.[^.]+$/, '');
      const empty: TocDraft = { name: fileName, subject: 'english', kind: 'input', lines: [], imagePath: path, unread: true };
      if (stop) { drafts.push(empty); continue; }
      const { data: blob } = await admin.storage.from('toc-images').download(path);
      const type = blob?.type as (typeof IMAGE_TYPES)[number];
      if (!blob || !IMAGE_TYPES.includes(type) || blob.size > 5 * 1024 * 1024) { drafts.push(empty); continue; }
      // 1枚ごとに枠を取る（1人1日の回数・塾の月の予算）。取れなくなったら、残りは手入力の下書きにする
      const r = await reserveAi(actor.schoolId, actor.id, 'toc_ocr', env.aiOcrEstimateJpy());
      if ('blocked' in r) { stop = r.blocked; drafts.push(empty); continue; }
      let call: Awaited<ReturnType<typeof readToc>>['call'] = null;
      try {
        const res = await readToc({ mediaType: type, base64: Buffer.from(await blob.arrayBuffer()).toString('base64') });
        call = res.call;
        drafts.push(res.result && res.result.lines.length ? { name: res.result.name || fileName, subject: res.result.subject, kind: res.result.kind, lines: res.result.lines, imagePath: path, unread: false } : empty);
      } finally {
        await settleAi(r.id, call ? { ...call, error: 'error' in call ? call.error ?? null : null } : null);
      }
    }
    if (stop && stop !== 'unknown') {
      const why = stop === 'budget' ? '今月の塾の AI の利用枠を使い切りました' : stop === 'daily_limit' ? '今日の読み取りの回数を使い切りました' : '前の読み取りが終わっていません';
      return ok(`${why}。読み取れなかった写真は、範囲を1行ずつ入れてください`, { drafts });
    }
    const unread = drafts.filter(d => d.unread).length;
    return ok(unread ? `${unread}枚は読み取れませんでした。範囲を1行ずつ入れてください` : `${drafts.length}冊を読み取りました。直してから登録してください`, { drafts });
  });
}

/** Excel の表（教材名・範囲の2列）から下書きを作る */
export async function draftsFromPaste(input: { text: string }): Promise<Result<{ drafts: TocDraft[] }>> {
  return withActor(['admin'], async () => {
    const books = parsePastedBooks(z.object({ text: z.string().max(200_000) }).parse(input).text);
    if (!books.length) return fail('「教材名」「範囲」の2列を貼り付けてください');
    return ok(undefined, { drafts: books.map(b => ({ name: b.name, subject: 'english' as const, kind: 'input' as const, lines: b.lines, imagePath: null, unread: false })) });
  });
}

const Draft = z.object({ name: z.string().trim().min(1, '教材名を入れてください').max(100), subject: zSubject, kind: zKind, lines: z.array(z.string().trim().min(1).max(120)).min(1, '目次が空です').max(500), imagePath: z.string().max(300).nullish() });

/** 確認した下書きを、教材として登録する */
export async function registerMaterials(input: { drafts: z.input<typeof Draft>[] }): Promise<Result<{ count: number }>> {
  return withActor(['admin'], async ({ sb, actor }) => {
    const v = z.object({ drafts: z.array(Draft).min(1).max(50) }).parse(input);
    if (v.drafts.some(d => d.imagePath && !pathIn(d.imagePath, actor.schoolId + '/'))) return fail('写真の場所が正しくありません');
    for (const d of v.drafts) {
      const { data: m, error } = await sb.from('materials').insert({
        name: d.name, short_name: d.name.slice(0, 8), subject: d.subject, kind: d.kind,
        review_intervals: d.kind === 'input' ? [1, 7, 30] : [], keywords: [], toc_image_path: d.imagePath ?? null,
      }).select('id').single();
      if (error) return fail(dbError(error));
      const { error: e2 } = await sb.from('material_units').insert(d.lines.map((label, i) => ({ material_id: m.id, seq: i + 1, label })));
      if (e2) { await sb.from('materials').delete().eq('id', m.id); return fail(dbError(e2)); }
    }
    done();
    return ok(`${v.drafts.length}冊を登録しました。講師の計画と小テストの振り分けで使えます`, { count: v.drafts.length });
  });
}

/** 教材の名前・略称・科目・種類・再テストの間隔 */
export async function updateMaterial(input: { id: string; name: string; short: string; subject: z.infer<typeof zSubject>; kind: z.infer<typeof zKind>; intervals: number[]; keywords?: string[] }): Promise<Result> {
  return withActor(['admin'], async ({ sb }) => {
    const v = z.object({ id: zId, name: z.string().trim().min(1).max(100), short: z.string().trim().min(1).max(30), subject: zSubject, kind: zKind,
      intervals: z.array(z.number().int().min(1).max(365)).max(10), keywords: z.array(z.string().trim().min(2).max(40)).max(20).optional() }).parse(input);
    const intervals = v.kind === 'input' ? (v.intervals.length ? v.intervals : [1, 7, 30]) : [];
    const bad = changed(await sb.from('materials').update({ name: v.name, short_name: v.short, subject: v.subject, kind: v.kind, review_intervals: intervals, ...(v.keywords ? { keywords: v.keywords } : {}) }, { count: 'exact' }).eq('id', v.id), '教材が見つかりません');
    if (bad) return fail(bad);
    done(); return ok('保存しました');
  });
}

/**
 * 目次を直す（1行＝1範囲。行の順番が範囲の順番）。予定や小テストで使っている範囲は、行を消せない（名前は直せる）。
 * 消せない範囲は DB の外部キーが止める
 */
export async function updateMaterialUnits(input: { id: string; lines: string[] }): Promise<Result> {
  return withActor(['admin'], async ({ sb }) => {
    const v = z.object({ id: zId, lines: z.array(z.string().trim().min(1).max(120)).min(1).max(500) }).parse(input);
    const { data: units, error: e1 } = await sb.from('material_units').select('id, seq, label').eq('material_id', v.id).order('seq');
    if (e1) return fail(dbError(e1));
    const cur = units ?? [];
    if (!cur.length) return fail('教材が見つかりません');
    const removed = cur.slice(v.lines.length);
    if (removed.length) {
      const ids = removed.map(u => u.id);
      const [{ count: usedT }, { count: usedQ }] = await Promise.all([
        sb.from('tasks').select('id', { count: 'exact', head: true }).in('unit_id', ids),
        sb.from('quiz_versions').select('id', { count: 'exact', head: true }).in('unit_id', ids),
      ]);
      if ((usedT ?? 0) + (usedQ ?? 0) > 0) return fail('予定や小テストで使っている範囲は、行を消せません（名前は直せます）');
      const { error } = await sb.from('material_units').delete().in('id', ids);
      if (error) return fail(dbError(error));
    }
    for (let i = 0; i < Math.min(cur.length, v.lines.length); i++) {
      if (cur[i].label === v.lines[i]) continue;
      const { error } = await sb.from('material_units').update({ label: v.lines[i] }).eq('id', cur[i].id);
      if (error) return fail(dbError(error));
    }
    if (v.lines.length > cur.length) {
      const { error } = await sb.from('material_units').insert(v.lines.slice(cur.length).map((label, i) => ({ material_id: v.id, seq: cur.length + i + 1, label })));
      if (error) return fail(dbError(error));
    }
    done(); return ok('保存しました');
  });
}

export async function deleteMaterial(id: string): Promise<Result> {
  return withActor(['admin'], async ({ sb }) => {
    const r = await sb.from('materials').delete({ count: 'exact' }).eq('id', zId.parse(id));
    if (r.error) return fail(r.error.code === '23503' ? '予定・小テスト・担当の参考書で使っている教材は消せません' : dbError(r.error));
    if (!r.count) return fail('教材が見つかりません');
    done(); return ok('削除しました');
  });
}

// ---------- アカウント ----------
const NewAccount = z.object({ email: z.string().trim().email('メールアドレスの形が正しくありません'), name: z.string().trim().min(1, '名前を入れてください').max(60),
  role: z.enum(['student', 'coach', 'admin']), grade: z.string().trim().max(30).optional(), coachId: zId.optional() });

/**
 * アカウントを作り、招待のメールを送る（本人がパスワードを決める）。
 * 途中で失敗したら、作った認証ユーザーを消して元に戻す（同じメールで作り直せるように）
 */
export async function createAccount(input: z.input<typeof NewAccount>): Promise<Result<{ id: string }>> {
  return withActor(['admin'], async ({ actor }) => {
    const v = NewAccount.parse(input);
    const admin = createAdminClient();
    // 招待のメールのリンクは /auth/confirm（token_hash を verifyOtp で確かめる）。メールの文面は supabase/templates/invite.html
    const { data, error } = await admin.auth.admin.inviteUserByEmail(v.email, { redirectTo: `${env.siteUrl()}/account/password` });
    if (error || !data.user) return fail(error?.message?.includes('already') ? 'このメールアドレスはもう使われています' : '招待のメールを送れませんでした');
    const uid = data.user.id;
    const undo = async (why: string) => { await admin.auth.admin.deleteUser(uid); return fail(why); };
    const { error: e1 } = await admin.from('profiles').insert({ id: uid, school_id: actor.schoolId, role: v.role, display_name: v.name });
    if (e1) return undo(dbError(e1));
    if (v.role === 'student') {
      const { error: e2 } = await admin.from('students').insert({ id: uid, school_id: actor.schoolId, grade: v.grade ?? '' });
      if (e2) { await admin.from('profiles').delete().eq('id', uid); return undo(dbError(e2)); }
      await admin.from('coach_notes').insert({ student_id: uid, school_id: actor.schoolId, memo: '' });
      if (v.coachId) {
        const { data: c } = await admin.from('profiles').select('school_id, role').eq('id', v.coachId).maybeSingle();
        if (c?.school_id === actor.schoolId && c.role === 'coach') await admin.from('coach_assignments').insert({ coach_id: v.coachId, student_id: uid, school_id: actor.schoolId });
      }
    }
    if (v.role === 'coach') await admin.from('booking_settings').insert({ coach_id: uid, school_id: actor.schoolId });
    done();
    return ok(`${v.name}さんを追加して、招待のメールを送りました`, { id: uid });
  });
}

/** 役割と状態（在籍・休会・退会）。自分の役割は変えられない（DB のトリガでも止める） */
export async function updateAccount(input: { id: string; role?: 'student' | 'coach' | 'admin'; status?: 'active' | 'paused' | 'withdrawn'; name?: string; grade?: string }): Promise<Result> {
  return withActor(['admin'], async ({ sb }) => {
    const v = z.object({ id: zId, role: z.enum(['student', 'coach', 'admin']).optional(), status: z.enum(['active', 'paused', 'withdrawn']).optional(), name: z.string().trim().min(1).max(60).optional(), grade: z.string().trim().max(30).optional() }).parse(input);
    const patch: Record<string, unknown> = {};
    if (v.role) patch.role = v.role;
    if (v.status) patch.status = v.status;
    if (v.name) patch.display_name = v.name;
    if (Object.keys(patch).length) { const bad = changed(await sb.from('profiles').update(patch, { count: 'exact' }).eq('id', v.id), 'アカウントが見つかりません'); if (bad) return fail(bad); }
    if (v.grade !== undefined) { const bad = changed(await sb.from('students').update({ grade: v.grade }, { count: 'exact' }).eq('id', v.id), '生徒が見つかりません'); if (bad) return fail(bad); }
    done();
    return ok(v.status === 'withdrawn' ? '退会にしました（講師の担当一覧から外れます）' : '保存しました');
  });
}

/** 生徒の担当の講師をつける・外す */
export async function assignCoach(input: { coachId: string; studentId: string; assign: boolean }): Promise<Result> {
  return withActor(['admin'], async ({ sb }) => {
    const v = z.object({ coachId: zId, studentId: zId, assign: z.boolean() }).parse(input);
    const q = v.assign
      ? sb.from('coach_assignments').insert({ coach_id: v.coachId, student_id: v.studentId })
      : sb.from('coach_assignments').delete({ count: 'exact' }).eq('coach_id', v.coachId).eq('student_id', v.studentId);
    const r = await q;
    if (r.error) return fail(dbError(r.error));
    if (!v.assign && !r.count) return fail('担当ではありません');
    done(); return ok(v.assign ? '担当にしました' : '担当から外しました');
  });
}

/** AI の原価（円）。この塾の月ごと・用途ごと */
export async function aiCostSummary(): Promise<Result<{ month: string; purpose: string; calls: number; costJpy: number; errors: number }[]>> {
  return withActor(['admin'], async ({ sb, actor }) => {
    const { data, error } = await sb.from('ai_calls').select('purpose, cost_jpy, error, created_at').order('created_at', { ascending: false }).limit(5000);
    if (error) return fail(dbError(error));
    const m = new Map<string, { month: string; purpose: string; calls: number; costJpy: number; errors: number }>();
    for (const r of data ?? []) {
      const month = new Intl.DateTimeFormat('en-CA', { timeZone: actor.timeZone, year: 'numeric', month: '2-digit' }).format(new Date(r.created_at));
      const k = month + r.purpose, x = m.get(k) ?? { month, purpose: r.purpose, calls: 0, costJpy: 0, errors: 0 };
      x.calls++; x.costJpy += r.cost_jpy; if (r.error) x.errors++; m.set(k, x);
    }
    return ok(undefined, [...m.values()]);
  });
}

// ---------- 主担当・副担当 ----------
/** 主担当を決める（面談の予約・返信待ちの数は主担当に入る）。その講師がまだ担当でなければ先に担当にする */
export async function setMainCoach(input: { studentId: string; coachId: string }): Promise<Result> {
  return withActor(['admin'], async ({ sb }) => {
    const v = z.object({ studentId: zId, coachId: zId }).parse(input);
    const { data: has } = await sb.from('coach_assignments').select('coach_id').eq('student_id', v.studentId).eq('coach_id', v.coachId).maybeSingle();
    if (!has) { const { error } = await sb.from('coach_assignments').insert({ coach_id: v.coachId, student_id: v.studentId }); if (error) return fail(dbError(error)); }
    const { error } = await sb.rpc('set_main_coach', { p_student: v.studentId, p_coach: v.coachId });
    if (error) return fail(dbError(error));
    done(); return ok('主担当にしました');
  });
}

// ---------- 塾の LINE 公式アカウント ----------
const LineSettings = z.object({
  basicId: z.string().trim().toLowerCase().regex(/^@[a-z0-9._-]{2,30}$/, 'ベーシックID は @ から始まる形で入れてください（例：@123abcde）'),
  channelSecret: z.string().trim().regex(/^[0-9a-f]{32}$/i, 'チャネルシークレットは32文字の英数字です').optional(),
  accessToken: z.string().trim().min(100, 'チャネルアクセストークン（長期）を貼り付けてください').max(400).optional(),
});

/**
 * LINE の設定（LINE Official Account Manager と LINE Developers で作った値）。
 * 鍵は暗号にして service_role だけが読める表に置く。画面には「入っているか」しか返さない
 */
export async function saveLineSettings(input: z.input<typeof LineSettings>): Promise<Result<{ webhookUrl: string }>> {
  return withActor(['admin'], async ({ sb, actor }) => {
    const v = LineSettings.parse(input);
    const bad = changed(await sb.from('schools').update({ line_basic_id: v.basicId }, { count: 'exact' }).eq('id', actor.schoolId), '塾が見つかりません');
    if (bad) return fail(bad);
    if (v.channelSecret || v.accessToken) {
      const admin = createAdminClient();
      const { data: cur } = await admin.from('school_line_channels').select('channel_secret_enc, access_token_enc').eq('school_id', actor.schoolId).maybeSingle();
      if (!cur && !(v.channelSecret && v.accessToken)) return fail('はじめはチャネルシークレットとアクセストークンの両方を入れてください');
      const { error } = await admin.from('school_line_channels').upsert({
        school_id: actor.schoolId,
        channel_secret_enc: v.channelSecret ? seal(v.channelSecret, env.secretsKey()) : cur!.channel_secret_enc,
        access_token_enc: v.accessToken ? seal(v.accessToken, env.secretsKey()) : cur!.access_token_enc,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'school_id' });
      if (error) return fail(dbError(error));
    }
    done();
    return ok('保存しました。LINE Developers の Webhook URL に下の URL を入れ、「Webhook の利用」をオンにしてください', { webhookUrl: `${env.siteUrl()}/api/line/webhook/${actor.schoolId}` });
  });
}

// ---------- 運営の数字 ----------
export async function schoolMetricsView(): Promise<Result<SchoolMetrics>> {
  return withActor(['admin'], async ({ sb, actor }) => {
    const since = dateAdd(weekStart(actor.today), -7 * 8);
    const sinceTs = new Date(Date.parse(since + 'T00:00:00Z') - 864e5).toISOString();
    const [{ data: people }, { data: ca }, tasks, feedback, replies] = await Promise.all([
      sb.from('profiles').select('id, role, display_name, status, created_at, timezone').in('role', ['student', 'coach']).eq('status', 'active'),
      sb.from('coach_assignments').select('coach_id, student_id, is_main'),
      pages<{ student_id: string; on_date: string }>((a, b) => sb.from('tasks').select('student_id, on_date').eq('status', 'done').gte('on_date', since).range(a, b)),
      pages<{ task_id: string; student_id: string; created_at: string }>((a, b) => sb.from('task_feedback').select('task_id, student_id, created_at').gte('created_at', sinceTs).range(a, b)),
      pages<{ task_id: string; coach_id: string | null; created_at: string }>((a, b) => sb.from('task_replies').select('task_id, coach_id, created_at').gte('created_at', sinceTs).range(a, b)),
    ]);
    const students = (people ?? []).filter(p => p.role === 'student').map(p => ({
      id: p.id, name: p.display_name, joinedOn: localToday(p.timezone || actor.timeZone, new Date(p.created_at)),
      coachIds: (ca ?? []).filter(a => a.student_id === p.id).map(a => a.coach_id),
      mainCoachId: (ca ?? []).find(a => a.student_id === p.id && a.is_main)?.coach_id ?? null,
    }));
    const doneDates = new Map<string, string[]>();
    tasks.forEach(t => doneDates.set(t.student_id, [...(doneDates.get(t.student_id) ?? []), t.on_date]));
    return ok(undefined, schoolMetrics({
      today: actor.today, now: new Date(), students,
      coaches: (people ?? []).filter(p => p.role === 'coach').map(p => ({ id: p.id, name: p.display_name })),
      doneDates,
      feedback: feedback.map(f => ({ taskId: f.task_id, studentId: f.student_id, at: f.created_at })),
      replies: replies.map(r => ({ taskId: r.task_id, coachId: r.coach_id, at: r.created_at })),
    }));
  });
}

async function pages<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

// ---------- Actify の月額（塾が払う） ----------
export interface BillingView { status: string; seats: number; activeStudents: number; currentPeriodEnd: string | null; trialEnd: string | null; cancelAtPeriodEnd: boolean; ready: boolean }

export async function billingView(): Promise<Result<BillingView>> {
  return withActor(['admin'], async ({ sb, actor }) => {
    const [{ data: b }, { count }] = await Promise.all([
      sb.from('school_billing').select('status, seats, current_period_end, trial_end, cancel_at_period_end').eq('school_id', actor.schoolId).maybeSingle(),
      sb.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'student').eq('status', 'active'),
    ]);
    return ok(undefined, { status: b?.status ?? 'none', seats: b?.seats ?? 0, activeStudents: count ?? 0, currentPeriodEnd: b?.current_period_end ?? null,
      trialEnd: b?.trial_end ?? null, cancelAtPeriodEnd: b?.cancel_at_period_end ?? false, ready: !!(env.stripeSecretKey() && env.stripePriceId()) });
  });
}

/** 契約を始める（Stripe の支払いページへ）。カードの入力は Stripe の画面で行い、Actify はカードの番号を持たない */
export async function startCheckout(): Promise<Result<{ url: string }>> {
  return withActor(['admin'], async ({ actor }) => {
    const key = env.stripeSecretKey(), price = env.stripePriceId();
    if (!key || !price) return fail('支払いの設定がまだです（Actify の運営にお問い合わせください）');
    const admin = createAdminClient();
    const { data: b } = await admin.from('school_billing').select('stripe_customer_id, stripe_subscription_id, status').eq('school_id', actor.schoolId).maybeSingle();
    if (b?.stripe_subscription_id && !['canceled', 'incomplete_expired'].includes(b.status)) return fail('もう契約しています。変更は「支払いの管理」から');
    let customer = b?.stripe_customer_id ?? null;
    if (!customer) {
      const { data: u } = await admin.auth.admin.getUserById(actor.id);
      customer = (await createCustomer(key, { name: actor.schoolName, email: u.user?.email ?? undefined, schoolId: actor.schoolId })).id;
      await admin.from('school_billing').upsert({ school_id: actor.schoolId, stripe_customer_id: customer, updated_at: new Date().toISOString() }, { onConflict: 'school_id' });
    }
    const seats = await countSeats(admin, actor.schoolId);
    // 無料期間は初めての契約だけ（解約して契約し直したときは付けない）
    const s = await createCheckout(key, { customer, price, seats, schoolId: actor.schoolId, trialDays: b?.stripe_subscription_id ? 0 : env.stripeTrialDays(),
      successUrl: `${env.siteUrl()}/admin?billing=done`, cancelUrl: `${env.siteUrl()}/admin?billing=cancel` });
    return ok(undefined, { url: s.url });
  });
}

/** 支払いの管理（カードの変更・請求書・解約）は Stripe の画面で */
export async function openBillingPortal(): Promise<Result<{ url: string }>> {
  return withActor(['admin'], async ({ actor }) => {
    const key = env.stripeSecretKey();
    if (!key) return fail('支払いの設定がまだです');
    const { data: b } = await createAdminClient().from('school_billing').select('stripe_customer_id').eq('school_id', actor.schoolId).maybeSingle();
    if (!b?.stripe_customer_id) return fail('まだ契約していません');
    const p = await createPortal(key, { customer: b.stripe_customer_id, returnUrl: `${env.siteUrl()}/admin` });
    return ok(undefined, { url: p.url });
  });
}
