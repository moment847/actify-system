// 計画まわりの計算（モック v19 の data.js / teacher.js を移したもの）。
// どれも World（読み込んだデータ）から答えを出すだけで、DB には書かない。
// 決まりの背景はモックの README「決めたこと」と reference/Actify-サービス全体レポート.md の8章。
import { byTime, clamp, dateAdd, daysBetween, dow, md, mdw, pct, toMin, toTime, weekDays, weekStart } from './dates';
import type { Book, DateStr, Material, QuizVersion, StudySlot, Task, TimeStr, Unit, World } from './types';

// ---------- 読み出し ----------
export const mat = (w: World, id: string | null | undefined) => (id ? w.materials.find(m => m.id === id) : undefined);
export const visibleMats = (w: World) => w.materials.filter(m => !m.archived);
export function unitOf(w: World, unitId: string | null | undefined): { unit: Unit; m: Material; index: number } | null {
  if (!unitId) return null;
  for (const m of w.materials) {
    const index = m.units.findIndex(u => u.id === unitId);
    if (index >= 0) return { unit: m.units[index], m, index };
  }
  return null;
}
export const tasksOf = (w: World, sid: string) => w.tasks.filter(t => t.studentId === sid);
export const isMissed = (w: World, t: Task) => t.status !== 'done' && t.date < w.today;
export const booksOf = (w: World, sid: string) => w.books.filter(b => b.studentId === sid && mat(w, b.materialId));
export const book = (w: World, sid: string, mid: string): Book | undefined => w.books.find(b => b.studentId === sid && b.materialId === mid);
/** 予定の題名（教材なら「略称 範囲」、時間だけなら題名） */
export const taskLabel = (w: World, t: Task) => t.title || `${mat(w, t.materialId)?.short ?? ''} ${unitOf(w, t.unitId)?.unit.label ?? ''}`.trim();

// ---------- 勉強できる時間 ----------
export const availOn = (w: World, sid: string, d: DateStr): StudySlot[] =>
  w.slots.filter(a => a.studentId === sid && (a.weekday !== null ? a.weekday === dow(d) && !w.slotSkips.has(`${a.id}:${d}`) : a.date === d))
    .sort((a, b) => a.start.localeCompare(b.start));
export const availRegistered = (w: World, sid: string, start: DateStr) => weekDays(start).some(d => availOn(w, sid, d).length > 0);
export const availMinutes = (w: World, sid: string, start: DateStr) =>
  weekDays(start).reduce((s, d) => s + availOn(w, sid, d).reduce((x, a) => x + toMin(a.end) - toMin(a.start), 0), 0);
export const inAvail = (w: World, t: Task) =>
  availOn(w, t.studentId, t.date).some(a => toMin(a.start) <= toMin(t.time) && toMin(a.end) >= toMin(t.time) + t.duration);
/** 先週の登録を今週に写すときに入れる枠（同じ時刻の枠がすでにあれば入れない） */
export function availCopyFromLastWeek(w: World, sid: string, start: DateStr): Omit<StudySlot, 'id'>[] {
  const prev = dateAdd(start, -7), out: Omit<StudySlot, 'id'>[] = [];
  weekDays(prev).forEach((d, i) => availOn(w, sid, d).forEach(a => {
    const nd = dateAdd(start, i);
    if (availOn(w, sid, nd).some(x => x.start === a.start && x.end === a.end)) return;
    out.push({ studentId: sid, date: nd, weekday: null, start: a.start, end: a.end, label: a.label || '' });
  }));
  return out;
}

// ---------- 小テスト（版） ----------
export const pdfOf = (w: World, t: Task) => (t.quizVersionId ? w.quizVersions.find(p => p.id === t.quizVersionId) : undefined);
export const pdfsOf = (w: World, unitId: string) => w.quizVersions.filter(p => p.unitId === unitId).sort((a, b) => a.version - b.version);
export const needsPdf = (w: World, unitId: string) => pdfsOf(w, unitId).length > 0 || unitOf(w, unitId)?.m.kind === 'input';
/** その生徒にまだ一度も付いていない版（付いている＝解いた、または予定に入っている） */
export const freePdf = (w: World, sid: string, unitId: string, except?: string): QuizVersion | undefined =>
  pdfsOf(w, unitId).find(p => !w.tasks.some(t => t.id !== except && t.studentId === sid && t.quizVersionId === p.id));
