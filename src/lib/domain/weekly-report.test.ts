import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/mock-v19.json';
import { fromMock } from './from-mock';
import { weekStats } from './plan';
import { buildWeeklyReport, reportWeek } from './weekly-report';
import type { World } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const fx = fixture as any;
const world = (today = fx.day): World => fromMock(JSON.parse(JSON.stringify(fx.state)), today);

describe('週の報告', () => {
  it('日曜は今日で終わる週、それ以外は先週', () => {
    expect(reportWeek('2026-10-04')).toBe('2026-09-28'); // 日
    expect(reportWeek('2026-10-05')).toBe('2026-09-28'); // 月
    expect(reportWeek('2026-10-02')).toBe('2026-09-21'); // 金
  });

  it('数字は講師の画面（weekStats）と同じ', () => {
    const w = world();
    const r = buildWeeklyReport(w, 's1', { studentName: '山田 陽菜', schoolName: 'デモ塾', week: '2026-09-21' });
    const ws = weekStats(w, 's1', '2026-09-21');
    expect(r.minutes).toBe(ws.minutes);
    expect(r.done).toBe(ws.done.length);
    expect(r.due).toBe(ws.due.length);
    expect(r.text).toContain('【デモ塾 週の報告】');
    expect(r.text).toContain('山田 陽菜さん　9/21（月）〜9/27（日）');
  });

  it('遅れている参考書だけを、遅れの大きい順に出す', () => {
    const r = buildWeeklyReport(world(), 's1', { studentName: 'A', schoolName: 'B', week: '2026-09-21' });
    expect(r.behind.map(b => b.label)).toEqual(['遅れ', '遅れ']);
    r.behind.forEach(b => expect(r.text).toContain(`・${b.name}　${b.label}（${b.done} / ${b.total}）`));
  });

  it('週の途中で作っても、まだ来ていない日の予定を「未達成」に数えない', () => {
    const w = world('2026-09-30');
    const r = buildWeeklyReport(w, 's1', { studentName: 'A', schoolName: 'B', week: '2026-09-28' });
    expect(r.due).toBe(weekStats(w, 's1', '2026-09-28').due.length);
  });

  it('次の面談・先生のひとこと・面談なし', () => {
    const w = world();
    const r = buildWeeklyReport(w, 's2', { studentName: 'A', schoolName: 'B', week: '2026-09-21', coachMessage: '  英語が伸びています  ' });
    expect(r.meeting).toEqual({ date: '2026-10-03', time: '13:30' });
    expect(r.text).toContain('■ 次の面談　10/3（土） 13:30から');
    expect(r.text).toContain('■ 先生から\n英語が伸びています');
    w.meetings = [];
    expect(buildWeeklyReport(w, 's2', { studentName: 'A', schoolName: 'B', week: '2026-09-21' }).text).toContain('■ 次の面談　まだ決まっていません');
  });

  it('記録の無い週は「記録なし」、空行は2つ以上続けない、LINE の上限より短い', () => {
    const r = buildWeeklyReport(world(), 's1', { studentName: 'A', schoolName: 'B', week: '2025-01-06' });
    expect(r.text).toContain('■ 勉強時間　記録なし');
    expect(r.text).toContain('この週の予定はありませんでした');
    expect(r.text).not.toMatch(/\n{3}/);
    expect(r.text.length).toBeLessThan(5000);
  });
});
