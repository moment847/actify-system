import { LoginForm } from './login-form';
import { safeNext } from '@/lib/domain/paths';
import { createClient } from '@/lib/supabase/server';
import { SignOut } from '../signout-button';

/** ログインはできるが使えない人（休会・退会・プロフィール無し）には、理由を出してログアウトだけさせる（ログイン → 入口 → ログイン の堂々めぐりを防ぐ） */
async function blockedReason(): Promise<string | null> {
  const sb = await createClient();
  const { data: claims } = await sb.auth.getClaims();
  const uid = claims?.claims?.sub as string | undefined;
  if (!uid) return null;
  const { data: p } = await sb.from('profiles').select('status').eq('id', uid).maybeSingle();
  if (!p) return 'このアカウントは、まだ塾の登録が済んでいません。塾にお問い合わせください。';
  if (p.status === 'paused') return '休会中のため、Actify を使えません。再開するときは塾にお問い合わせください。';
  if (p.status === 'withdrawn') return '退会したアカウントです。塾にお問い合わせください。';
  return null;
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const blocked = await blockedReason();
  if (blocked) return (<main><h1>Actify</h1><p className="err">{blocked}</p><SignOut /></main>);
  return (
    <main>
      <h1>Actify にログイン</h1>
      {/* 転送先は同じサイトのパスだけ（/\\evil.example のような書き方で外へ飛ばさない） */}
      <LoginForm next={safeNext(next, 'https://actify.invalid')} />
      {error && <p className="err">ログインのリンクが使えませんでした。もう一度ログインしてください。</p>}
    </main>
  );
}
