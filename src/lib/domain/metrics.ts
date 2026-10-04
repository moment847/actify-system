// 運営（塾の管理者）の数字。生徒の記録・振り返り・講師の返信から作る。DB に集計表は持たない（毎回数える）。
// - 記録を続けている割合：その週に1回でも「完了」を記録した在籍生徒の割合（週は月曜はじまり、生徒の暦の日付）
// - 止まっている生徒：最後の記録から3日以上（講師のホームの「記録が○日ない」と同じ基準）
// - 返信の速さ：生徒の振り返りから講師の返信までの時間（中央値）。返信の無い振り返りは「返信待ち」として別に数える（直近2週間のひとことだけ）
import { dateAdd, daysBetween, pct, weekStart } from './dates';
import type { DateStr } from './types';

export const STALL_DAYS = 3;
/** 振り返りから何時間たっても返信が無ければ「返信待ちが長い」に数えるか */
export const SLOW_REPLY_HOURS = 48;
/** 返信待ちに数えるのは、直近この日数のひとことだけ（古いひとことに今さら返信は求めない） */
export const WAIT_WINDOW_DAYS = 14;

export interface MetricStudent { id: string; name: string; coachIds: string[]; mainCoachId: string | null; joinedOn: DateStr }
export interface MetricCoach { id: string; name: string }
export interface FeedbackEvent { taskId: string; studentId: string; at: string }
export interface ReplyEvent { taskId: string; coachId: string | null; at: string }

export interface SchoolMetrics {
  activeStudents: number;
  /** 直近の週から古い順に8週 */
  weeks: { start: DateStr; active: number; total: number; rate: number }[];
  thisWeekRate: number;
  stalled: { id: string; name: string; days: number | null; coach: string }[];
  coaches: {
    id: string; name: string; students: number;
    replied: number; medianHours: number | null;
    /** 返信の無い振り返り（そのうち SLOW_REPLY_HOURS を過ぎたもの） */
    waiting: number; waitingLong: number;
  }[];
}

const median = (xs: number[]) => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * @param doneDates 生徒ごとの「完了」を記録した日（生徒の暦の日付）
 * @param now 返信待ちの時間を数える基準
 */
export function schoolMetrics(input: {
  today: DateStr; now: Date;
  students: MetricStudent[]; coaches: MetricCoach[];
  doneDates: Map<string, DateStr[]>;
  feedback: FeedbackEvent[]; replies: ReplyEvent[];
  weeks?: number;
}): SchoolMetrics {
  const { today, students, coaches } = input;
  const nWeeks = input.weeks ?? 8;
  const cur = weekStart(today);
  const weeks = Array.from({ length: nWeeks }, (_, i) => dateAdd(cur, -7 * (nWeeks - 1 - i))).map(start => {
    const end = dateAdd(start, 6);
    // その週の終わりまでに入塾していた生徒だけを分母にする（途中で増えた生徒で割合が下がって見えないように）
    const pool = students.filter(s => s.joinedOn <= end);
    const active = pool.filter(s => (input.doneDates.get(s.id) ?? []).some(d => d >= start && d <= end)).length;
    return { start, active, total: pool.length, rate: pct(active, pool.length) };
  });

  const coachName = new Map(coaches.map(c => [c.id, c.name]));
  const stalled = students.map(s => {
    const last = (input.doneDates.get(s.id) ?? []).filter(d => d <= today).sort().at(-1) ?? null;
    return { id: s.id, name: s.name, days: last ? daysBetween(last, today) : null, coach: s.mainCoachId ? coachName.get(s.mainCoachId) ?? '' : '' };
  }).filter(s => s.days == null || s.days >= STALL_DAYS)
    .sort((a, b) => (b.days ?? Infinity) - (a.days ?? Infinity) || a.name.localeCompare(b.name, 'ja'));

  const studentOf = new Map(input.feedback.map(f => [f.taskId, f.studentId]));
  const replyOf = new Map(input.replies.map(r => [r.taskId, r]));
  const feedbackOf = new Map(input.feedback.map(f => [f.taskId, f]));
  const coachRows = coaches.map(c => {
    const mine = students.filter(s => s.coachIds.includes(c.id));
    const mainOf = new Set(students.filter(s => s.mainCoachId === c.id).map(s => s.id));
    const lags: number[] = [];
    for (const r of input.replies) {
      if (r.coachId !== c.id) continue;
      const f = feedbackOf.get(r.taskId);
      if (!f) continue;
      const h = (Date.parse(r.at) - Date.parse(f.at)) / 36e5;
      if (h >= 0) lags.push(h);
    }
    // 返信待ちは主担当に数える（副担当にも数えると、同じ1件が2人の「未返信」になる）
    const waitingList = input.feedback.filter(f => mainOf.has(studentOf.get(f.taskId) ?? '') && !replyOf.has(f.taskId)
      && (input.now.getTime() - Date.parse(f.at)) / 864e5 < WAIT_WINDOW_DAYS);
    const waitingLong = waitingList.filter(f => (input.now.getTime() - Date.parse(f.at)) / 36e5 >= SLOW_REPLY_HOURS).length;
    const m = median(lags);
    return { id: c.id, name: c.name, students: mine.length, replied: lags.length, medianHours: m == null ? null : Math.round(m * 10) / 10, waiting: waitingList.length, waitingLong };
  });

  return { activeStudents: students.length, weeks, thisWeekRate: weeks.at(-1)?.rate ?? 0, stalled, coaches: coachRows };
}

/** 「1.5時間」「2日」の形 */
export const lagLabel = (h: number | null) => (h == null ? '—' : h < 1 ? `${Math.max(1, Math.round(h * 60))}分` : h < 48 ? `${Math.round(h * 10) / 10}時間` : `${Math.round(h / 24)}日`);
