import 'server-only';
import { createAdminClient } from '@/lib/supabase/admin';
import { pathIn } from '@/lib/domain/paths';
import { env } from '@/lib/env';

/**
 * 期限つきのファイルURLを作る。service_role で作るので Storage の RLS は効かない。
 * そのため、DB の制約に加えてここでも「その塾のフォルダの中か」を確かめる（どちらか一方が破れても漏れないように）
 */
export async function signedUrlInSchool(bucket: 'quiz-pdfs' | 'resources', path: string, schoolId: string): Promise<string | null> {
  if (!pathIn(path, `${schoolId}/`)) {
    console.error('[files] path outside school', { bucket, schoolId });
    return null;
  }
  const { data, error } = await createAdminClient().storage.from(bucket).createSignedUrl(path, env.signedUrlSeconds());
  return error || !data ? null : data.signedUrl;
}
