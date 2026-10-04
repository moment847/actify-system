import 'server-only';
// Web Push（端末への通知）。iPhone はホーム画面に追加したアプリ（iOS 16.4 以降）だけが受け取れる。
import webpush from 'web-push';
import { env } from '@/lib/env';

export const pushConfigured = () => !!(env.vapidPublicKey() && env.vapidPrivateKey());

let ready = false;
function setup() {
  if (ready) return;
  webpush.setVapidDetails(env.vapidSubject(), env.vapidPublicKey()!, env.vapidPrivateKey()!);
  ready = true;
}

export type PushResult = 'sent' | 'gone' | 'error';

/** 1台に送る。購読が切れている（404/410）なら 'gone'（購読を消す） */
export async function sendPush(sub: { endpoint: string; p256dh: string; auth_key: string }, payload: { title: string; body: string; url: string; tag: string }): Promise<PushResult> {
  setup();
  try {
    await webpush.sendNotification({ endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth_key } }, JSON.stringify(payload), { TTL: 60 * 60 * 12, urgency: 'normal', timeout: 10_000 });
    return 'sent';
  } catch (e) {
    const status = (e as { statusCode?: number }).statusCode;
    return status === 404 || status === 410 ? 'gone' : 'error';
  }
}
