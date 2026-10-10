import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

// school_billing の1行だけを持つ、偽の DB
const row: Record<string, unknown> = {};
const admin = {
  from: (table: string) => ({
    select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: table === 'school_billing' && row.school_id ? { ...row } : null }) }) }),
    upsert: async (r: Record<string, unknown>) => { Object.assign(row, r); return { error: null }; },
  }),
} as never;
import { applySubscription, countSeats, findLiveSubscription } from './billing';
import type { StripeSubscription } from '@/lib/integrations/stripe';

const sub = (id: string, status: string, created = 1_700_000_000): StripeSubscription =>
  ({ id, customer: 'cus_1', status, created, trial_end: null, cancel_at_period_end: false, items: { data: [{ id: 'si_' + id, quantity: 3 }] } });

beforeEach(() => { for (const k of Object.keys(row)) delete row[k]; });

describe('契約の写し方', () => {
  it('はじめての契約はそのまま写す', async () => {
    expect(await applySubscription(admin, 'sch', sub('sub_a', 'active'))).toBe(true);
    expect(row).toMatchObject({ school_id: 'sch', stripe_subscription_id: 'sub_a', status: 'active', seats: 3 });
  });

  it('別の（古い）契約の「解約」が遅れて届いても、今の契約を解約にしない', async () => {
    await applySubscription(admin, 'sch', sub('sub_new', 'active'));
    expect(await applySubscription(admin, 'sch', sub('sub_old', 'canceled'))).toBe(false);
    expect(row).toMatchObject({ stripe_subscription_id: 'sub_new', status: 'active' });
  });

  it('今の契約が終わったあとの新しい契約は写す', async () => {
    await applySubscription(admin, 'sch', sub('sub_old', 'canceled'));
    expect(await applySubscription(admin, 'sch', sub('sub_new', 'trialing'))).toBe(true);
    expect(row).toMatchObject({ stripe_subscription_id: 'sub_new', status: 'trialing' });
  });

  it('同じ契約の状態の変化はそのまま写す（解約も）', async () => {
    await applySubscription(admin, 'sch', sub('sub_a', 'active'));
    expect(await applySubscription(admin, 'sch', sub('sub_a', 'canceled'))).toBe(true);
    expect(row).toMatchObject({ status: 'canceled' });
  });
});

describe('生きている契約を Stripe に聞く', () => {
  it('解約済みしか無ければ null、生きていれば新しい方を返して DB に写す', async () => {
    const list = [sub('sub_old', 'canceled', 1), sub('sub_b', 'active', 200), sub('sub_a', 'trialing', 100)];
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: list }), { status: 200 })));
    const live = await findLiveSubscription(admin, 'sk', 'sch', 'cus_1');
    expect(live?.id).toBe('sub_b');
    expect(row).toMatchObject({ stripe_subscription_id: 'sub_b' });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ data: [sub('sub_old', 'canceled')] }), { status: 200 })));
    expect(await findLiveSubscription(admin, 'sch2', 'sch2', 'cus_2')).toBeNull();
  });
});

describe('在籍中の生徒の数', () => {
  it('数えられなかったら 0 人にせず失敗にする（数量を1人に下げて返金してしまわない）', async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: async () => ({ count: null, error: { message: 'timeout' } }) }) }) }) }) } as never;
    await expect(countSeats(broken, 'sch')).rejects.toThrow('timeout');
  });
});
