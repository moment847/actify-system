import 'server-only';
import { timingSafeEqual } from 'node:crypto';
import { env } from '@/lib/env';

/**
 * 定期処理の入口を守る。Authorization: Bearer <CRON_SECRET>（Vercel Cron が付ける形と同じ。
 * Supabase の pg_cron + pg_net から呼ぶときも同じヘッダを付ける）。CRON_SECRET が無ければ誰も呼べない
 */
export function cronAllowed(req: Request): boolean {
  const secret = env.cronSecret();
  const got = req.headers.get('authorization') ?? '';
  if (!secret) return false;
  const a = Buffer.from(got), b = Buffer.from(`Bearer ${secret}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function cronRun(req: Request, name: string, fn: () => Promise<unknown>): Promise<Response> {
  if (!cronAllowed(req)) return new Response('unauthorized', { status: 401 });
  try {
    const result = await fn();
    console.info(`[cron:${name}]`, JSON.stringify(result));
    return Response.json({ ok: true, result });
  } catch (e) {
    console.error(`[cron:${name}]`, e instanceof Error ? e.message : e);
    return Response.json({ ok: false }, { status: 500 });
  }
}
