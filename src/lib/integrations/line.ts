import 'server-only';
// LINE Messaging API（塾ごとの公式アカウント）。送るのはテキストだけ。
// - push：週の報告。月の無料通数を使う（通数は「送った相手の数」で数える）
// - reply：保護者が合言葉を送ってきたときの返事。無料（通数に数えない）
// X-Line-Retry-Key に同じ UUID を付けて送り直すと、LINE 側で一度しか届かない（定期処理が二重に動いても二重に届かない）
import { createHash } from 'node:crypto';

const API = 'https://api.line.me/v2/bot';
export const LINE_TEXT_MAX = 5000;

export class LineError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** 文字列から決まる UUID（同じ保護者・同じ週なら同じキー） */
export function retryKeyFor(seed: string): string {
  const h = createHash('sha256').update(seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${((parseInt(h[16], 16) & 3) | 8).toString(16)}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

async function call(path: string, token: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(API + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  // 409 は「同じ Retry-Key で、もう受け付けた」＝届いている
  if (res.ok || (res.status === 409 && headers['X-Line-Retry-Key'])) return;
  let msg = `LINE ${res.status}`;
  try { const j = await res.json(); if (j?.message) msg += `: ${j.message}`; } catch { /* 本文なし */ }
  throw new LineError(res.status, msg);
}

const text = (t: string) => ({ type: 'text', text: t.length > LINE_TEXT_MAX ? t.slice(0, LINE_TEXT_MAX - 1) + '…' : t });

export const pushText = (token: string, to: string, body: string, retryKey: string) =>
  call('/message/push', token, { to, messages: [text(body)] }, { 'X-Line-Retry-Key': retryKey });

export const replyText = (token: string, replyToken: string, body: string) =>
  call('/message/reply', token, { replyToken, messages: [text(body)] });

/** 月の上限に達したときの LINE の返事（429 + "You have reached your monthly limit."）を見分ける */
export const isMonthlyLimit = (e: unknown) => e instanceof LineError && e.status === 429 && /monthly limit/i.test(e.message);

// ---- Webhook の中身（使う形だけ） ----
export interface LineEvent {
  type: string;
  replyToken?: string;
  source?: { type: string; userId?: string };
  message?: { type: string; text?: string };
}

/** 合言葉らしい文字列（8文字。空白・ハイフン・小文字は許す）を取り出す */
export function extractLinkCode(t: string): string | null {
  const s = t.normalize('NFKC').toUpperCase().replace(/[\s-]/g, '');
  return /^[A-HJ-NP-Z2-9]{8}$/.test(s) ? s : null;
}
