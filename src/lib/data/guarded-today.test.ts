import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => null }));
const { guardedToday } = await import('./load');

// 2026-10-10 05:00 UTC：東京は 10/10 14:00、ロサンゼルスは 10/09 22:00、UTC+14 は 10/10 19:00
const now = new Date('2026-10-10T05:00:00Z');
const base = { id: 's', schoolId: 'x', schoolName: '', role: 'student' as const, name: '', schoolTimeZone: 'Asia/Tokyo' };
describe('締め切りに使う「今日」', () => {
  it('前からロサンゼルスにいる生徒は、生徒の暦の今日のまま（毎日2日前までにならない）', () => {
    const a = { ...base, timeZone: 'America/Los_Angeles', today: '2026-10-09', tzChangedAt: '2026-09-01T00:00:00Z' };
    expect(guardedToday(a, 'later', now)).toBe('2026-10-09');
  });
  it('西へ変えた直後は塾の暦の遅い方（当日の予約をすり抜けない）', () => {
    const a = { ...base, timeZone: 'America/Los_Angeles', today: '2026-10-09', tzChangedAt: '2026-10-10T04:00:00Z' };
    expect(guardedToday(a, 'later', now)).toBe('2026-10-10');
  });
  it('東へ変えた直後は早い方（翌日の小テストを先に開けない）', () => {
    const a = { ...base, timeZone: 'Etc/GMT-14', today: '2026-10-10', tzChangedAt: '2026-10-10T04:00:00Z' };
    expect(guardedToday(a, 'earlier', new Date('2026-10-10T12:00:00Z'))).toBe('2026-10-10');   // UTC+14 は 10/11、東京は 10/10
  });
});
