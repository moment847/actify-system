'use server';
// 通知（ベル）・通知の設定・端末への通知の登録。どの役割も自分の分だけ
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { env } from '@/lib/env';
import { dbError, fail, ok, withActor, zTime, type Result } from '@/server/result';

export interface NotificationRow { id: number; kind: string; title: string; body: string; url: string; createdAt: string; read: boolean }

export async function myNotifications(limit = 50): Promise<Result<{ items: NotificationRow[]; unread: number; vapidPublicKey: string | null }>> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const n = z.number().int().min(1).max(200).parse(limit);
    const [{ data, error }, { count }] = await Promise.all([
      sb.from('notifications').select('id, kind, title, body, url, created_at, read_at').eq('user_id', actor.id).order('created_at', { ascending: false }).limit(n),
      sb.from('notifications').select('id', { count: 'exact', head: true }).eq('user_id', actor.id).is('read_at', null),
    ]);
    if (error) return fail(dbError(error));
    return ok(undefined, {
      items: (data ?? []).map(r => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, url: r.url, createdAt: r.created_at, read: !!r.read_at })),
      unread: count ?? 0, vapidPublicKey: env.vapidPublicKey(),
    });
  });
}

/** 既読にする（ids を渡さなければ全部） */
export async function markNotificationsRead(ids?: number[]): Promise<Result> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const v = z.array(z.number().int().positive()).max(500).optional().parse(ids);
    let q = sb.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', actor.id).is('read_at', null);
    if (v) q = q.in('id', v.length ? v : [0]);
    const { error } = await q;
    if (error) return fail(dbError(error));
    revalidatePath('/', 'layout');
    return ok();
  });
}

const Prefs = z.object({ taskStart: z.boolean(), missedRecord: z.boolean(), meeting: z.boolean(), reply: z.boolean(), quietStart: zTime, quietEnd: zTime });
export type NotificationPrefs = z.infer<typeof Prefs>;

export async function myNotificationPrefs(): Promise<Result<NotificationPrefs & { devices: number }>> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const [{ data }, { count }] = await Promise.all([
      sb.from('notification_prefs').select('task_start, missed_record, meeting, reply, quiet_start, quiet_end').eq('user_id', actor.id).maybeSingle(),
      sb.from('push_subscriptions').select('id', { count: 'exact', head: true }).eq('user_id', actor.id),
    ]);
    return ok(undefined, {
      taskStart: data?.task_start ?? true, missedRecord: data?.missed_record ?? true, meeting: data?.meeting ?? true, reply: data?.reply ?? true,
      quietStart: (data?.quiet_start ?? '23:00').slice(0, 5), quietEnd: (data?.quiet_end ?? '07:00').slice(0, 5), devices: count ?? 0,
    });
  });
}

export async function saveNotificationPrefs(input: NotificationPrefs): Promise<Result> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const v = Prefs.parse(input);
    const { error } = await sb.from('notification_prefs').upsert({
      user_id: actor.id, task_start: v.taskStart, missed_record: v.missedRecord, meeting: v.meeting, reply: v.reply,
      quiet_start: v.quietStart, quiet_end: v.quietEnd, updated_at: new Date().toISOString(),
    }, { onConflict: 'user_id' });
    if (error) return fail(dbError(error));
    return ok('保存しました');
  });
}

const Sub = z.object({ endpoint: z.string().url().startsWith('https://').max(1000), keys: z.object({ p256dh: z.string().min(10).max(200), auth: z.string().min(8).max(100) }) });

/** この端末で通知を受け取る（ブラウザの PushSubscription.toJSON() をそのまま渡す） */
export async function subscribePush(input: { subscription: z.input<typeof Sub>; userAgent?: string }): Promise<Result> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const v = z.object({ subscription: Sub, userAgent: z.string().max(300).optional() }).parse(input);
    // 自分の同じ端末の登録は入れ替える（鍵が変わることがある）。行の更新は許していないので、消してから入れる
    await sb.from('push_subscriptions').delete().eq('user_id', actor.id).eq('endpoint', v.subscription.endpoint);
    const { error } = await sb.from('push_subscriptions').insert({ user_id: actor.id, endpoint: v.subscription.endpoint, p256dh: v.subscription.keys.p256dh, auth_key: v.subscription.keys.auth, user_agent: v.userAgent ?? '' });
    // 同じ端末がほかの人で登録されたまま（その行は本人には見えず消せない）。ログアウトのときに外す（画面が unsubscribePush を呼ぶ）
    if (error) return fail(error.code === '23505' ? 'この端末はほかの人の通知に使われています。その人がログアウトしてから登録してください' : dbError(error));
    return ok('この端末に通知が届くようにしました');
  });
}

export async function unsubscribePush(endpoint: string): Promise<Result> {
  return withActor(['student', 'coach', 'admin'], async ({ sb, actor }) => {
    const { error } = await sb.from('push_subscriptions').delete().eq('user_id', actor.id).eq('endpoint', z.string().url().max(1000).parse(endpoint));
    if (error) return fail(dbError(error));
    return ok('この端末への通知を止めました');
  });
}
