import 'server-only';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import { loadActor, type Role } from '@/lib/data/load';

/** 画面用：ログインと役割を確かめる。違う役割の画面は入口へ戻す */
export async function requireRole(role: Role) {
  const sb = await createClient();
  const actor = await loadActor(sb);
  if (!actor) redirect('/login');
  if (actor.role !== role) redirect('/');
  return { sb, actor };
}