export const pdfUse = (w: World, sid: string, versionId: string): 'done' | 'planned' | null => {
  const ts = w.tasks.filter(t => t.studentId === sid && t.quizVersionId === versionId);
  return ts.some(t => t.status === 'done') ? 'done' : ts.length ? 'planned' : null;
};
export const pdfMissing = (w: World, t: Task) => t.status !== 'done' && !t.quizVersionId && !t.noQuiz && !!t.unitId && needsPdf(w, t.unitId);

// ---------- 参考書の進み ----------
export const nextNode = (w: World, sid: string, mid: string): Unit | undefined =>
  mat(w, mid)?.units.find(n => !w.tasks.some(t => t.studentId === sid && t.unitId === n.id));

export interface BookProgress {
  m: Material; b: Book | { target: DateStr; start: DateStr };
  total: number; done: number; rem: number;
  cells: { n: Unit; done: boolean; planned: boolean; last: number | null; tries: number; first?: DateStr }[];
  perWeek: number; needPerWeek: number; finish: DateStr | null; late: number;
  status: { label: '1周完了' | '順調' | 'やや遅れ' | '遅れ'; tone: 'green' | 'amber' | 'red' };
  /** 今日の目安（何範囲まで済んでいるとよいか） */
  expected: number;
  avg: number | null;
}
export function bookProgress(w: World, sid: string, mid: string): BookProgress {
  const m = mat(w, mid)!, b = book(w, sid, mid) || { target: dateAdd(w.today, 90), start: w.today };
  const total = m.units.length;
  const cells = m.units.map(n => {
    const ts = tasksOf(w, sid).filter(t => t.unitId === n.id).sort(byTime), done = ts.filter(t => t.status === 'done');
    const sc = done.filter(t => t.score != null).at(-1);
    return { n, done: done.length > 0, planned: ts.some(t => t.status !== 'done'), last: sc ? pct(sc.score!, sc.max!) : null, tries: done.length, first: done[0]?.date };
  });
  const done = cells.filter(c => c.done).length, rem = total - done;
  const recent = cells.filter(c => c.first && daysBetween(c.first, w.today) < 21).length;
  const perWeek = recent / 3;
  const weeksLeft = Math.max(daysBetween(w.today, b.target) / 7, 0.5);
  const finish = rem === 0 ? null : perWeek > 0 ? dateAdd(w.today, Math.ceil((rem / perWeek) * 7)) : null;
  const late = rem === 0 ? -1 : finish ? daysBetween(b.target, finish) : 999;
  const status: BookProgress['status'] = rem === 0 ? { label: '1周完了', tone: 'green' } : late <= 0 ? { label: '順調', tone: 'green' }
    : late <= 14 ? { label: 'やや遅れ', tone: 'amber' } : { label: '遅れ', tone: 'red' };
  const span = Math.max(1, daysBetween(b.start, b.target));
  const expected = clamp(Math.round((total * daysBetween(b.start, w.today)) / span), 0, total);
  const scored = cells.filter(c => c.last != null);
  return { m, b, total, done, rem, cells, perWeek, needPerWeek: rem / weeksLeft, finish, late, status, expected,
    avg: scored.length ? Math.round(scored.reduce((a, c) => a + c.last!, 0) / scored.length) : null };
}

/** 1回の時間：その生徒のその教材の実績（直近5回の平均、5分単位）。実績が無ければインプット30分・演習45分 */
export function typicalDur(w: World, sid: string, mid: string): number {
  const ts = tasksOf(w, sid).filter(t => t.materialId === mid && t.status === 'done' && t.actual).sort(byTime).slice(-5);
  if (!ts.length) return mat(w, mid)?.kind === 'input' ? 30 : 45;
  return Math.max(15, Math.round(ts.reduce((a, t) => a + t.actual!, 0) / ts.length / 5) * 5);
}

