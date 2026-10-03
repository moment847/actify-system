import { NextResponse, type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/proxy';

// Next.js 16 の Proxy（旧 middleware）。セッションを更新し、ログインしていなければログイン画面へ送る。
// ここでの判定は「入口の振り分け」だけ。権限は各サーバ処理と RLS で毎回確かめる
const PUBLIC_PATHS = ['/login', '/auth', '/api/health'];

export async function proxy(request: NextRequest) {
  const { response, userId } = await updateSession(request);
  const path = request.nextUrl.pathname;
  if (!userId && !PUBLIC_PATHS.some(p => path === p || path.startsWith(p + '/'))) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|pdf)$).*)'],
};
