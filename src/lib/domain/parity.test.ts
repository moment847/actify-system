// モック v19 と同じ答えを出すか（正解データは scripts/mock/export-fixture.mjs がモックを実際に動かして作ったもの）
import { describe, expect, it } from 'vitest';
import fixture from './__fixtures__/mock-v19.json';
import { dateAdd, weekDays, weekStart } from './dates';
import { fromMock } from './from-mock';
import {
  availRegistered, blockGaps, bookProgress, booksOf, candidatesFor, fitSet, freeGaps, lastRecord, meetingSlots, nextNode, orderSet, packGap,
  putTask, recommendFill, resequence, reviewQueue, shortages, studentAlerts, suggestions, typicalDur, visibleMats, weekBlocks, weekStats,
} from './plan';
import { matchPdfName, parseFreeEntry } from './text-match';
import type { World } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const fx = fixture as any;
const world = (): World => fromMock(JSON.parse(JSON.stringify(fx.state)), fx.day);
const sids = Object.keys(fx.perStudent);
const thisWeek = weekStart(fx.day), nextWeek = dateAdd(thisWeek, 7);
const SUBJECT_JA: Record<string, string> = { english: '英語', math: '数学', japanese: '国語', science: '理科', social: '社会', other: 'その他' };
let seq = 0;
const newId = () => 'new-' + seq++;

describe.each(sids)('生徒 %s', sid => {
  const exp = fx.perStudent[sid];

  it('再テストの時期', () => {
    const w = world();
    expect(reviewQueue(w, sid).map(r => ({ key: r.key, node: r.node, due: r.due, lp: r.lp, interval: r.interval, k: r.k }))).toEqual(exp.reviewQueue);
  });

  it('参考書の進み（今日の目安・このペースで終わる日・状態・マス）', () => {
    const w = world();
    const got = booksOf(w, sid).map(b => { const p = bookProgress(w, sid, b.materialId);
      return { material: b.materialId, total: p.total, done: p.done, rem: p.rem, perWeek: p.perWeek, needPerWeek: p.needPerWeek, finish: p.finish, late: p.late, status: p.status, expected: p.expected, avg: p.avg,
        cells: p.cells.map(c => ({ node: c.n.id, done: c.done, planned: c.planned, last: c.last, tries: c.tries, first: c.first || null })) }; });
    expect(got).toEqual(exp.books);
  });

  it('1回の時間（直近5回）と次の範囲', () => {
    const w = world();
    expect(Object.fromEntries(visibleMats(w).map(m => [m.id, typicalDur(w, sid, m.id)]))).toEqual(exp.typicalDur);
    expect(Object.fromEntries(visibleMats(w).map(m => [m.id, nextNode(w, sid, m.id)?.id || null]))).toEqual(exp.nextNode);
  });

  it('週のまとめ', () => {
    const w = world();
    for (const wk of [thisWeek, nextWeek]) {
      const s = weekStats(w, sid, wk), e = exp.weekStats[wk];
      expect({ due: s.due.length, done: s.done.length, rate: s.rate, minutes: s.minutes, perDay: s.perDay, missed: s.missed.map(t => t.id), planned: s.planned, avail: s.avail })
        .toEqual({ due: e.due, done: e.done, rate: e.rate, minutes: e.minutes, perDay: e.perDay, missed: e.missed, planned: e.planned, avail: e.avail });
      expect(Object.fromEntries(Object.entries(s.bySubject).map(([k, v]) => [SUBJECT_JA[k], v]))).toEqual(e.bySubject);
    }
  });

  it('小テスト不足・気になる点・最後の記録・登録の有無', () => {
    const w = world();
    expect(shortages(w, sid).map(x => ({ node: x.node, why: x.why }))).toEqual(exp.shortages);
    expect(studentAlerts(w, sid)).toEqual(exp.alerts);
    expect(lastRecord(w, sid)).toBe(exp.lastRecord);
    expect({ [thisWeek]: availRegistered(w, sid, thisWeek), [nextWeek]: availRegistered(w, sid, nextWeek) }).toEqual(exp.availRegistered);
  });

  it('来週の空き', () => {
    const w = world();
    expect(Object.fromEntries(weekDays(nextWeek).map(d => [d, freeGaps(w, sid, d)]))).toEqual(exp.freeGaps);
  });

  it('自動の案（週）', () => {
    const w = world();
    expect(suggestions(w, sid, nextWeek).map(s => ({ key: s.key, kind: s.kind, node: s.node, date: s.date, time: s.time, dur: s.dur }))).toEqual(exp.suggestions);
  });

  it('面談の候補', () => {
    const w = world();
    for (const wk of [thisWeek, nextWeek])
      expect(meetingSlots(w, sid, wk, { avoidTasks: false }).map(x => ({ date: x.date, time: x.time, fit: x.fit, same: x.same }))).toEqual(exp.meetingSlots[wk]);
  });

  it('空きを押したときの候補と、枠にぴったり入る組み合わせ', () => {
    const w = world();
    const got = weekBlocks(w, sid, nextWeek).map(b => {
      const gaps = blockGaps(w, sid, b), g = gaps[0];
      const cands = g ? candidatesFor(w, sid, { date: b.date, s: g[0], e: g[1] }) : [];
      const pack = g ? orderSet(packGap(g[1] - g[0], cands)) : [];
      const fit = g ? fitSet(g[1] - g[0], g[0], pack) : { items: [], used: 0 };
      return { date: b.date, s: b.s, e: b.e, gaps,
        candidates: cands.map(c => ({ kind: c.kind, id: c.id, node: c.node, badge: c.badge, score: c.score, typ: c.typ })),
        fit: fit.items.map(x => ({ id: x.id, node: x.node, dur: x.dur, start: x.start })), used: fit.used };
    });
    expect(got).toEqual(exp.blocks);
  });
});

