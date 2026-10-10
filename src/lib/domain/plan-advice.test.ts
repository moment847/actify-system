import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/mock-v19.json';
import { dateAdd, weekStart } from './dates';
import { fromMock } from './from-mock';
import { booksOf } from './plan';
import { cleanAdvice, planContext, proposalItems, type PlanAdvice } from './plan-advice';
import { studentContext } from './bot-reply';
import type { World } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const world = (): World => fromMock(JSON.parse(JSON.stringify((fixture as any).state)), (fixture as any).day);
const sid = 's1';
const next = (w: World) => dateAdd(weekStart(w.today), 7);
const none: PlanAdvice = { summary: '', focus: [], lighterDays: [], notes: [] };

describe('AI の予定の方針', () => {
  it('生徒の持っていない教材・その週ではない日・重なった教材は捨てる', () => {
    const w = world(), start = next(w), mid = booksOf(w, sid)[0].materialId;
    const a = cleanAdvice({ summary: 'x', focus: [{ materialId: mid, change: 'more', reason: 'r' }, { materialId: mid, change: 'less', reason: 'dup' }, { materialId: 'nope', change: 'more', reason: 'r' }],
      lighterDays: [{ date: start, reason: '大会' }, { date: dateAdd(start, 30), reason: '先' }], notes: ['a'] }, w, sid, start);
    expect(a.focus).toEqual([{ materialId: mid, change: 'more', reason: 'r' }]);
    expect(a.lighterDays.map(d => d.date)).toEqual([start]);
  });

  it('軽くする日には案を置かない。多めの教材は案が増え、少なめは減る', () => {
    const w = world(), start = next(w), mid = booksOf(w, sid)[0].materialId;
    const base = proposalItems(w, sid, start, none);
    const busy = base[0]?.date;
    const light = proposalItems(world(), sid, start, { ...none, lighterDays: [{ date: busy, reason: '大会' }] });
    expect(light.some(i => i.date === busy)).toBe(false);
    const count = (xs: typeof base) => xs.filter(i => i.materialId === mid && i.kind === 'next').length;
    const more = proposalItems(world(), sid, start, { ...none, focus: [{ materialId: mid, change: 'more', reason: '' }] });
    const less = proposalItems(world(), sid, start, { ...none, focus: [{ materialId: mid, change: 'less', reason: '' }] });
    expect(count(more)).toBeGreaterThan(count(base));
    expect(count(less)).toBeLessThan(count(base));
    expect(more.find(i => i.materialId === mid && i.kind === 'next')?.why).toContain('面談の方針で多め');
  });

  it('文脈に面談の記録（要約・共有欄）と週の空きが入り、長い記録は切る', () => {
    const w = world(), start = next(w);
    const ctx = planContext(w, sid, start, 'BASE', [{ onDate: '2026-10-01', kind: 'minutes', body: 'あ'.repeat(5000), summary: { decided: ['英文法を優先'], homework: [], concerns: ['部活の大会'] }, sharedTodo: '第5章を2回' }]);
    expect(ctx).toContain('決めたこと：英文法を優先');
    expect(ctx).toContain('気になること：部活の大会');
    expect(ctx).toContain('生徒に共有した「次回までにやること」：第5章を2回');
    expect(ctx).toContain('空き');
    expect(ctx.length).toBeLessThan(9000);
  });

  it('Actifyくんの文脈には共有欄だけが入る', () => {
    const w = world();
    const c = studentContext(w, sid, { name: '陽菜', todos: [{ onDate: '2026-10-01', todo: '第5章を2回\n単語100個' }] });
    expect(c).toContain('先生と決めた次回までにやること');
    expect(c).toContain('第5章を2回／単語100個');
  });
});
