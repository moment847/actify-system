import 'server-only';
// 端末への通知（Web Push）。5分ごとの定期処理から：
// 1. DB の enqueue_due_notifications で、時刻で決まる通知（予定の15分前・記録のし忘れ・明日の面談）を作る
// 2. まだ端末に送っていない通知を送る。「通知しない時間」の人には送らず、明けてから送る（古くなったものは送らない）
// アプリの中の通知（ベル）は、端末に送るかどうかに関係なく残る
//
// 2026-10-10 の直し：
// - 送った印（pushed_at）を最後にまとめて付けていたので、関数が時間切れで切られると同じ通知を5分ごとに送り直していた。
//   いくつか送るたびに印を付け、時間の予算（PUSH_RUN_BUDGET_MS）で手前で止める
// - 「通知しない時間」で待たせた通知は push_after で後ろに回す（以前は毎回先頭に来て、500件たまると誰にも送れなくなった）
// - 送れなかった通知（5xx・時間切れ）は5分あけて送り直す（3回まで）
// - 端末の登録は1,000行ずつ読む（PostgREST は1回に1,000行まで。超えた分の人を「端末なし」として捨てていた）
import type { SupabaseClient } from '@supabase/supabase-js';
import { inQuietHours, localTime, pushExpired } from '@/lib/domain/notify';
import { pushConfigured, sendPush } from '@/lib/integrations/web-push';

export interface PushRun { created: number; sent: number; held: number; dropped: number; gone: number; retry: number; timedOut: boolean }
const BATCH = 500;
/** 定期処理の関数は 60 秒で切られる（route の maxDuration）。手前で止めて、残りは次の回（5分後）に送る */
export const PUSH_RUN_BUDGET_MS = 40_000;
const CONCURRENCY = 8;
const MAX_ATTEMPTS = 3;
const HOLD_MS = 15 * 60_000, RETRY_MS = 5 * 60_000;

async function all<T>(make: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) return out;
  }
}

export async function runPushNotifications(admin: SupabaseClient, now = new Date(), budgetMs = PUSH_RUN_BUDGET_MS): Promise<PushRun> {
  const started = Date.now();
  const { data: created, error } = await admin.rpc('enqueue_due_notifications');
  if (error) throw new Error(error.message);
  const out: PushRun = { created: Number(created ?? 0), sent: 0, held: 0, dropped: 0, gone: 0, retry: 0, timedOut: false };

  const nowIso = now.toISOString();
  const since = new Date(now.getTime() - 24 * 36e5).toISOString();
  const { data: rows, error: qerr } = await admin.from('notifications').select('id, user_id, kind, title, body, url, created_at, push_attempts')
    .is('pushed_at', null).gte('created_at', since).or(`push_after.is.null,push_after.lte.${nowIso}`)
    .order('created_at').limit(BATCH);
  if (qerr) throw new Error(qerr.message);
  if (!rows?.length) return out;
  const users = [...new Set(rows.map(r => r.user_id))];
  const [subs, prefs, people] = await Promise.all([
    all<{ id: string; user_id: string; endpoint: string; p256dh: string; auth_key: string }>((a, b) => admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth_key').in('user_id', users).order('id').range(a, b)),
    all<{ user_id: string; quiet_start: string | null; quiet_end: string | null }>((a, b) => admin.from('notification_prefs').select('user_id, quiet_start, quiet_end').in('user_id', users).order('user_id').range(a, b)),
    all<{ id: string; timezone: string | null; schools: unknown }>((a, b) => admin.from('profiles').select('id, timezone, schools(timezone)').in('id', users).order('id').range(a, b)),
  ]);

  // 結果は少しずつ DB に書く（途中で切られても、送った分は二度送らない）
  const done: number[] = [], later = new Map<number, { push_after: string; push_attempts: number }>();
  const goneIds = new Set<string>();
  const flush = async () => {
    const ids = done.splice(0);
    for (let i = 0; i < ids.length; i += 300) {
      const { error: e } = await admin.from('notifications').update({ pushed_at: nowIso }).in('id', ids.slice(i, i + 300));
      if (e) throw new Error(e.message);
    }
    for (const [id, v] of [...later]) { later.delete(id); await admin.from('notifications').update(v).eq('id', id); }
    if (goneIds.size) { const g = [...goneIds]; goneIds.clear(); await admin.from('push_subscriptions').delete().in('id', g); }
  };
  const dead = new Set<string>();

  const handle = async (n: (typeof rows)[number]) => {
    const mine = subs.filter(s => s.user_id === n.user_id && !dead.has(s.id));
    if (!mine.length || !pushConfigured() || pushExpired(n.kind, n.created_at, now)) { done.push(n.id); out.dropped++; return; }
    const pref = prefs.find(p => p.user_id === n.user_id);
    const person = people.find(p => p.id === n.user_id);
    const school = (Array.isArray(person?.schools) ? person?.schools[0] : person?.schools) as { timezone: string } | undefined;
    const tz = person?.timezone || school?.timezone || 'Asia/Tokyo';
    if (inQuietHours(localTime(tz, now), (pref?.quiet_start ?? '23:00').slice(0, 5), (pref?.quiet_end ?? '07:00').slice(0, 5))) {
      later.set(n.id, { push_after: new Date(now.getTime() + HOLD_MS).toISOString(), push_attempts: n.push_attempts ?? 0 });
      out.held++; return;
    }
    let sent = false, failed = false;
    for (const s of mine) {
      const r = await sendPush(s, { title: n.title, body: n.body, url: n.url, tag: `${n.kind}:${n.id}` });
      if (r === 'gone') { dead.add(s.id); goneIds.add(s.id); out.gone++; }
      else if (r === 'sent') { sent = true; out.sent++; }
      else failed = true;
    }
    // どの端末にも届かず、一時的な失敗があったら送り直す（3回まで）。1台でも届いたら済み
    const attempts = (n.push_attempts ?? 0) + 1;
    if (!sent && failed && attempts < MAX_ATTEMPTS) { later.set(n.id, { push_after: new Date(now.getTime() + RETRY_MS).toISOString(), push_attempts: attempts }); out.retry++; }
    else done.push(n.id);
  };

  let next = 0;
  const worker = async () => {
    while (next < rows.length) {
      if (Date.now() - started > budgetMs) { out.timedOut = true; return; }
      await handle(rows[next++]);
      if (done.length + later.size >= 50) await flush();
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  await flush();
  return out;
}
