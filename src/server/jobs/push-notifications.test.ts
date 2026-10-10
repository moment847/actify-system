import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));

const results: Record<string, 'sent' | 'gone' | 'error'> = {};
vi.mock('@/lib/integrations/web-push', () => ({
  pushConfigured: () => true,
  sendPush: async (s: { endpoint: string }) => results[s.endpoint] ?? 'sent',
}));

type N = { id: number; user_id: string; kind: string; title: string; body: string; url: string; created_at: string; push_attempts: number };
let notes: N[] = [];
const updates: { ids: number[]; patch: Record<string, unknown> }[] = [];
const subs = [{ id: 'd1', user_id: 'u1', endpoint: 'e1', p256dh: 'p', auth_key: 'a' }, { id: 'd2', user_id: 'u2', endpoint: 'e2', p256dh: 'p', auth_key: 'a' }];
// 「通知しない時間」：u2 は 0:00〜23:59 に止める（いつでも止まる）
const prefs = [{ user_id: 'u2', quiet_start: '00:00', quiet_end: '23:59' }];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const q = (table: string): any => {
  let patch: Record<string, unknown> | null = null, ids: number[] = [];
  const data = () => (table === 'notifications' ? notes : table === 'push_subscriptions' ? subs : table === 'notification_prefs' ? prefs : [{ id: 'u1', timezone: 'Asia/Tokyo', schools: null }, { id: 'u2', timezone: 'Asia/Tokyo', schools: null }]);
  const b = {
    select: () => b, is: () => b, gte: () => b, or: () => b, order: () => b, limit: () => b, in: (_: string, v: number[]) => { ids = v; return b; },
    range: () => b, eq: (_: string, v: number) => { ids = [v]; return b; },
    update: (p: Record<string, unknown>) => { patch = p; return b; }, delete: () => b,
    then: (res: (v: unknown) => unknown) => { if (patch) { updates.push({ ids, patch }); return res({ error: null }); } return res({ data: data(), error: null }); },
  };
  return b;
};
const admin = { rpc: async () => ({ data: 0, error: null }), from: q } as never;
import { runPushNotifications } from './push-notifications';

const note = (id: number, user: string, attempts = 0): N => ({ id, user_id: user, kind: 'reply', title: 't', body: '', url: '/', created_at: new Date().toISOString(), push_attempts: attempts });
beforeEach(() => { updates.length = 0; for (const k of Object.keys(results)) delete results[k]; });

describe('端末への通知', () => {
  it('送れたら印を付け、「通知しない時間」の人は後ろに回す（印は付けない）', async () => {
    notes = [note(1, 'u1'), note(2, 'u2')];
    const r = await runPushNotifications(admin);
    expect(r).toMatchObject({ sent: 1, held: 1 });
    expect(updates.find(u => 'pushed_at' in u.patch)?.ids).toEqual([1]);
    expect(updates.find(u => 'push_after' in u.patch)?.ids).toEqual([2]);
  });
  it('一時的に送れなかったら送り直す（3回目で諦める）', async () => {
    results.e1 = 'error';
    notes = [note(1, 'u1', 0)];
    expect((await runPushNotifications(admin)).retry).toBe(1);
    expect(updates[0].patch).toMatchObject({ push_attempts: 1 });
    updates.length = 0; notes = [note(1, 'u1', 2)];
    expect((await runPushNotifications(admin)).retry).toBe(0);
    expect(updates.find(u => 'pushed_at' in u.patch)?.ids).toEqual([1]);
  });
  it('時間の予算を使い切ったら、送った分だけ印を付けて止める', async () => {
    notes = [note(1, 'u1'), note(3, 'u1')];
    const r = await runPushNotifications(admin, new Date(), -1);
    expect(r.timedOut).toBe(true);
    expect(r.sent).toBe(0);
  });
});
