import { describe, expect, it } from 'vitest';
import { fmt1, gapLabel, mockTrend, pastByTarget, type ExamResult } from './exams';

const base = { provider: '', year: null, score: null, max: null, passing: null, deviation: null, target: '', judgement: null, note: '', subjects: [] };
const mock = (id: string, takenOn: string, provider: string, deviation: number | null, subjects: [string, number][] = []): ExamResult =>
  ({ ...base, id, kind: 'mock', title: id, takenOn, provider, deviation, subjects: subjects.map(([subject, d]) => ({ subject, score: null, max: null, deviation: d })) });
const past = (id: string, title: string, year: number, takenOn: string, score: number, passing: number | null): ExamResult =>
  ({ ...base, id, kind: 'past', title, year, takenOn, score, max: 200, passing });

describe('模試の推移', () => {
  it('日付順。差は同じ会社の1つ前の模試とだけ比べる', () => {
    const t = mockTrend([mock('b', '2026-08-23', '河合塾', 57.3), mock('a', '2026-05-17', '河合塾', 54.8), mock('c', '2026-08-30', '駿台', 50.1)]);
    expect(t.points.map(p => p.id)).toEqual(['a', 'b', 'c']);
    expect(t.latest?.id).toBe('c');
    expect(t.change).toBeNull(); // 駿台は1回だけ
    const t2 = mockTrend([mock('a', '2026-05-17', '河合塾', 54.8), mock('b', '2026-08-23', '河合塾', 57.3)]);
    expect(t2.change).toBe(2.5); // 浮動小数の 2.4999… を出さない
  });

  it('科目は出てきた順、受けていない回は null', () => {
    const t = mockTrend([mock('a', '2026-05-17', '河合塾', 50, [['英語', 56.2], ['数学', 52.1]]), mock('b', '2026-08-23', '河合塾', 52, [['英語', 60.4], ['国語', 56.9]])]);
    expect(t.subjects).toEqual([
      { subject: '英語', values: [56.2, 60.4] }, { subject: '数学', values: [52.1, null] }, { subject: '国語', values: [null, 56.9] },
    ]);
  });

  it('偏差値の無い回は latest にしない・過去問は混ぜない', () => {
    const t = mockTrend([mock('a', '2026-05-17', '河合塾', 54.8), mock('b', '2026-08-23', '河合塾', null), past('p', 'X', 2025, '2026-09-01', 100, 120)]);
    expect(t.latest?.id).toBe('a');
    expect(t.points).toHaveLength(2);
  });
});

describe('過去問と合格最低点', () => {
  it('大学・学部ごと、年度の新しい順。差と得点率', () => {
    const g = pastByTarget([
      past('x4', '早稲田 商', 2025, '2026-09-20', 118, 129.95),
      past('x5', '早稲田 商', 2024, '2026-09-27', 124, null),
      past('y', '慶應 経済', 2025, '2026-09-10', 150, 140),
    ]);
    expect(g.map(x => x.title)).toEqual(['早稲田 商', '慶應 経済']);
    expect(g[0].rows.map(r => r.year)).toEqual([2025, 2024]);
    expect(g[0].rows[0].gap).toBe(-11.95); // 浮動小数の −11.949999… を出さない
    expect(g[0].rows[0].rate).toBe(59);
    expect(g[0].rows[1].gap).toBeNull();
    expect(g[0].latest.id).toBe('x5');
    expect(g[0].best?.id).toBe('x4');
    expect(g[1].rows[0].gap).toBe(10);
  });

  it('表示', () => {
    expect(gapLabel(-11.95)).toBe('最低点まであと11.95点');
    expect(gapLabel(-12)).toBe('最低点まであと12点');
    expect(gapLabel(3.5)).toBe('最低点を3.5点上回る');
    expect(gapLabel(null)).toBe('最低点が未入力');
    expect(fmt1(57.30000001)).toBe('57.3');
    expect(fmt1(-0.04)).toBe('0');
  });
});
