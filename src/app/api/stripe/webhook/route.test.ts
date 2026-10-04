import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const events = new Set<string>();
const upserts: { table: string; row: Record<string, unknown> }[] = [];
vi.mock('@/lib/supabase/admin', () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      insert: async (row: { id: string }) => {
        if (events.has(row.id)) return { error: { code: '23505' } };
        events.add(row.id); return { error: null };
      },
      upsert: async (row: Record<string, unknown>) => { upserts.push({ table, row }); return { error: null }; },
      delete: () => ({ eq: async (_: string, id: string) => { events.delete(id); return { error: null }; } }),
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { school_id: 'sch-from-customer' } }) }) }),
    }),
  }),
}));

import { POST } from './route';

const SECRET = 'whsec_test';
const post = (body: unknown, sig?: string) => {
  const raw = JSON.stringify(body), t = Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', SECRET).update(`${t}.${raw}`).digest('hex');
  return POST(new Request('https://x/api/stripe/webhook', { method: 'POST', body: raw, headers: { 'stripe-signature': sig ?? `t=${t},v1=${v1}` } }));
};
const sub = (id: string, extra: Record<string, unknown> = {}) => ({
  id: 'evt_' + id, type: 'customer.subscription.updated',
  data: { object: { id: 'sub_1', customer: 'cus_1', status: 'active', trial_end: null, cancel_at_period_end: false, metadata: { school_id: 'sch' },
    items: { data: [{ id: 'si_1', quantity: 12, current_period_end: 1_793_000_000 }] }, ...extra } },
});

beforeEach(() => {
  events.clear(); upserts.length = 0;
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  delete process.env.STRIPE_SECRET_KEY; // 読み直しはしない（届いた中身を使う）
});

describe('Stripe の Webhook', () => {
  it('署名が違えば 400、何も書かない', async () => {
    expect((await post(sub('1'), 't=1,v1=00')).status).toBe(400);
    expect(upserts).toEqual([]);
  });

  it('契約の状態を写す（期間の終わりは items の中でも読む）', async () => {
    expect((await post(sub('1'))).status).toBe(200);
    expect(upserts[0]).toEqual({ table: 'school_billing', row: expect.objectContaining({ school_id: 'sch', status: 'active', seats: 12, current_period_end: new Date(1_793_000_000_000).toISOString() }) });
  });

  it('同じイベントは一度だけ', async () => {
    await post(sub('1'));
    expect(await (await post(sub('1'))).text()).toBe('duplicate');
    expect(upserts).toHaveLength(1);
  });

  it('解約は canceled。metadata が無ければ customer から塾を引く', async () => {
    await post({ ...sub('2', { metadata: {} }), type: 'customer.subscription.deleted' });
    expect(upserts[0].row).toEqual(expect.objectContaining({ school_id: 'sch-from-customer', status: 'canceled' }));
  });

  it('支払いページの完了で、塾と Stripe の顧客・契約を結ぶ', async () => {
    await post({ id: 'evt_3', type: 'checkout.session.completed', data: { object: { client_reference_id: 'sch', customer: 'cus_1', subscription: 'sub_1' } } });
    expect(upserts[0].row).toEqual(expect.objectContaining({ school_id: 'sch', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }));
  });
});
