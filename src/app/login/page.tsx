import { LoginForm } from './login-form';
import { safeNext } from '@/lib/domain/paths';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main>
      <h1>Actify にログイン</h1>
      {/* 転送先は同じサイトのパスだけ（/\\evil.example のような書き方で外へ飛ばさない） */}
      <LoginForm next={safeNext(next, 'https://actify.invalid')} />
      {error && <p className="err">ログインのリンクが使えませんでした。もう一度ログインしてください。</p>}
    </main>
  );
}
