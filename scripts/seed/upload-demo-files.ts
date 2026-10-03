// デモの塾の PDF（小テストの見本と配る資料）を Supabase Storage に置く。seed.sql を流したあとに1回だけ。
// 使い方: pnpm db:seed:files   （.env.local の NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を使う）
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const ids = JSON.parse(readFileSync(join(root, 'src/lib/domain/__fixtures__/demo-ids.json'), 'utf8')) as { school: string };
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL と SUPABASE_SERVICE_ROLE_KEY を設定してください');
const sb = createClient(url, key, { auth: { persistSession: false } });

const files: [bucket: string, name: string][] = [
  ['quiz-pdfs', 'sample-questions.pdf'],
  ['quiz-pdfs', 'sample-answers.pdf'],
  ['resources', 'study-guide.pdf'],
];
for (const [bucket, name] of files) {
  const path = `${ids.school}/demo/${name}`;
  const { error } = await sb.storage.from(bucket).upload(path, readFileSync(join(root, 'supabase/demo-files', name)), { contentType: 'application/pdf', upsert: true });
  console.log(error ? `失敗 ${bucket}/${path}: ${error.message}` : `置きました ${bucket}/${path}`);
}
