'use client';
// ブラウザ側：この端末で通知を受け取る／止める。iPhone はホーム画面に追加して開いたときだけ使える
import { subscribePush, unsubscribePush } from '@/app/actions/notifications';

export type PushSupport = 'ok' | 'needs-home-screen' | 'unsupported' | 'denied';

export function pushSupport(): PushSupport {
  if (typeof window === 'undefined') return 'unsupported';
  const ios = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (ios && !standalone) return 'needs-home-screen';
  if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ok';
}

const b64ToBytes = (b64: string) => {
  const s = atob((b64 + '='.repeat((4 - (b64.length % 4)) % 4)).replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(s, c => c.charCodeAt(0));
};

/** ボタンを押したときに呼ぶ（通知の許可はユーザーの操作の中で求める必要がある） */
export async function enablePush(vapidPublicKey: string) {
  const reg = await navigator.serviceWorker.register('/sw.js');
  if ((await Notification.requestPermission()) !== 'granted') return { ok: false as const, error: '通知が許可されませんでした。端末の設定から Actify の通知をオンにしてください' };
  const sub = (await reg.pushManager.getSubscription()) ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(vapidPublicKey) }));
  const json = sub.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
  return subscribePush({ subscription: json, userAgent: navigator.userAgent.slice(0, 300) });
}

/** この端末への通知を止める（ログアウトの前にも呼ぶ。共用の端末でほかの人の通知が届かないように） */
export async function disablePush() {
  const reg = await navigator.serviceWorker?.getRegistration('/sw.js');
  const sub = await reg?.pushManager.getSubscription();
  if (!sub) return;
  await unsubscribePush(sub.endpoint);
  await sub.unsubscribe();
}
