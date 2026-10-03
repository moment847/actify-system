import { LoginForm } from './login-form';

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  return (
    <main>
      <h1>Actify にログイン</h1>
      <LoginForm next={next && next.startsWith('/') && !next.startsWith('//') ? next : '/'} />
      {error && <p className="err">ログインのリンクが使えませんでした。もう一度ログインしてください。</p>}
    </main>
  );
}
