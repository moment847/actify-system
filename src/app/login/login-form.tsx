'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export function LoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function login(form: FormData) {
    setBusy(true); setError('');
    const { error } = await createClient().auth.signInWithPassword({ email: String(form.get('email')), password: String(form.get('password')) });
    setBusy(false);
    if (error) return setError('メールアドレスかパスワードが違います');
    router.replace(next); router.refresh();
  }
  async function forgot(email: string) {
    if (!email) return setError('メールアドレスを入れてください');
    await createClient().auth.resetPasswordForEmail(email, { redirectTo: `${location.origin}/auth/callback?next=/account/password` });
    setSent(true);
  }
  return (
    <form className="form" action={login}>
      <label>メールアドレス<input name="email" type="email" autoComplete="email" required /></label>
      <label>パスワード<input name="password" type="password" autoComplete="current-password" required /></label>
      {error && <p className="err" role="alert">{error}</p>}
      <button disabled={busy}>{busy ? 'ログイン中…' : 'ログイン'}</button>
      <p className="muted">
        {sent ? 'パスワードを決め直すメールを送りました。' : <a href="#" onClick={e => { e.preventDefault(); forgot((e.currentTarget.closest('form')!.elements.namedItem('email') as HTMLInputElement).value); }}>パスワードを忘れたとき</a>}
      </p>
    </form>
  );
}
