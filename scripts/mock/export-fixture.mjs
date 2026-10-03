// モック v19 の計算結果を「正解データ」として書き出す。
// TypeScript に移した計算（src/lib/domain）が、モックと同じ答えを出すかをテストで確かめるために使う。
// 使い方: node scripts/mock/export-fixture.mjs  → src/lib/domain/__fixtures__/mock-v19.json
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const src = f => readFileSync(join(root, 'reference', 'mock-v19', f), 'utf8');

const noop = () => {};
const el = { addEventListener: noop, querySelector: () => null, querySelectorAll: () => [], style: { setProperty: noop }, classList: { add: noop, remove: noop, toggle: noop } };
const ctx = {
  console, Math, Date, JSON, String, Number, Array, Object, Set, Map, Promise, RegExp, Error, Intl,
  innerWidth: 1440, addEventListener: noop, setTimeout: () => 0, clearTimeout: noop, setInterval: () => 0, clearInterval: noop,
  matchMedia: () => ({ matches: false, addEventListener: noop }),
  localStorage: { getItem: () => null, setItem: noop },
  document: { ...el, documentElement: el, body: { dataset: {} } },
  location: { hash: '' }, navigator: {}, URL: { createObjectURL: () => 'blob:' },
  requestAnimationFrame: noop, performance: { now: () => 0 },
};
ctx.window = { self: 1, top: 1 };
vm.createContext(ctx);

