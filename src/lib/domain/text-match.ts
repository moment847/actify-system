// 文字から教材と範囲を見分ける（モック v19 の matchPdfName / parseFreeEntry を移したもの）
// - PDF のファイル名：「ターゲット1900_201-300_問題.pdf」→ 英単語ターゲット1900 / 201–300 / 問題
// - 講師の「自由に書く」欄：「模試の直し」→ 時間だけの予定、「ターゲット 801」→ その範囲、「古文」→ 次の範囲
import { booksOf, book, nextNode, tasksOf, visibleMats } from './plan';
import type { Material, Task, World } from './types';
import { VAGUE } from './types';

export const norm = (s: string) => String(s).normalize('NFKC').toLowerCase().replace(/[\s_\-–〜~・()（）［］[\]「」]/g, '');
export const nums = (s: string) => (String(s).normalize('NFKC').match(/\d+/g) || []).map(Number);
export const keysOf = (m: Material) => [m.name, m.short, ...(m.keywords || [])].map(norm).filter(k => k.length >= 2);

export interface PdfNameMatch { role: 'problem' | 'answer'; material: string | null; node: string | null; sure: boolean }

export function matchPdfName(name: string, materials: Material[]): PdfNameMatch {
  const base = name.replace(/\.pdf$/i, ''), n = norm(base);
  // 英字は語の切れ目で見る（「Transition」「plans」の ans を解答にしない）
  const role = /解答|答え|こたえ|(^|[^a-z])(answers?|ans|kaitou|kaito)(?![a-z])/i.test(base) ? 'answer' : 'problem';
  let best: Material | null = null, bestScore = 0;
  for (const m of materials.filter(x => !x.archived)) {
    const sc = keysOf(m).filter(k => n.includes(k)).reduce((a, k) => a + k.length, 0);
    if (sc > bestScore) { best = m; bestScore = sc; }
  }
  if (!best) return { role, material: null, node: null, sure: false };
  const fileNums = nums(base.replace(/第?\d+版|ver\.?\s*\d+|v\d+/gi, ''));
  let nodeHit: Material['units'][number] | null = null, nodeScore = 0;
  for (const nd of best.units) {
    const ln = nums(nd.label), text = norm(nd.label.replace(/\d+/g, '').normalize('NFKC').replace(/\d+/g, ''));
    let sc = 0;
    if (ln.length && ln.every(x => fileNums.includes(x))) sc += 10 + ln.length;
    if (text.length >= 2 && n.includes(text)) sc += 5;
    if (!ln.length && sc < 5) sc = 0;
    if (ln.length && sc < 10) sc = 0;
    if (sc > nodeScore) { nodeHit = nd; nodeScore = sc; }
  }
  let sure = !!nodeHit;
  const rest = fileNums.filter(x => !nums(best!.name).includes(x));
  // 「第3回」のような番号だけなら、順番で推測する（確かではない）
  if (!nodeHit && rest.length === 1 && best.units[rest[0] - 1]) { nodeHit = best.units[rest[0] - 1]; sure = false; }
  return { role, material: best.id, node: nodeHit?.id || null, sure };
}

export type FreeEntry =
  | { kind: 'vague'; v: (typeof VAGUE)[number]; title: string }
  | { kind: 'free'; title: string }
  | { kind: 'next'; m: Material; node: string | null }
  | { kind: 'node'; m: Material; node: string; done: boolean; planned: Task | undefined };

export function parseFreeEntry(w: World, sid: string, text: string): FreeEntry | null {
  const t = String(text || '').trim(); if (!t) return null;
  const vg = VAGUE.find(v => v.label === t); if (vg) return { kind: 'vague', v: vg, title: vg.label };
  const n = norm(t), nums_ = nums(t);
  let best: Material | null = null, bestScore = 0;
  const pool = booksOf(w, sid).map(b => w.materials.find(m => m.id === b.materialId)!).concat(visibleMats(w).filter(m => !book(w, sid, m.id)));
  for (const m of pool) {
    const sc = keysOf(m).filter(k => n.includes(k) || (k.includes(n) && n.length >= 2)).reduce((a, k) => a + Math.min(k.length, n.length), 0);
    if (sc > bestScore) { best = m; bestScore = sc; }
  }
  if (!best) return { kind: 'free', title: t };
  const m = best;
  let hit: Material['units'][number] | undefined;
  // 教材の名前の数字（ターゲット「1900」）は範囲の数字として使わない
  const own = new Set([m.name, m.short, ...(m.keywords || [])].flatMap(s => nums(s || '')));
  const typed = nums_.filter(v => !own.has(v));
  if (typed.length) hit = m.units.find(x => { const ln = nums(x.label); return ln.length > 0 && typed.every(v => ln.includes(v)); })
    // 「850」のように範囲の途中の数なら、その数を含む範囲（「801-900」）
    || m.units.find(x => { const ln = nums(x.label); return ln.length >= 2 && ln[0] <= typed[0] && typed[0] <= ln[ln.length - 1]; })
    || m.units.find(x => nums(x.label).includes(typed[0]));
  if (!hit) {
    const rest = norm(t.replace(/\d+/g, ''));
    hit = m.units.find(x => { const lt = norm(x.label.replace(/\d+/g, '')); return lt.length >= 2 && (rest.includes(lt) || (lt.includes(rest) && rest.length >= 3 && !keysOf(m).some(k => rest.includes(k)))); });
  }
  if (!hit) return { kind: 'next', m, node: nextNode(w, sid, m.id)?.id || null };
  const h = hit;
  const done = w.tasks.some(x => x.studentId === sid && x.unitId === h.id && x.status === 'done');
  const planned = tasksOf(w, sid).find(x => x.unitId === h.id && x.status !== 'done');
  return { kind: 'node', m, node: h.id, done, planned };
}
