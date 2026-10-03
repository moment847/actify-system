import { createBrowserClient } from '@supabase/ssr';

// ブラウザ用。anon キーだけを使う（ファイルを置き場へ直接アップロードするときに使う。RLS で塾のフォルダに限られる）
export function createClient() {
  return createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
}
