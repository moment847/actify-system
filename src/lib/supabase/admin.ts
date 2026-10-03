import 'server-only';
import { createClient as createSupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';

// service_role（RLS を通らない）。使ってよいのは次の場面だけ：
// - アカウントを作る（Auth の管理 API）
// - 権限を確かめたあとで、期限つきのファイルURLを作る
// - Actifyくんの返事と AI の原価を書く
// クライアントに渡るコードから import しない（server-only で止まる）
export function createAdminClient() {
  return createSupabaseClient(env.supabaseUrl(), env.supabaseServiceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
