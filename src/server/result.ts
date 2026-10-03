import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { loadActor, type Actor, type Role } from '@/lib/data/load';

/** サーバ処理の返り値。画面はこれを見て通知（トースト）を出す */
export type Result<T = undefined> = { ok: true; message?: string; data?: T } | { ok: false; error: string };

export const ok = <T,>(message?: string, data?: T): Result<T> => ({ ok: true, message, data });
export const fail = (error: string): Result<never> => ({ ok: false, error });

// 入力の形（画面から何が来ても、ここで弾く）
export const zDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, '日付の形が正しくありません');
export const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, '時刻の形が正しくありません');
export const zId = z.string().uuid();

/** DB のエラーを、画面に出せる日本語にする。関数（RPC）が出す日本語の理由はそのまま、それ以外は一般的な文に */
export function dbError(e: { message?: string; code?: string } | null | undefined): string {
  if (!e) return 'うまくいきませんでした';
  const m = e.message || '';
  if (/[ぁ-んァ-ン一-龥]/.test(m)) return m;
  switch (e.code) {
    case '23505': return 'すでに登録されています';
    case '23P01': return 'ほかの予定と重なっています';
    case '23503': return '関係するデータが見つからないか、使われているので消せません';
    case '23514': return '入れられない値です';
    case '42501': return 'この操作はできません';
    default: return 'うまくいきませんでした。もう一度試してください';
  }
}

/**
 * ログインと役割を確かめてから処理する。Server Action は直接 POST で呼べるので、毎回ここを通す
 * （RLS でも止まるが、役割の違う人の操作は入口で断る）
 */
export async function withActor<T>(roles: Role[], fn: (ctx: { sb: SupabaseClient; actor: Actor }) => Promise<Result<T>>): Promise<Result<T>> {
  const sb = await createClient();
  const actor = await loadActor(sb);
  if (!actor) return fail('ログインしてください');
  if (!roles.includes(actor.role)) return fail('この操作はできません');
  try {
    return await fn({ sb, actor });
  } catch (e) {
    if (e instanceof z.ZodError) return fail(e.issues[0]?.message || '入力を確かめてください');
    console.error('[action]', e);
    return fail('うまくいきませんでした。もう一度試してください');
  }
}
