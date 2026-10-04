import 'server-only';
// 端末への通知（Web Push）。5分ごとの定期処理から：
// 1. DB の enqueue_due_notifications で、時刻で決まる通知（予定の15分前・記録のし忘れ・明日の面談）を作る
// 2. まだ端末に送っていない通知を送る。「通知しない時間」の人には送らず、明けてから送る（古くなったものは送らない）
// アプリの中の通知（ベル）は、端末に送るかどうかに関係なく残る
import type { SupabaseClient } from '@supabase/supabase-js';
import { inQuietHours, localTime, pushExpired } from '@/lib/domain/notify';
import { pushConfigured, sendPush } from '@/lib/integrations/web-push';

export interface PushRun { created: number; sent: number; held: number; dropped: number; gone: number }
const BATCH = 500;

export async function runPushNotifications(admin: SupabaseClient, now = new Date()): Promise<PushRun> {
  const { data: created, error } = await admin.rpc('enqueue_due_notifications');
  if (error) throw new Error(error.message);
  const out: PushRun = { created: Number(created ?? 0), sent: 0, held: 0, dropped: 0, gone: 0 };

  const since = new Date(now.getTime() - 24 * 36e5).toISOString();
  const { data: rows } = await admin.from('notifications').select('id, user_id, kind, title, body, url, created_at')
    .is('pushed_at', null).gte('created_at', since).order('created_at').limit(BATCH);
  if (!rows?.length) return out;
  const users = [...new Set(rows.map(r => r.user_id))];
  const [{ data: subs }, { data: prefs }, { data: people }] = await Promise.all([
    admin.from('push_subscriptions').select('id, user_id, endpoint, p256dh, auth_key').in('user_id', users),
    admin.from('notification_prefs').select('user_id, quiet_start, quiet_end').in('user_id', users),
    admin.from('profiles').select('id, timezone, schools(timezone)').in('id', users),
  ]);
  const handled: number[] = [];
  const goneIds = new Set<string>();
  for (const n of rows) {
    const mine = (subs ?? []).filter(s => s.user_id === n.user_id && !goneIds.has(s.id));
    if (!mine.length || !pushConfigured() || pushExpired(n.kind, n.created_at, now)) { handled.push(n.id); out.dropped++; continue; }
    const pref = prefs?.find(p => p.user_id === n.user_id);
    const person = people?.find(p => p.id === n.user_id);
    const school = (Array.isArray(person?.schools) ? person?.schools[0] : person?.schools) as { timezone: string } | undefined;
    const tz = person?.timezone || school?.timezone || 'Asia/Tokyo';
    if (inQuietHours(localTime(tz, now), (pref?.quiet_start ?? '23:00').slice(0, 5), (pref?.quiet_end ?? '07:00').slice(0, 5))) { out.held++; continue; }
    for (const s of mine) {
      const r = await sendPush(s, { title: n.title, body: n.body, url: n.url, tag: `${n.kind}:${n.id}` });
      if (r === 'gone') { goneIds.add(s.id); out.gone++; }
      if (r === 'sent') out.sent++;
    }
    handled.push(n.id);
  }
  if (goneIds.size) await admin.from('push_subscriptions').delete().in('id', [...goneIds]);
  for (let i = 0; i < handled.length; i += 300) await admin.from('notifications').update({ pushed_at: now.toISOString() }).in('id', handled.slice(i, i + 300));
  return out;
}
