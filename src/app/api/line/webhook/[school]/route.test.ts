import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const SCHOOL = '11111111-1111-4111-8111-111111111111';
const rpc = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    rpc,
    from: () => ({ select: () => ({ eq: () => ({ single: async () => ({ data: { student_id: 's1', students: { profiles: { display_name: '山田 陽菜' } } } }) }) }) }),
  }),
}));
vi.mock('@/server/line-channel', () => ({ loadLineChannel: async (_: unknown, id: string) => (id === SCHOOL ? { secret: 'sec', token: 'tok' } : null) }));

import { POST } from './route';

const sign = (b: string) => createHmac('sha256', 'sec').update(b).digest('base64');
const call = (body: unknown, school = SCHOOL, sig?: string) => {
  const raw = JSON.stringify(body);
  return POST(new Request('https://x/api/line/webhook/' + school, { method: 'POST', body: raw, headers: { 'x-line-signature': sig ?? sign(raw) } }),
    { params: Promise.resolve({ school }) } as never);
};
const replies: { token: string; text: string }[] = [];

beforeEach(() => {
  replies.length = 0;
  rpc.mockReset();
  vi.stubGlobal('fetch', vi.fn(async (_url: string, init: RequestInit) => {
    const b = JSON.parse(init.body as string);
    replies.push({ token: b.replyToken, text: b.messages[0].text });
    return new Response('{}', { status: 200 });
  }));
});

const msg = (text: string) => ({ events: [{ type: 'message', replyToken: 'r1', source: { type: 'user', userId: 'U1' }, message: { type: 'text', text } }] });

describe('LINE の Webhook', () => {
  it('署名が合わない・知らない塾は何もしない', async () => {
    expect((await call(msg('AB7KQ2XZ'), SCHOOL, 'bad')).status).toBe(401);
    expect((await call(msg('AB7KQ2XZ'), '22222222-2222-4222-8222-222222222222')).status).toBe(401);
    expect(rpc).not.toHaveBeenCalled();
    expect(replies).toEqual([]);
  });

  it('LINE の「検証」（events が空）は 200', async () => {
    expect((await call({ events: [] })).status).toBe(200);
  });

  it('友だち追加には合言葉の送り方を返す', async () => {
    await call({ events: [{ type: 'follow', replyToken: 'r0', source: { type: 'user', userId: 'U1' } }] });
    expect(replies[0].text).toContain('合言葉');
  });

  it('合言葉でつなぎ、生徒の名前を返す', async () => {
    rpc.mockResolvedValue({ data: 'g1' });
    await call(msg('ab7k-q2xz'));
    expect(rpc).toHaveBeenCalledWith('link_guardian_line', { p_school: SCHOOL, p_code: 'AB7KQ2XZ', p_line_user: 'U1' });
    expect(replies[0].text).toBe('山田 陽菜さんの保護者として登録しました。毎週日曜の夜に、学習の週の報告をお送りします。');
  });

  it('合言葉が違う・切れている', async () => {
    rpc.mockResolvedValue({ data: null });
    await call(msg('AB7KQ2XZ'));
    expect(replies[0].text).toContain('期限');
  });

  it('合言葉でない文には送信専用と返す（つなぎに行かない）', async () => {
    await call(msg('いつもお世話になっています'));
    expect(rpc).not.toHaveBeenCalled();
    expect(replies[0].text).toContain('送信専用');
  });
});
