'use client';
import { disablePush } from '@/lib/client/push';

// ログアウトの前に、この端末への通知を外す（共用の端末で、前の人の通知が届き続けないように）
export function SignOut() {
  return (
    <form action="/auth/signout" method="post" onSubmit={async e => {
      const form = e.currentTarget;
      if (form.dataset.done) return;
      e.preventDefault();
      await disablePush().catch(() => null);
      form.dataset.done = '1';
      form.requestSubmit();
    }}>
      <button>ログアウト</button>
    </form>
  );
}