// ---------- 再テストの時期（インプットだけ） ----------
export interface ReviewItem {
  key: string; kind: 'review'; node: string; mat: Material; due: DateStr; last: Task; lp: number; interval: number; k: number;
}
export function reviewQueue(w: World, sid: string, asOf?: DateStr): ReviewItem[] {
  const out: ReviewItem[] = [];
  for (const m of w.materials) {
    if (m.kind !== 'input' || !m.intervals.length) continue;
    for (const n of m.units) {
      const ts = w.tasks.filter(t => t.studentId === sid && t.unitId === n.id && (!asOf || t.date <= asOf));
      if (!ts.length || ts.some(t => t.status !== 'done')) continue;
      // 段階は「やった回数」で進める（小テストが無くて点数が付かなかった回も1回と数える）
      const done = ts.sort(byTime), scored = done.filter(t => t.score != null);
      if (!scored.length) continue;
      const k = done.length, last = done.at(-1)!, ls = scored.at(-1)!, lp = pct(ls.score!, ls.max!);
      if (k > m.intervals.length && lp >= 60) continue; // 間隔を一通り終えて6割取れたら定着
      const interval = m.intervals[Math.min(k - 1, m.intervals.length - 1)];
      const key = `rv:${sid}:${n.id}:${k}`;
      if (w.reviewSkips.has(key)) continue;
      out.push({ key, kind: 'review', node: n.id, mat: m, due: dateAdd(last.date, interval), last, lp, interval, k });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

// ---------- 週のまとめ・気になる点 ----------
export function weekStats(w: World, sid: string, start: DateStr = weekStart(w.today)) {
  const end = dateAdd(start, 6), ts = tasksOf(w, sid).filter(t => t.date >= start && t.date <= end);
  const due = ts.filter(t => t.date <= w.today || t.status === 'done'), done = due.filter(t => t.status === 'done');
  const perDay = weekDays(start).map(d => done.filter(t => t.date === d).reduce((s, t) => s + (t.actual || 0), 0));
  const bySubject: Record<string, number> = {};
  done.forEach(t => { const s = mat(w, t.materialId)?.subject || 'other'; bySubject[s] = (bySubject[s] || 0) + (t.actual || 0); });
  return { start, end, ts, due, done, rate: pct(done.length, due.length), minutes: perDay.reduce((a, b) => a + b, 0), perDay, bySubject,
    missed: ts.filter(t => isMissed(w, t)), planned: ts.reduce((a, t) => a + t.duration, 0), avail: availMinutes(w, sid, start) };
}
export const lastRecord = (w: World, sid: string): DateStr | null =>
  tasksOf(w, sid).filter(t => t.status === 'done').map(t => t.date).sort().at(-1) || null;

/** 小テストが足りない所：予定に付けられない／2週間以内の再テストに使える版がない */
export function shortages(w: World, sid: string) {
  const out: { sid: string; node: string; why: string }[] = [];
  tasksOf(w, sid).filter(t => pdfMissing(w, t)).forEach(t => out.push({ sid, node: t.unitId!, why: `${mdw(t.date)}の予定` }));
  reviewQueue(w, sid).filter(r => r.due <= dateAdd(w.today, 14) && !freePdf(w, sid, r.node) && !out.some(x => x.node === r.node))
    .forEach(r => out.push({ sid, node: r.node, why: `再テスト（${r.due <= w.today ? '時期が来ています' : md(r.due) + '頃'}）` }));
  return out;
}

/** 講師のホームの「気になる点」 */
export function studentAlerts(w: World, sid: string) {
  const ws = weekStats(w, sid), l = lastRecord(w, sid), out: { tone: 'red' | 'amber' | 'ink'; text: string }[] = [];
  if (!l || daysBetween(l, w.today) >= 3) out.push({ tone: 'red', text: l ? `記録が${daysBetween(l, w.today)}日ない` : 'まだ記録がない' });
  if (ws.missed.length) out.push({ tone: 'red', text: `やり残し${ws.missed.length}件` });
  const lack = shortages(w, sid).length; if (lack) out.push({ tone: 'amber', text: `小テスト不足${lack}件` });
  const nextWeek = dateAdd(weekStart(w.today), 7), nw = weekStats(w, sid, nextWeek);
  if (!availRegistered(w, sid, nextWeek)) out.push({ tone: 'amber', text: '来週の勉強できる時間が未登録' });
  else if (nw.avail && nw.planned / nw.avail < 0.3) out.push({ tone: 'ink', text: '来週の計画がまだ' });
  return out;
}

// ---------- 面談 ----------
export const meetingOn = (w: World, sid: string, date: DateStr) => w.meetings.find(m => m.studentId === sid && m.date === date) || null;
export const meetingInWeek = (w: World, sid: string, start: DateStr) =>
  w.meetings.filter(m => m.studentId === sid && m.date >= start && m.date <= dateAdd(start, 6)).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
export const nextMeeting = (w: World, sid: string, from: DateStr = w.today) =>
  w.meetings.filter(m => m.studentId === sid && m.date >= from).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] || null;
export const lastMeeting = (w: World, sid: string) =>
  w.meetings.filter(m => m.studentId === sid && m.date < w.today).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
/** 予約は前日まで（当日は予約できない） */
export const canBook = (w: World, date: DateStr) => date > w.today;
export const coachOpenOn = (w: World, d: DateStr) =>
  w.coachOpen.filter(o => (o.weekday !== null ? o.weekday === dow(d) : o.date === d)).sort((a, b) => a.start.localeCompare(b.start));
export const coachOpenRegistered = (w: World, start: DateStr) => weekDays(start).some(d => coachOpenOn(w, d).length > 0);

/** その週に予約できる時間。講師の面談できる時間のうちほかの生徒が取っていない所。
 *  生徒の勉強できる時間と重なる所・先週と同じ時間・週末 を上に */
export function meetingSlots(w: World, sid: string, start: DateStr) {
  const len = w.meetingLength, out: { date: DateStr; time: TimeStr; fit: boolean; same: boolean; score: number }[] = [], last = lastMeeting(w, sid);
  weekDays(start).filter(d => canBook(w, d)).forEach(d => coachOpenOn(w, d).forEach(o => {
    for (let s = toMin(o.start); s + len <= toMin(o.end); s += 30) {
      if (w.meetings.some(m => m.studentId !== sid && m.date === d && toMin(m.time) < s + len && toMin(m.time) + m.len > s)) continue;
      const fit = availOn(w, sid, d).some(a => toMin(a.start) <= s && toMin(a.end) >= s + len);
      const same = !!last && dow(last.date) === dow(d) && last.time === toTime(s);
      out.push({ date: d, time: toTime(s), fit, same, score: (fit ? 100 : 0) + (same ? 60 : 0) + [0, 0, 0, 0, 10, 20, 15][dow(d)] - s / 600 });
    }
  }));
  return out.sort((a, b) => b.score - a.score);
}

// ---------- 空き時間 ----------
type Gap = [number, number];
/** その日の空き（勉強できる時間のうち、予定と面談が入っていない所。15分以上） */
export function freeGaps(w: World, sid: string, date: DateStr, extra: Record<DateStr, Gap[]> = {}): Gap[] {
  const mt = meetingOn(w, sid, date);
  const occ: Gap[] = [
    ...tasksOf(w, sid).filter(t => t.date === date).map(t => [toMin(t.time), toMin(t.time) + t.duration] as Gap),
    ...(mt ? [[toMin(mt.time), toMin(mt.time) + mt.len] as Gap] : []),
    ...(extra[date] || []),
  ].sort((a, b) => a[0] - b[0]);
  const out: Gap[] = [];
  for (const a of availOn(w, sid, date)) {
    let s = toMin(a.start); const e = toMin(a.end);
    for (const [os, oe] of occ) { if (oe <= s || os >= e) continue; if (os > s) out.push([s, os]); s = Math.max(s, oe); }
    if (e - s >= 15) out.push([s, e]);
  }
  return out.filter(g => g[1] - g[0] >= 15);
}

// ---------- 自動の案（週の空きに、再テスト → やり残し → 次の範囲 の順で置き場所を探す） ----------
export function suggestions(w: World, sid: string, start: DateStr, dismissed: Set<string> = new Set()) {
  const days = weekDays(start).filter(d => d > w.today);
  if (!days.length) return [];
  const end = dateAdd(start, 6);
  type Q = { key: string; kind: 'review' | 'move' | 'next'; node: string; mat: Material; why: string; earliest: DateStr; dur: number; task?: Task };
  const queue: Q[] = [];
  reviewQueue(w, sid).filter(r => r.due <= end && !dismissed.has(r.key)).forEach(r => queue.push({
    key: r.key, kind: 'review', node: r.node, mat: r.mat, why: `再テストの時期（前回${r.lp}%・${r.interval}日あけて${r.k + 1}回目）`, earliest: r.due, dur: typicalDur(w, sid, r.mat.id) }));
  tasksOf(w, sid).filter(t => isMissed(w, t) && t.unitId).forEach(t => { const key = 'mv:' + t.id;
    if (!dismissed.has(key)) queue.push({ key, kind: 'move', task: t, node: t.unitId!, mat: mat(w, t.materialId)!, why: `やり残し（${mdw(t.date)}にできなかった分）`, earliest: w.today, dur: t.duration }); });
  const lanes = booksOf(w, sid).map(b => {
    const p = bookProgress(w, sid, b.materialId), weekly = Math.ceil(p.rem / Math.max(daysBetween(start, b.target) / 7, 0.5));
    const already = tasksOf(w, sid).filter(t => t.materialId === b.materialId && !t.retest && t.date >= start && t.date <= end).length;
    const need = clamp(weekly - already, 0, 4), list: Q[] = [];
    for (const n of p.m.units) {
      if (list.length >= need) break;
      if (w.tasks.some(t => t.studentId === sid && t.unitId === n.id)) continue;
      const key = 'nx:' + sid + ':' + n.id;
      if (!dismissed.has(key)) list.push({ key, kind: 'next', node: n.id, mat: p.m, why: `目標${md(b.target)}に間に合うよう今週あと${need}範囲`, earliest: w.today, dur: typicalDur(w, sid, p.m.id) });
    }
    return list;
  });
  for (let i = 0; lanes.some(l => l[i]); i++) lanes.forEach(l => l[i] && queue.push(l[i]));
  const extra: Record<DateStr, Gap[]> = {}, load: Record<DateStr, number> = {}, out: (Q & { date: DateStr; time: TimeStr })[] = [];
  for (const q of queue) {
    const cands = days.filter(d => d >= q.earliest);
    // 次の範囲は日をばらす（案の少ない日から）。再テストとやり残しは早い日から
    const order = q.kind === 'next' ? [...cands].sort((a, b) => (load[a] || 0) - (load[b] || 0) || a.localeCompare(b)) : cands;
    for (const d of order) {
      const g = freeGaps(w, sid, d, extra).find(([s, e]) => e - s >= q.dur);
      if (!g) continue;
      const s = Math.ceil(g[0] / 5) * 5;
      (extra[d] ||= []).push([s, s + q.dur]); load[d] = (load[d] || 0) + 1;
      out.push({ ...q, date: d, time: toTime(s) }); break;
    }
  }
  return out;
}

// ---------- 計画：空きを押して入れる（講師の画面） ----------
export const MIN_GAP = 15, MIN_TASK = 15, SHRINK = 0.8, STRETCH = 1.5;
const round5 = (x: number) => Math.round(x / 5) * 5;

/** 1つだけ入れるときの長さ：短い枠はいっぱいに。長い枠はいつもの時間（端数が20分未満ならいっぱいに） */
export function fitDur(len: number, typical: number) {
  if (len <= typical + 20) return len;
  return len - typical < 20 ? len : typical;
}

export interface Block { date: DateStr; s: number; e: number; label: string }
/** 勉強できる時間のまとまり（明日以降） */
export const weekBlocks = (w: World, sid: string, start: DateStr): Block[] =>
  weekDays(start).filter(d => d > w.today).flatMap(d => availOn(w, sid, d).map(a => ({ date: d, s: toMin(a.start), e: toMin(a.end), label: a.label })));
export const blockAt = (w: World, sid: string, date: DateStr, m: number) =>
  date > w.today ? weekBlocks(w, sid, weekStart(date)).find(b => b.date === date && m >= b.s && m < b.e) || null : null;
export const inBlock = (t: Task, b: Block) => t.date === b.date && toMin(t.time) >= b.s && toMin(t.time) < b.e;
export const blockTasks = (w: World, sid: string, b: Block) => tasksOf(w, sid).filter(t => inBlock(t, b)).sort(byTime);
export const blockGaps = (w: World, sid: string, b: Block) => freeGaps(w, sid, b.date).filter(([s, e]) => s >= b.s && e <= b.e && e - s >= MIN_GAP);

/** 一覧で長さを変えた・外したあとは、枠の頭から順に詰め直す（面談の時間はよける）。動いた予定の新しい時刻を返す */
export function repack(w: World, sid: string, b: Block): { id: string; time: TimeStr }[] {
  const mt = meetingOn(w, sid, b.date), ms = mt ? toMin(mt.time) : -1, me = mt ? ms + mt.len : -1;
  let at = b.s; const out: { id: string; time: TimeStr }[] = [];
  blockTasks(w, sid, b).forEach(t => { if (mt && at < me && at + t.duration > ms) at = Math.max(at, me); const time = toTime(at); if (time !== t.time) out.push({ id: t.id, time }); t.time = time; at += t.duration; });
  return out;
}

export interface Candidate {
  kind: 'review' | 'task' | 'node'; id: string; node: string; m: Material;
  badge: '再テスト' | 'やり残し' | '次の範囲' | '先取り' | '解き直し'; tone: 'amber' | 'red' | 'blue' | 'gray';
  reason: string; score: number; typ: number; pdf?: QuizVersion; task?: Task;
}
/** この空きに入れられるもの（再テスト・やり残し・参考書の次の範囲・解き直し）を、入れたい順に */
export function candidatesFor(w: World, sid: string, gap: { date: DateStr; s: number; e: number }): Candidate[] {
  const len = gap.e - gap.s, sameDay = tasksOf(w, sid).filter(t => t.date === gap.date).map(t => t.materialId);
  const planned = (id: string) => w.tasks.some(t => t.studentId === sid && t.unitId === id && t.status !== 'done');
  const c: Candidate[] = [];
  reviewQueue(w, sid).forEach(r => {
    if (planned(r.node) || r.due > dateAdd(gap.date, 3)) return;
    const late = daysBetween(r.due, gap.date);
    c.push({ kind: 'review', id: r.key, node: r.node, m: r.mat, badge: '再テスト', tone: 'amber',
      reason: `${late >= 0 ? '時期が来た' : md(r.due) + 'が時期'}・前回${r.lp}%`, score: 100 + Math.min(late, 10) - (late < 0 ? 30 : 0), typ: 0 });
  });
  tasksOf(w, sid).filter(t => isMissed(w, t) && t.unitId).forEach(t => c.push({ kind: 'task', id: t.id, node: t.unitId!, m: mat(w, t.materialId)!, badge: 'やり残し', tone: 'red', reason: `${md(t.date)}にできなかった分`, score: 90, task: t, typ: 0 }));
  // 参考書の次の範囲：目標日から逆算した今週の目安（＋1）を、週の中にならして出す。目安を超えた分は「先取り」として後回し
  const wk = weekDays(weekStart(gap.date)), di = wk.indexOf(gap.date);
  booksOf(w, sid).forEach(b => {
    const p = bookProgress(w, sid, b.materialId), behind = p.status.tone !== 'green', quota = Math.ceil(p.needPerWeek || 1) + 1;
    const placed = tasksOf(w, sid).filter(t => t.materialId === b.materialId && !t.retest && wk.includes(t.date)).length, expected = (quota * (di + 1)) / 7;
    p.m.units.filter(x => !w.tasks.some(t => t.studentId === sid && t.unitId === x.id)).slice(0, 2).forEach((n, i) => {
      const k = placed + i, ahead = k >= quota;
      c.push({ kind: 'node', id: n.id, node: n.id, m: p.m, badge: ahead ? '先取り' : '次の範囲', tone: ahead ? 'gray' : 'blue',
        reason: ahead ? `今週の目安${quota}範囲は入れ終わり` : i ? `その次・今週の目安${quota}範囲` : behind ? `遅れ気味・目標${md(p.b.target)}` : `続き・今週の目安${quota}範囲`,
        score: ahead ? 15 - i * 10 : (behind ? 75 : 55) + Math.round((expected - k) * 20) - i * 30, typ: 0 });
    });
    // 演習の解き直し：前回7割未満で、まだ解き直していない範囲
    if (p.m.kind === 'practice') p.m.units.forEach(n => {
      const ts = tasksOf(w, sid).filter(t => t.unitId === n.id).sort(byTime), last = ts.at(-1);
      if (!last || last.status !== 'done' || last.score == null || ts.length > 1) return;
      const lp = pct(last.score, last.max!); if (lp >= 70) return;
      c.push({ kind: 'node', id: n.id, node: n.id, m: p.m, badge: '解き直し', tone: 'amber', reason: `前回${lp}%・間違えた所をもう一度`, score: 45 - lp / 10, typ: 0 });
    });
  });
  c.forEach(x => {
    x.typ = x.task ? x.task.duration : typicalDur(w, sid, x.m.id);
    if (len <= 45 && x.m.kind === 'practice') x.score -= 45;   // 短い枠（朝・電車）は覚えるものを優先
    if (sameDay.includes(x.m.id)) x.score -= 20;               // 同じ日に同じ教材が続かないように
    x.pdf = x.task ? pdfOf(w, x.task) : freePdf(w, sid, x.node);
    if (!x.pdf && needsPdf(w, x.node)) x.score -= 8;
  });
  return c.sort((a, b) => b.score - a.score);
}
/** 案に入る？（いつもの時間の合計を2割まで縮めて枠に収まるなら入る） */
const fitsIn = (len: number, items: Candidate[], x: Candidate) =>
  (items.reduce((a, y) => a + y.typ, 0) + x.typ) * SHRINK <= len && (items.length + 1) * MIN_TASK <= len;
/** 枠の長さにぴったり合う組み合わせを選ぶ。まず教材が重ならないように、足りなければ同じ教材の続きも */
export function packGap(len: number, cands: Candidate[]): Candidate[] {
  const set: Candidate[] = [], mats = new Set<string>(); let sum = 0;
  for (const pass of [0, 1]) for (const x of cands) {
    if (len - sum < 25) return set;   // 残りが短ければ、入れたものを少し伸ばして埋める
    if (set.includes(x) || (pass === 0 && mats.has(x.m.id))) continue;
    if (set.length ? sum + x.typ > len + 5 : !fitsIn(len, set, x)) continue;  // 縮めてよいのは1件目だけ
    set.push(x); mats.add(x.m.id); sum += x.typ;
  }
  return set;
}
/** 枠の中の並び：考える演習を先に、覚えるもの（単語・再テスト）を後に（寝る前に覚えたものは残りやすい。Gais ほか 2006） */
export const orderSet = <T extends { m: Material }>(items: T[]) => [...items].sort((a, b) => (a.m.kind === 'practice' ? 0 : 1) - (b.m.kind === 'practice' ? 0 : 1));
/** 枠の長さに合わせて時間を配る（5分単位。合計が枠の長さぴったりになるように。伸ばすのは1.5倍まで） */
export function fitSet<T extends { typ: number }>(len: number, gapStart: number, items: T[]) {
  const sum = items.reduce((a, x) => a + x.typ, 0); if (!sum) return { items: [] as (T & { dur: number; start: number })[], used: 0 };
  const k = Math.min(STRETCH, len / sum), target = k >= STRETCH ? Math.min(len, round5(sum * k)) : len;
  const durs = items.map(x => Math.max(MIN_TASK, round5(x.typ * k)));
  for (let diff = target - durs.reduce((a, b) => a + b, 0), g = 0; diff && g < 200; g++) {
    const i = durs.indexOf(Math.max(...durs)), step = Math.abs(diff) >= 5 ? 5 * Math.sign(diff) : diff;
    if (durs[i] + step < MIN_TASK) break;
    durs[i] += step; diff -= step;
  }
  let at = gapStart;
  return { items: items.map((x, i) => { const o = { ...x, dur: durs[i], start: at }; at += durs[i]; return o; }), used: at - gapStart };
}
/** 参考書の「次の範囲」をこの時刻に入れたら、どの範囲になるか（範囲は日付の順にそろう） */
export function predictRange(w: World, sid: string, mid: string, date: DateStr, s: number) {
  const m = mat(w, mid)!, nxt = nextNode(w, sid, mid); if (!nxt) return null;
  const idx = (id: string) => m.units.findIndex(n => n.id === id);
  const plan = tasksOf(w, sid).filter(t => t.materialId === mid && t.status !== 'done' && !t.retest);
  const nodes = [...plan.map(t => t.unitId!), nxt.id].sort((a, b) => idx(a) - idx(b));
  const before = plan.filter(t => t.date + t.time < date + toTime(s)).length;
  return { node: nodes[before], shifted: nodes[before] !== nxt.id };
}
/** おすすめの中身を、押す前に見せる（入れはしない） */
export function recommendPreview(w: World, sid: string, b: Block) {
  const g = blockGaps(w, sid, b)[0]; if (!g) return [];
  return orderSet(packGap(g[1] - g[0], candidatesFor(w, sid, { date: b.date, s: g[0], e: g[1] })));
}

/** 予定を1件、World に入れる（DB に入れる前の計算用。小テストはまだ使っていない版） */
export function putTask(w: World, sid: string, date: DateStr, s: number, duration: number, kind: 'task' | 'review' | 'node', id: string, newId: () => string): Task | null {
  if (kind === 'task') {
    const t = w.tasks.find(x => x.id === id); if (!t || t.status === 'done') return null;
    t.date = date; t.time = toTime(s); t.duration = duration; return t;
  }
  const nid = kind === 'review' ? reviewQueue(w, sid).find(r => r.key === id)?.node : id;
  if (!nid) return null;
  const u = unitOf(w, nid); if (!u) return null;
  const p = freePdf(w, sid, nid);
  const t: Task = { id: newId(), studentId: sid, date, time: toTime(s), duration, materialId: u.m.id, unitId: nid, vague: null, title: null, status: 'todo',
    quizVersionId: p?.id || null, max: p?.max ?? null, noQuiz: false, score: null, actual: null,
    retest: w.tasks.some(o => o.studentId === sid && o.unitId === nid && o.status === 'done') };
  w.tasks.push(t); return t;
}

/** 「おすすめで残りを埋める」：枠の空きごとに、長さにぴったりの組み合わせを入れる。入れた予定を返す（World も更新する） */
export function recommendFill(w: World, sid: string, b: Block, newId: () => string): Task[] {
  const out: Task[] = [];
  for (const [s, e] of blockGaps(w, sid, b)) {
    const gap = { date: b.date, s, e }, fit = fitSet(e - s, s, orderSet(packGap(e - s, candidatesFor(w, sid, gap))));
    fit.items.forEach(x => { const t = putTask(w, sid, b.date, x.start, x.dur, x.kind, x.id, newId); if (t) out.push(t); });
  }
  return out;
}

/** 範囲を押したときの初期の時間：表示中の週（今日より後）で最初に空いている所 */
export function firstFreeSlot(w: World, sid: string, len: number, start: DateStr) {
  const from = start > w.today ? start : dateAdd(w.today, 1);
  for (let i = 0; i < 21; i++) { const d = dateAdd(from, i), g = freeGaps(w, sid, d).find(([s, e]) => e - s >= len); if (g) return { date: d, time: toTime(Math.ceil(g[0] / 5) * 5) }; }
  return { date: from, time: '19:00' };
}

/** 範囲の順番をそろえる（DB の private.normalize_plan と同じ決まり）。入れる前の見通しと通知の文に使う。World も更新する */
export function resequence(w: World, sid: string): { t: Task; from: string }[] {
  const changes: { t: Task; from: string }[] = [];
  for (const m of w.materials) {
    const plan = tasksOf(w, sid).filter(t => t.materialId === m.id && t.status !== 'done' && !t.retest).sort(byTime);
    if (plan.length < 2) continue;
    const idx = (id: string) => m.units.findIndex(n => n.id === id), nodes = plan.map(t => t.unitId!).sort((a, b) => idx(a) - idx(b));
    const moved = plan.filter((t, i) => t.unitId !== nodes[i]);
    if (!moved.length) continue;
    moved.forEach(t => { changes.push({ t, from: t.unitId! }); t.unitId = nodes[plan.indexOf(t)]; if (!t.noQuiz) t.quizVersionId = null; });
    moved.forEach(t => { if (t.noQuiz) return; const p = freePdf(w, sid, t.unitId!, t.id); t.quizVersionId = p?.id || null; if (p) t.max = p.max; });
  }
  return changes;
}
