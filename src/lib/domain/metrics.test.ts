import { describe, expect, it } from 'vitest';
import { lagLabel, schoolMetrics, type MetricStudent } from './metrics';

const students: MetricStudent[] = [
  { id: 's1', name: '山田', coachIds: ['c1', 'c2'], mainCoachId: 'c1', joinedOn: '2026-04-01' },
  { id: 's2', name: '小林', coachIds: ['c1'], mainCoachId: 'c1', joinedOn: '2026-04-01' },
  { id: 's3', name: '佐藤', coachIds: ['c2'], mainCoachId: 'c2', joinedOn: '2026-04-01' },
  { id: 's4', name: '高橋', coachIds: ['c1'], mainCoachId: 'c1', joinedOn: '2026-09-30' },
];
const coaches = [{ id: 'c1', name: '佐藤 健' }, { id: 'c2', name: '中村 葵' }];

const run = () => schoolMetrics({
  today: '2026-10-02', now: new Date('2026-10-02T12:00:00Z'), students, coaches,
  doneDates: new Map([['s1', ['2026-10-01', '2026-09-22']], ['s2', ['2026-09-28']], ['s3', ['2026-09-20']]]),
  feedback: [
    { taskId: 't1', studentId: 's1', at: '2026-10-01T10:00:00Z' },
    { taskId: 't2', studentId: 's2', at: '2026-09-28T10:00:00Z' },
    { taskId: 't3', studentId: 's1', at: '2026-09-29T00:00:00Z' },
    { taskId: 't4', studentId: 's3', at: '2026-09-20T00:00:00Z' },
  ],
  replies: [
    { taskId: 't1', coachId: 'c2', at: '2026-10-01T11:30:00Z' }, // 副担当が返した
    { taskId: 't2', coachId: 'c1', at: '2026-09-28T14:00:00Z' },
  ],
});

describe('運営の数字', () => {
  it('記録を続けている割合（週ごと。入塾前の週は分母に入れない）', () => {
    const m = run();
    expect(m.weeks).toHaveLength(8);
    expect(m.weeks.at(-1)).toEqual({ start: '2026-09-28', active: 2, total: 4, rate: 50 });
    expect(m.weeks.at(-2)).toEqual({ start: '2026-09-21', active: 1, total: 3, rate: 33 });
    expect(m.thisWeekRate).toBe(50);
  });

  it('止まっている生徒（3日以上・記録なし）を長い順に', () => {
    expect(run().stalled).toEqual([
      { id: 's4', name: '高橋', days: null, coach: '佐藤 健' },
      { id: 's3', name: '佐藤', days: 12, coach: '中村 葵' },
      { id: 's2', name: '小林', days: 4, coach: '佐藤 健' },
    ]);
  });

  it('返信の速さは返した人に、返信待ちは主担当に数える', () => {
    const [c1, c2] = run().coaches;
    expect(c1).toEqual({ id: 'c1', name: '佐藤 健', students: 3, replied: 1, medianHours: 4, waiting: 1, waitingLong: 1 });
    expect(c2).toEqual({ id: 'c2', name: '中村 葵', students: 2, replied: 1, medianHours: 1.5, waiting: 1, waitingLong: 1 });
  });

  it('表示', () => {
    expect(lagLabel(null)).toBe('—');
    expect(lagLabel(0.25)).toBe('15分');
    expect(lagLabel(1.5)).toBe('1.5時間');
    expect(lagLabel(72)).toBe('3日');
  });
});
