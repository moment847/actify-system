// 外から届く Webhook の署名を確かめる（LINE・Stripe）。鍵は呼ぶ側が渡す（ここでは環境変数を読まない）。
import { createHmac, timingSafeEqual } from 'node:crypto';

const same = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
};

/** LINE：x-line-signature ＝ 本文の HMAC-SHA256（鍵はチャネルシークレット）を base64 にしたもの */
export function verifyLineSignature(rawBody: string, signature: string | null, channelSecret: string): boolean {
  if (!signature) return false;
  return same(createHmac('sha256', channelSecret).update(rawBody).digest('base64'), signature);
}

/**
 * Stripe：Stripe-Signature: t=時刻,v1=署名[,v1=…]。署名は `${t}.${本文}` の HMAC-SHA256（16進）。
 * 古い送信の使い回しを防ぐため、時刻が今から tolerance 秒より離れていたら断る（Stripe の公式ライブラリと同じ既定 300 秒）
 */
export function verifyStripeSignature(rawBody: string, header: string | null, secret: string, now = Date.now(), toleranceSec = 300): boolean {
  if (!header) return false;
  const parts = header.split(',').map(p => p.trim().split('='));
  const t = parts.find(([k]) => k === 't')?.[1];
  const sigs = parts.filter(([k]) => k === 'v1').map(([, v]) => v ?? '');
  if (!t || !/^\d+$/.test(t) || !sigs.length) return false;
  if (Math.abs(now / 1000 - Number(t)) > toleranceSec) return false;
  const expected = createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  return sigs.some(s => same(expected, s));
}
