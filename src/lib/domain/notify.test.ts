import { describe, expect, it } from 'vitest';
import { inQuietHours, localTime, pushExpired } from './notify';

describe('通知', () => {
  it('通知しない時間（日をまたぐ・またがない・同じ時刻）', () => {
    expect(inQuietHours('23:30', '23:00', '07:00')).toBe(true);
    expect(inQuietHours('06:59', '23:00', '07:00')).toBe(true);
    expect(inQuietHours('07:00', '23:00', '07:00')).toBe(false);
    expect(inQuietHours('13:00', '12:00', '14:00')).toBe(true);
    expect(inQuietHours('13:00', '00:00', '00:00')).toBe(false);
  });
  it('その人のタイムゾーンの時刻', () => {
    const now = new Date('2026-10-02T15:05:00Z');
    expect(localTime('Asia/Tokyo', now)).toBe('00:05');
    expect(localTime('America/Los_Angeles', now)).toBe('08:05');
  });
  it('古い通知は端末に送らない', () => {
    const now = new Date('2026-10-02T12:00:00Z');
    expect(pushExpired('task_start', '2026-10-02T11:00:00Z', now)).toBe(true);
    expect(pushExpired('reply', '2026-10-02T01:00:00Z', now)).toBe(false);
  });
});
