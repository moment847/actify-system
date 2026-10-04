import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import { open } from '@/lib/integrations/secret-box';
import { env } from '@/lib/env';

/** 塾の LINE のチャネル（暗号を解いたもの）。未設定なら null。service_role のクライアントで読む */
export async function loadLineChannel(admin: SupabaseClient, schoolId: string): Promise<{ secret: string; token: string } | null> {
  const { data } = await admin.from('school_line_channels').select('channel_secret_enc, access_token_enc').eq('school_id', schoolId).maybeSingle();
  if (!data) return null;
  return { secret: open(data.channel_secret_enc, env.secretsKey()), token: open(data.access_token_enc, env.secretsKey()) };
}
