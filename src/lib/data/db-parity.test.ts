// 「DB に入れたデータ → 読み込み（rowsToWorld）→ 計算」が、モック v19 と同じ答えになるか。
// demo-rows.json は pnpm db:verify が seed の直後の DB から書き出したもの。
// モックのID（s1, en-9 …）は seed と同じ決まりで UUID に直して比べる。
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import fixture from '@/lib/domain/__fixtures__/mock-v19.json';
import { dateAdd, daysBetween, weekDays, weekStart } from '@/lib/domain/dates';
import {
  blockGaps, bookProgress, booksOf, candidatesFor, fitSet, meetingSlots, nextNode, orderSet, packGap, reviewQueue, shortages, studentAlerts,
  suggestions, typicalDur, visibleMats, weekBlocks, weekStats, freeGaps,
} from '@/lib/domain/plan';
import rows from './__fixtures__/demo-rows.json';
import { rowsToWorld, type Rows } from './map';

/* eslint-disable @typescript-eslint/no-explicit-any */
const fx = fixture as any;
const uuid = (key: string) => { const h = createHash('md5').update('actify-demo:' + key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };

// モックのID → UUID
const ids = new Map<string, string>();
for (const p of fx.state.people) ids.set(p.id, uuid(p.id));
for (const m of fx.state.materials) { ids.set(m.id, uuid('m:' + m.id)); for (const n of m.nodes) ids.set(n.id, uuid('u:' + n.id)); }
for (const p of fx.state.pdfs) ids.set(p.id, uuid('q:' + p.id));
for (const t of fx.state.tasks) ids.set(t.id, uuid('t:' + t.id));
const tr = (v: any): any => {
  if (typeof v === 'string') {
    if (ids.has(v)) return ids.get(v);
    if (/^(rv|nx|mv):/.test(v)) return v.split(':').map(x => ids.get(x) ?? x).join(':');
    return v;
  }
  if (Array.isArray(v)) return v.map(tr);
  if (v && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [ids.get(k) ?? k, tr(x)]));
  return v;
};

const world = () => rowsToWorld(rows as unknown as Rows, fx.day);
const thisWeek = weekStart(fx.day), nextWeek = dateAdd(thisWeek, 7);
const SUBJECT_JA: Record<string, string> = { english: '英語', math: '数学', japanese: '国語', science: '理科', social: '社会', other: 'その他' };

describe.each(Object.keys(fx.perStudent))('DB から読んだ生徒 %s', mockSid => {
  const sid = ids.get(mockSid)!, exp = tr(fx.perStudent[mockSid]);

  it('再テスト・参考書の進み・1回の時間・次の範囲', () => {
    const w = world();
    expect(reviewQueue(w, sid).map(r => ({ key: r.key, node: r.node, due: r.due, lp: r.lp, interval: r.interval, k: r.k }))).toEqual(exp.reviewQueue);
    const books = booksOf(w, sid).map(b => { const p = bookProgress(w, sid, b.materialId);
      return { material: b.materialId, total: p.total, done: p.done, rem: p.rem, perWeek: p.perWeek, needPerWeek: p.needPerWeek, finish: p.finish, late: p.late, status: p.status, expected: p.expected, avg: p.avg,
        cells: p.cells.map(c => ({ node: c.n.id, done: c.done, planned: c.planned, last: c.last, tries: c.tries, first: c.first || null })) }; });
    const byMat = (a: any[]) => [...a].sort((x, y) => x.material.localeCompare(y.material));
    // 始めて3週間たっていない本のペースはモックの誤りを直したので比べない（parity.test.ts と同じ）
    const young = new Set(booksOf(w, sid).filter(b => daysBetween(b.start, w.today) < 21).map(b => b.materialId));
    const strip = (a: any[]) => a.map(x => (young.has(x.material) ? { ...x, perWeek: 0, finish: null, late: 0, status: null } : x));
    expect(strip(byMat(books))).toEqual(strip(byMat(exp.books)));
    expect(Object.fromEntries(visibleMats(w).map(m => [m.id, typicalDur(w, sid, m.id)]))).toEqual(exp.typicalDur);
    expect(Object.fromEntries(visibleMats(w).map(m => [m.id, nextNode(w, sid, m.id)?.id || null]))).toEqual(exp.nextNode);
  });

  it('週のまとめ・小テスト不足・気になる点', () => {
    const w = world();
    for (const wk of [thisWeek, nextWeek]) {
      const s = weekStats(w, sid, wk), e = exp.weekStats[wk];
      expect({ due: s.due.length, done: s.done.length, minutes: s.minutes, perDay: s.perDay, missed: s.missed.map(t => t.id), planned: s.planned, avail: s.avail })
        .toEqual({ due: e.due, done: e.done, minutes: e.minutes, perDay: e.perDay, missed: e.missed, planned: e.planned, avail: e.avail });
      expect(Object.fromEntries(Object.entries(s.bySubject).map(([k, v]) => [SUBJECT_JA[k], v]))).toEqual(e.bySubject);
    }
    expect(shortages(w, sid).map(x => ({ node: x.node, why: x.why }))).toEqual(exp.shortages);
    expect(studentAlerts(w, sid)).toEqual(exp.alerts);
  });

  it('空き・週の案・面談の候補・空きを押したときの候補', () => {
    const w = world();
    expect(Object.fromEntries(weekDays(nextWeek).map(d => [d, freeGaps(w, sid, d)]))).toEqual(exp.freeGaps);
    expect(suggestions(w, sid, nextWeek).map(s => ({ key: s.key, kind: s.kind, node: s.node, date: s.date, time: s.time, dur: s.dur }))).toEqual(exp.suggestions);
    for (const wk of [thisWeek, nextWeek])
      expect(meetingSlots(w, sid, wk, { avoidTasks: false }).map(x => ({ date: x.date, time: x.time, fit: x.fit, same: x.same }))).toEqual(exp.meetingSlots[wk]);
    const blocks = weekBlocks(w, sid, nextWeek).map(b => {
      const g = blockGaps(w, sid, b)[0];
      const cands = g ? candidatesFor(w, sid, { date: b.date, s: g[0], e: g[1] }) : [];
      const fit = g ? fitSet(g[1] - g[0], g[0], orderSet(packGap(g[1] - g[0], cands))) : { items: [], used: 0 };
      return { cands: cands.map(c => ({ kind: c.kind, id: c.id, badge: c.badge, score: c.score, typ: c.typ })), fit: fit.items.map(x => ({ id: x.id, dur: x.dur, start: x.start })) };
    });
    expect(blocks).toEqual(exp.blocks.map((b: any) => ({ cands: b.candidates.map((c: any) => ({ kind: c.kind, id: c.id, badge: c.badge, score: c.score, typ: c.typ })), fit: b.fit.map((x: any) => ({ id: x.id, dur: x.dur, start: x.start })) })));
  });
});
