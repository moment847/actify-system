// 模試と過去問の成績。DB の行（exam_results / exam_subject_scores）を画面に出す形にする。
// 偏差値は模試ごとに母集団が違うので、別の会社の模試どうしの差は「参考」として出す（同じ会社の模試の差だけを「上がった・下がった」と書く）。
import type { DateStr } from './types';

export type Judgement = 'A' | 'B' | 'C' | 'D' | 'E';
export interface SubjectScore { subject: string; score: number | null; max: number | null; deviation: number | null }
export interface ExamResult {
  id: string;
  kind: 'mock' | 'past';
  title: string;
  provider: string;
  takenOn: DateStr;
  year: number | null;
  score: number | null;
  max: number | null;
  passing: number | null;
  deviation: number | null;
  target: string;
  judgement: Judgement | null;
  note: string;
  subjects: SubjectScore[];
}

/** 小数 d 桁で四捨五入（負の数も絶対値で丸める）。点数は DB で小数2桁、偏差値は1桁。浮動小数の誤差を表示に出さない */
const round = (n: number, d: number) => (Math.sign(n) * Math.round(Math.abs(n) * 10 ** d)) / 10 ** d || 0;
export const r1 = (n: number) => round(n, 1);
export const r2 = (n: number) => round(n, 2);
/** 偏差値の表示（57.3） */
export const fmt1 = (n: number) => (Number.isInteger(r1(n)) ? String(r1(n)) : r1(n).toFixed(1));
/** 点数の表示（118・129.95・12.5）。末尾の 0 は出さない */
export const fmtScore = (n: number) => String(r2(n));

export interface MockPoint { id: string; date: DateStr; title: string; provider: string; deviation: number | null; judgement: Judgement | null; target: string }
export interface MockTrend {
  points: MockPoint[];
  /** 直近の偏差値と、同じ会社の1つ前の模試との差（無ければ null） */
  latest: MockPoint | null;
  change: number | null;
  /** 科目ごとの偏差値の流れ（模試の順） */
  subjects: { subject: string; values: (number | null)[] }[];
}

export function mockTrend(results: ExamResult[]): MockTrend {
  const mocks = results.filter(r => r.kind === 'mock').sort((a, b) => a.takenOn.localeCompare(b.takenOn) || a.title.localeCompare(b.title));
  const points = mocks.map(r => ({ id: r.id, date: r.takenOn, title: r.title, provider: r.provider, deviation: r.deviation, judgement: r.judgement, target: r.target }));
  const latest = [...points].reverse().find(p => p.deviation != null) ?? null;
  let change: number | null = null;
  if (latest) {
    const prev = [...points].reverse().find(p => p.date <= latest.date && p.id !== latest.id && p.deviation != null && p.provider === latest.provider && p.provider !== '');
    if (prev) change = r1(latest.deviation! - prev.deviation!);
  }
  const names: string[] = [];
  mocks.forEach(r => r.subjects.forEach(s => { if (!names.includes(s.subject)) names.push(s.subject); }));
  const subjects = names.map(subject => ({ subject, values: mocks.map(r => r.subjects.find(s => s.subject === subject)?.deviation ?? null) }));
  return { points, latest, change, subjects };
}

export interface PastRow {
  id: string; year: number | null; date: DateStr; score: number | null; max: number | null; passing: number | null;
  /** 合格最低点との差（点）。最低点が入っていなければ null */
  gap: number | null;
  /** 得点率（%、整数） */
  rate: number | null;
  passingRate: number | null;
  note: string;
  subjects: SubjectScore[];
}
export interface PastGroup { title: string; rows: PastRow[]; best: PastRow | null; latest: PastRow }

/** 過去問を大学・学部（title）ごとにまとめ、年度の新しい順に並べる */
export function pastByTarget(results: ExamResult[]): PastGroup[] {
  const groups = new Map<string, PastRow[]>();
  for (const r of results.filter(x => x.kind === 'past')) {
    const gap = r.score != null && r.passing != null ? r2(r.score - r.passing) : null;
    const rate = r.score != null && r.max ? Math.round((r.score / r.max) * 100) : null;
    const passingRate = r.passing != null && r.max ? Math.round((r.passing / r.max) * 100) : null;
    const row: PastRow = { id: r.id, year: r.year, date: r.takenOn, score: r.score, max: r.max, passing: r.passing, gap, rate, passingRate, note: r.note, subjects: r.subjects };
    groups.set(r.title, [...(groups.get(r.title) ?? []), row]);
  }
  return [...groups].map(([title, rows]) => {
    rows.sort((a, b) => (b.year ?? 0) - (a.year ?? 0) || b.date.localeCompare(a.date));
    const latest = [...rows].sort((a, b) => b.date.localeCompare(a.date))[0];
    const withGap = rows.filter(x => x.gap != null);
    const best = withGap.length ? withGap.reduce((a, b) => (b.gap! > a.gap! ? b : a)) : null;
    return { title, rows, best, latest };
  }).sort((a, b) => b.latest.date.localeCompare(a.latest.date));
}

/** 「あと12点」「+3.5点」の形 */
export const gapLabel = (gap: number | null) => (gap == null ? '最低点が未入力' : gap >= 0 ? `最低点を${fmtScore(gap)}点上回る` : `最低点まであと${fmtScore(-gap)}点`);
