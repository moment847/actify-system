import type { EmailOtpType } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { safeNext } from '@/lib/domain/paths';

// 招待・パスワードの決め直しのメールのリンクの受け口。
// メールの文面（supabase/templates/*.html）が token_hash と type をここへ渡す。サーバで verifyOtp してセッションにする
// （標準の文面の {{ .ConfirmationURL }} はトークンを URL の # の後ろで返すので、サーバでは受け取れない）
const TYPES: EmailOtpType[] = ['invite', 'recovery', 'email', 'signup', 'magiclink', 'email_change'];

export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get('token_hash');
  const type = url.searchParams.get('type') as EmailOtpType | null;
  const next = safeNext(url.searchParams.get('next'), url.origin, type === 'invite' || type === 'recovery' ? '/account/password' : '/');
  if (tokenHash && type && TYPES.includes(type)) {
    const sb = await createClient();
    const { error } = await sb.auth.verifyOtp({ type, token_hash: tokenHash });
    if (!error) return NextResponse.redirect(new URL(next, url.origin));
  }
  return NextResponse.redirect(new URL('/login?error=link', url.origin));
}
