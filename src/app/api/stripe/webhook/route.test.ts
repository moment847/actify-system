import { createHmac } from 'node:crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const events = new Map<string, { processed_at: string | null; received_at: string }>();
const upserts: { table: string; row: Record<string, unknown> }[] = [];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const query = (table: string): any => {
  let op = 'select', patch: Record<string, unknown> = {};
  const f: Record<string, unknown> = {};
  const run = () => {
    const e = events.get(f.id as string);
    if (op === 'delete') { events.delete(f.id as string); return { error: null }; }
    if (op === 'update' && table === 'billing_events') {
      if (!e || ('processed_at' in f && e.processed_at !== null) || ('received_at' in f && e.received_at !== f.received_at)) return { data: [], error: null };
      Object.assign(e, patch); return { data: [{ id: f.id }], error: null };
    }
    return { data: null, error: null };
  };
  const b = {
    insert: async (row: { id: string }) => {
      if (events.has(row.id)) return { error: { code: '23505' } };
      events.set(row.id, { processed_at: null, received_at: new Date().toISOString() }); return { error: null };
    },
    upsert: async (row: Record<string, unknown>) => { upserts.push({ table, row }); return { error: null }; },
    delete: () => { op = 'delete'; return b; },
    update: (r: Record<string, unknown>) => { op = 'update'; patch = r; return b; },
    select: () => b,
    eq: (k: string, v: unknown) => { f[k] = v; return b; },
    is: (k: string, v: unknown) => { f[k] = v; return b; },
    maybeSingle: async () => table === 'billing_events' ? { data: events.get(f.id as string) ?? null } : { data: { school_id: 'sch-from-customer', stripe_customer_id: 'cus_1' } },
    then: (res: (v: unknown) => unknown) => res(run()),
  };
  return b;
};
vi.mock('@/lib/supabase/admin', () => ({ createAdminClient: () => ({ from: query }) }));

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

  it('処理の途中で切られた知らせ（印だけ残った）は、5分たてば処理し直す。処理中なら 409 で再送を待つ', async () => {
    events.set('evt_5', { processed_at: null, received_at: new Date().toISOString() });
    expect((await post(sub('5'))).status).toBe(409);
    expect(upserts).toEqual([]);
    events.set('evt_5', { processed_at: null, received_at: new Date(Date.now() - 10 * 60_000).toISOString() });
    expect((await post(sub('5'))).status).toBe(200);
    expect(upserts).toHaveLength(1);
    expect(events.get('evt_5')?.processed_at).not.toBeNull();
  });

  it('解約は canceled。metadata が無ければ customer から塾を引く', async () => {
    await post({ ...sub('2', { metadata: {} }), type: 'customer.subscription.deleted' });
    expect(upserts[0].row).toEqual(expect.objectContaining({ school_id: 'sch-from-customer', status: 'canceled' }));
  });

  it('支払いページの完了で、塾と Stripe の顧客・契約を結ぶ', async () => {
    await post({ id: 'evt_3', type: 'checkout.session.completed', data: { object: { client_reference_id: 'sch', customer: 'cus_1', subscription: 'sub_1' } } });
    expect(upserts[0].row).toEqual(expect.objectContaining({ school_id: 'sch', stripe_customer_id: 'cus_1', stripe_subscription_id: 'sub_1' }));
  });

  it('塾に保存してある顧客と違う決済は、塾の契約にしない', async () => {
    await post({ id: 'evt_4', type: 'checkout.session.completed', data: { object: { client_reference_id: 'sch', customer: 'cus_stranger', subscription: 'sub_x' } } });
    expect(upserts).toEqual([]);
  });
});