describe('文字から教材と範囲を見分ける', () => {
  it('PDFのファイル名', () => {
    const w = world();
    for (const [name, want] of Object.entries(fx.pdfNames)) expect(matchPdfName(name, w.materials), name).toEqual(want);
  });
  it('講師の「自由に書く」欄', () => {
    for (const [text, want] of Object.entries<any>(fx.freeEntry)) {
      const w = world(), pe = parseFreeEntry(w, 's1', text);
      const got = pe && { kind: pe.kind, title: 'title' in pe ? pe.title : null, material: 'm' in pe ? pe.m.id : null, node: 'node' in pe ? pe.node : null,
        done: pe.kind === 'node' ? pe.done : null, planned: pe.kind === 'node' ? pe.planned?.id || null : null, vague: pe.kind === 'vague' ? pe.v.k : null };
      expect(got, text).toEqual(want);
    }
  });
});

describe('予定を入れたあとの動き', () => {
  it('範囲は入れた順ではなく日付の順にそろう', () => {
    const w = world(), sc = fx.scenarios.resequence, sid = 's1';
    const n1 = nextNode(w, sid, 'en')!.id; putTask(w, sid, sc.sat, 9 * 60, 30, 'node', n1, newId);
    const n2 = nextNode(w, sid, 'en')!.id; putTask(w, sid, sc.tue, 6 * 60, 30, 'node', n2, newId);
    expect([n1, n2]).toEqual([sc.n1, sc.n2]);
    expect(resequence(w, sid).length).toBe(sc.changes);
    expect(w.tasks.filter(t => t.studentId === sid && t.materialId === 'en' && t.status !== 'done' && !t.retest)
      .sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time)).map(t => ({ date: t.date, time: t.time, node: t.unitId }))).toEqual(sc.result);
  });
  it('おすすめで残りを埋める', () => {
    const w = world(), sc = fx.scenarios.recommendFill;
    const b = weekBlocks(w, 's1', nextWeek)[0];
    expect({ date: b.date, s: b.s, e: b.e }).toEqual(sc.block);
    expect(recommendFill(w, 's1', b, newId).map(t => ({ time: t.time, duration: t.duration, node: t.unitId, retest: t.retest, pdf: t.quizVersionId }))).toEqual(sc.put);
  });
});
