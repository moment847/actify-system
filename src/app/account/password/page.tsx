'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

// 招待のメールから来た人・パスワードを忘れた人が、パスワードを決める
export default function PasswordPage() {
  const router = useRouter();
  const [error, setError] = useState('');
  async function save(form: FormData) {
    const p = String(form.get('password')), c = String(form.get('confirm'));
    if (p.length < 8) return setError('8文字以上にしてください');
    if (p !== c) return setError('2つのパスワードが違います');
    const { error } = await createClient().auth.updateUser({ password: p });
    if (error) return setError('保存できませんでした。もう一度メールのリンクから開いてください');
    router.replace('/'); router.refresh();
  }
  return (
    <main>
      <h1>パスワードを決める</h1>
      <form className="form" action={save}>
        <label>新しいパスワード（8文字以上）<input name="password" type="password" autoComplete="new-password" required /></label>
        <label>もう一度<input name="confirm" type="password" autoComplete="new-password" required /></label>
        {error && <p className="err" role="alert">{error}</p>}
        <button>保存</button>
      </form>
    </main>
  );
}
