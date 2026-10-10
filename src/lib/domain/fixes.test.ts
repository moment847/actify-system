// 2026-10 の点検で見つけた計算の誤り（モックと同じ答えでも、モック自体が間違っていたもの）
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/mock-v19.json';
import { dateAdd } from './dates';
import { fromMock } from './from-mock';
import { bookProgress, firstFreeSlot } from './plan';
import { matchPdfName, parseFreeEntry } from './text-match';
import type { World } from './types';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const world = (): World => fromMock(JSON.parse(JSON.stringify((fixture as any).state)), (fixture as any).day);

describe('自由に書く欄：教材の名前の数字を範囲と取り違えない', () => {
  it('「ターゲット1900 801」は 801–900（1801–1900 ではない）', () => {
    const w = world(), r = parseFreeEntry(w, 's1', 'ターゲット1900 801');
    expect(r?.kind).toBe('node');
    expect(r && 'node' in r && w.materials.find(m => m.id === 'en')!.units.find(u => u.id === r.node)?.label).toBe('801–900');
  });
  it('範囲の途中の数（850）は、その数を含む範囲', () => {
    const w = world(), r = parseFreeEntry(w, 's1', 'ターゲット 850');
    expect(r && 'node' in r && w.materials.find(m => m.id === 'en')!.units.find(u => u.id === r.node)?.label).toBe('801–900');
  });
});

describe('PDF の名前：英語の「ans」は語の切れ目だけ', () => {
  it('Transition は問題、ans・answer・解答は解答', () => {
    const w = world();
    expect(matchPdfName('Transition_Unit1.pdf', w.materials).role).toBe('problem');
    expect(matchPdfName('ターゲット1900_201-300_ans.pdf', w.materials).role).toBe('answer');
    expect(matchPdfName('target_answer.pdf', w.materials).role).toBe('answer');
    expect(matchPdfName('ターゲット1900_201-300_解答.pdf', w.materials).role).toBe('answer');
  });
});

describe('参考書の進み：始めて3週間たっていない本', () => {
  it('7日前に始めて毎日1範囲なら、遅れにしない', () => {
    const w = world(), sid = 'x1', mid = 'en', m = w.materials.find(x => x.id === mid)!;
    w.books.push({ studentId: sid, materialId: mid, start: dateAdd(w.today, -7), target: dateAdd(w.today, 30) });
    m.units.slice(0, 7).forEach((u, i) => w.tasks.push({ id: 'd' + i, studentId: sid, date: dateAdd(w.today, -7 + i), time: '19:00', duration: 30, materialId: mid, unitId: u.id, vague: null, title: null, status: 'done', quizVersionId: null, max: null, noQuiz: true, retest: false, score: null, actual: 30 }));
    const p = bookProgress(w, sid, mid);
    expect(p.perWeek).toBe(7);
    expect(p.status.label).not.toBe('遅れ');
  });
  it('今日登録したばかりで目標が先なら「遅れ」にしない', () => {
    const w = world(), sid = 'x2', mid = 'en';
    w.books.push({ studentId: sid, materialId: mid, start: w.today, target: dateAdd(w.today, 180) });
    expect(bookProgress(w, sid, mid).status.label).toBe('順調');
  });
});

describe('空いている所：5分刻みに切り上げても枠に入る所だけ', () => {
  it('19:03〜19:48 の枠に45分は入れない', () => {
    const w = world(), sid = 'x3', d = dateAdd(w.today, 1);
    w.slots.push({ id: 'a1', studentId: sid, weekday: null, date: d, start: '19:03', end: '19:48', label: '' });
    const r = firstFreeSlot(w, sid, 45, d);
    expect(r.date === d && r.time === '19:05').toBe(false);
  });
});