// ui は main.js にあるが、teacher.js の一部が参照するので最小限だけ用意する
const prelude = `var ui = { open: {}, dismissed: new Set() }; var W = { hidden: true };`;
const exporter = `
;(() => {
  const clone = o => JSON.parse(JSON.stringify(o));
  const sids = students().map(p => p.id);
  const thisWeek = weekStart(DAY), nextWeek = dateAdd(thisWeek, 7);
  const out = { day: DAY, state: clone(state), perStudent: {}, pdfNames: {}, freeEntry: {}, scenarios: {} };
  for (const sid of sids) {
    const o = out.perStudent[sid] = {};
    o.reviewQueue = reviewQueue(sid).map(r => ({ key: r.key, node: r.node, due: r.due, lp: r.lp, interval: r.interval, k: r.k }));
    o.books = booksOf(sid).map(b => { const p = bookProgress(sid, b.material);
      return { material: b.material, total: p.total, done: p.done, rem: p.rem, perWeek: p.perWeek, needPerWeek: p.needPerWeek, finish: p.finish, late: p.late, status: p.status, expected: p.expected, avg: p.avg,
        cells: p.cells.map(c => ({ node: c.n.id, done: c.done, planned: c.planned, last: c.last, tries: c.tries, first: c.first || null })) }; });
    o.typicalDur = Object.fromEntries(state.materials.filter(m => !m.hidden).map(m => [m.id, typicalDur(sid, m.id)]));
    o.nextNode = Object.fromEntries(state.materials.filter(m => !m.hidden).map(m => [m.id, nextNode(sid, m.id)?.id || null]));
    const ws = w => { const s = weekStats(sid, w); return { due: s.due.length, done: s.done.length, rate: s.rate, minutes: s.minutes, perDay: s.perDay, bySubject: s.bySubject, missed: s.missed.map(t => t.id), planned: s.planned, avail: s.avail }; };
    o.weekStats = { [thisWeek]: ws(thisWeek), [nextWeek]: ws(nextWeek) };
    o.shortages = shortages(sid).map(x => ({ node: x.node, why: x.why }));
    o.alerts = studentAlerts(sid);
    o.lastRecord = lastRecord(sid);
    o.availRegistered = { [thisWeek]: availRegistered(sid, thisWeek), [nextWeek]: availRegistered(sid, nextWeek) };
    o.freeGaps = Object.fromEntries(weekDays(nextWeek).map(d => [d, freeGaps(sid, d)]));
    o.suggestions = suggestions(sid, nextWeek).map(s => ({ key: s.key, kind: s.kind, node: s.node, date: s.date, time: s.time, dur: s.dur }));
    o.meetingSlots = { [thisWeek]: meetingSlots(sid, thisWeek).map(x => ({ date: x.date, time: x.time, fit: x.fit, same: !!x.same })), [nextWeek]: meetingSlots(sid, nextWeek).map(x => ({ date: x.date, time: x.time, fit: x.fit, same: !!x.same })) };
    o.blocks = weekBlocks(sid, nextWeek).map(b => {
      const gaps = blockGaps(sid, b), g = gaps[0];
      const cands = g ? candidatesFor(sid, { date: b.date, s: g[0], e: g[1] }) : [];
      const pack = g ? orderSet(packGap(g[1] - g[0], cands)) : [];
      const fit = g ? fitSet(g[1] - g[0], g[0], pack) : { items: [], used: 0 };
      return { date: b.date, s: b.s, e: b.e, gaps,
        candidates: cands.map(c => ({ kind: c.kind, id: c.id, node: c.node, badge: c.badge, score: c.score, typ: c.typ })),
        fit: fit.items.map(x => ({ id: x.id, node: x.node, dur: x.dur, start: x.start })), used: fit.used };
    });
  }
  const names = ['ターゲット1900_1301-1400_問題.pdf', 'ターゲット1900_1301-1400_解答.pdf', '古文_古文単語001-050_問題.pdf', '古文_古文単語051-100_解答.pdf', '長文トレ_Unit11.pdf', '数学基礎_確率2.pdf', 'スキャン_0012.pdf', 'target_201-300_answer.pdf', '英単語ターゲット1900 第3版 501-600.pdf', '古文_助動詞1_問題.pdf', '数学_第3回.pdf'];
  for (const n of names) out.pdfNames[n] = matchPdfName(n);
  for (const t of ['模試の直し', 'ターゲット 801', 'ターゲット 501', '古文', '古文 用言', '長文 unit 7', '予備時間', '数学 確率', 'target', '学校の課題（英語）']) {
    const pe = parseFreeEntry('s1', t);
    out.freeEntry[t] = pe && { kind: pe.kind, title: pe.title || null, material: pe.m?.id || null, node: pe.node || null, done: pe.done ?? null, planned: pe.planned?.id || null, vague: pe.v?.k || null };
  }
  // 範囲の順番：土曜に次の範囲を入れたあとで火曜に足すと、火曜が若い番号になる
  {
    const snap = JSON.stringify(state), sid = 's1', mid = 'en';
    const sat = dateAdd(nextWeek, 5), tue = dateAdd(nextWeek, 1);
    const n1 = nextNode(sid, mid).id; putTask(sid, sat, 9 * 60, 30, 'node', n1);
    const n2 = nextNode(sid, mid).id; putTask(sid, tue, 6 * 60, 30, 'node', n2);
    const changes = resequence(sid);
    out.scenarios.resequence = { sat, tue, n1, n2,
      changes: changes.length,
      result: tasksOf(sid).filter(t => t.material === mid && t.status !== 'done' && !t.retest).sort(byTime).map(t => ({ date: t.date, time: t.time, node: t.node })) };
    state = JSON.parse(snap);
  }
  // おすすめで埋める：来週の最初の枠
  {
    const snap = JSON.stringify(state), sid = 's1';
    const b = weekBlocks(sid, nextWeek)[0];
    const put = recommendFill(sid, b);
    out.scenarios.recommendFill = { block: { date: b.date, s: b.s, e: b.e }, put: put.map(t => ({ time: t.time, duration: t.duration, node: t.node, retest: t.retest, pdf: t.pdf })) };
    state = JSON.parse(snap);
  }
  globalThis.__out = out;
})();`;

const files = ['core.js', 'data.js', 'teacher.js'].map(src).join('\n;\n');
vm.runInContext(prelude + '\n' + files + '\n' + exporter, ctx, { filename: 'mock-v19-bundle.js' });

const dest = join(root, 'src', 'lib', 'domain', '__fixtures__', 'mock-v19.json');
mkdirSync(dirname(dest), { recursive: true });
writeFileSync(dest, JSON.stringify(ctx.__out, null, 1));
const o = ctx.__out;
console.log('wrote', dest, 'tasks', o.state.tasks.length, 'students', Object.keys(o.perStudent).length);
