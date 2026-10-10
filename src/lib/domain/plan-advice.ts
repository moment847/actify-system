// AI の予定の提案（講師向け）。AI は「方針」だけを決め、日時に置くのは今までの計算（suggestions）。
// - 方針：多めにする教材・少なめにする教材・軽くする日・講師に伝えたいこと
// - AI の返事はそのまま信じない（cleanAdvice）：生徒が持っていない教材・その週ではない日は捨てる
// - AI に日時まで書かせない理由：重なり・面談・締め切り・小テストの付け方などの決まりは計算と DB が持っている。AI に任せると破る
import { dateAdd, md, mdw, toMin, weekDays } from './dates';
import { availOn, booksOf, bookProgress, freeGaps, mat, suggestions, type PlanAdjust } from './plan';
import type { DateStr, TimeStr, World } from './types';

/** AI が返す方針（zod の形は src/lib/ai/plan-advice.ts） */
export interface PlanAdvice {
  summary: string;
  focus: { materialId: string; change: 'more' | 'less' | 'keep'; reason: string }[];
  lighterDays: { date: DateStr; reason: string }[];
  notes: string[];
}

/** 予定の案の1件（保存して、講師が選んだものだけを入れる） */
export interface PlanItem {
  key: string;
  kind: 'review' | 'move' | 'next';
  date: DateStr; time: TimeStr; dur: number;
  materialId: string; unitId: string;
  /** やり残しを動かすときの元の予定 */
  taskId?: string;
  label: string;
  why: string;
}

/** 面談の記録（講師だけが読む）。AI の文脈に入れる形 */
export interface NoteForContext { onDate: DateStr; kind: 'minutes' | 'memo'; body: string; summary?: { decided?: string[]; homework?: string[]; concerns?: string[] } | null; sharedTodo: string }

const MAX_NOTE_CHARS = 1500, MAX_NOTES_CHARS = 6000;

/** AI の返事を、生徒の教材とその週の日だけに絞る。理由も長さを切る */
export function cleanAdvice(raw: PlanAdvice, w: World, sid: string, start: DateStr): PlanAdvice {
  const mine = new Set(booksOf(w, sid).map(b => b.materialId)), week = new Set(weekDays(start));
  const cut = (s: string, n: number) => String(s ?? '').trim().slice(0, n);
  const seen = new Set<string>();
  return {
    summary: cut(raw.summary, 300),
    focus: (raw.focus ?? []).filter(f => mine.has(f.materialId) && !seen.has(f.materialId) && seen.add(f.materialId))
      .map(f => ({ materialId: f.materialId, change: f.change, reason: cut(f.reason, 120) })).slice(0, 10),
    lighterDays: (raw.lighterDays ?? []).filter(d => week.has(d.date)).map(d => ({ date: d.date, reason: cut(d.reason, 120) })).slice(0, 7),
    notes: (raw.notes ?? []).map(n => cut(n, 200)).filter(Boolean).slice(0, 5),
  };
}

export const adviceToAdjust = (a: PlanAdvice): PlanAdjust => ({
  more: new Set(a.focus.filter(f => f.change === 'more').map(f => f.materialId)),
  less: new Set(a.focus.filter(f => f.change === 'less').map(f => f.materialId)),
  avoidDays: new Set(a.lighterDays.map(d => d.date)),
});

/** 方針を計算に渡して、日時の決まった予定の案にする */
export function proposalItems(w: World, sid: string, start: DateStr, advice: PlanAdvice): PlanItem[] {
  return suggestions(w, sid, start, new Set(), adviceToAdjust(advice)).map(q => ({
    key: q.key, kind: q.kind, date: q.date, time: q.time, dur: q.dur, materialId: q.mat.id, unitId: q.node,
    ...(q.task ? { taskId: q.task.id } : {}),
    label: `${q.mat.short} ${q.mat.units.find(u => u.id === q.node)?.label ?? ''}`.trim(),
    why: q.why,
  }));
}

/** AI に渡す文脈：記録（新しい順・長さを切る）＋その週の空き時間。教材は ID で指せるように一覧で渡す */
export function planContext(w: World, sid: string, start: DateStr, base: string, notes: NoteForContext[]): string {
  const lines = [base, '', `提案する週：${mdw(start)}〜${mdw(dateAdd(start, 6))}`];
  lines.push('教材（materialId で指す）：');
  booksOf(w, sid).forEach(b => { const p = bookProgress(w, sid, b.materialId); lines.push(`- ${b.materialId}：${mat(w, b.materialId)?.name ?? ''}（${p.status.label}・${p.done}/${p.total}・目標${md(b.target)}）`); });
  lines.push('その週の勉強できる時間（空き）：');
  weekDays(start).forEach(d => {
    const total = availOn(w, sid, d).reduce((a, x) => a + toMin(x.end) - toMin(x.start), 0);
    const free = freeGaps(w, sid, d).reduce((a, [s, e]) => a + e - s, 0);
    lines.push(`- ${d}（${mdw(d)}）：登録${total}分・空き${free}分${d <= w.today ? '（過ぎた日）' : ''}`);
  });
  lines.push('', '面談の記録（新しい順。講師だけが読むもの）：');
  let used = 0;
  for (const n of notes) {
    if (used >= MAX_NOTES_CHARS) break;
    const s = n.summary;
    const parts = [
      s?.decided?.length ? `決めたこと：${s.decided.join('／')}` : '',
      s?.homework?.length ? `宿題：${s.homework.join('／')}` : '',
      s?.concerns?.length ? `気になること：${s.concerns.join('／')}` : '',
      n.sharedTodo ? `生徒に共有した「次回までにやること」：${n.sharedTodo}` : '',
      n.body ? `本文：${n.body.slice(0, MAX_NOTE_CHARS)}` : '',
    ].filter(Boolean).join('\n  ');
    const block = `- ${n.onDate}（${n.kind === 'minutes' ? '面談' : 'メモ'}）\n  ${parts}`;
    lines.push(block.slice(0, MAX_NOTES_CHARS - used));
    used += block.length;
  }
  if (!notes.length) lines.push('- まだありません');
  return lines.join('\n');
}
