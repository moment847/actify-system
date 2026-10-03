import { redirect } from 'next/navigation';
import { loadActor } from '@/lib/data/load';

// 入口：役割ごとの画面へ送る
export default async function Home() {
  const actor = await loadActor();
  if (!actor) redirect('/login');
  redirect(actor.role === 'student' ? '/student' : actor.role === 'coach' ? '/coach' : '/admin');
}
