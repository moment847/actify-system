// 保護者に LINE で送る週の報告（文面だけ。送るのは src/server/weekly-reports.ts）。
// 中身は生徒・講師の画面と同じ計算（weekStats・bookProgress・nextMeeting）から作る。数字を画面と食い違わせない。
import { dateAdd, dow, dur, mdw, weekStart } from './dates';
import { bookProgress, booksOf, nextMeeting, weekStats } from './plan';
import type { DateStr, World } from './types';

/**
 * どの週を報告するか。日曜なら「今日で終わる週」、それ以外は「先週」。
 * 送る時刻は日曜の夜（README の cron）。月曜の朝に送り直しても同じ週になる
 */
export const reportWeek = (today: DateStr): DateStr => (dow(today) === 6 ? weekStart(today) : dateAdd(weekStart(today), -7));

/**
 * 週の報告を送る時間か：その生徒のタイムゾーンで日曜の 20:00〜22:59。
 * 以前は日本時間の日曜 20:00 に全員へ送っていて、ロサンゼルスの生徒には日曜の朝4時に「その日を含まない週」の報告が届いた
 */
export function inReportWindow(timeZone: string, now = new Date()): boolean {
  const p = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const wd = p.find(x => x.type === 'weekday')!.value, h = Number(p.find(x => x.type === 'hour')!.value);
  return wd === 'Sun' && h >= 20 && h < 23;
}

export interface WeeklyReportInput {
  studentName: string;
  schoolName: string;
  /** 報告する週の月曜 */
  week: DateStr;
  /** 講師から保護者へのひとこと（空なら出さない） */
  coachMessage?: string;
}

export interface WeeklyReport {
  text: string;
  minutes: number;
  lastMinutes: number;
  done: number;
  due: number;
  rate: number;
  behind: { name: string; label: string; done: number; total: number }[];
  meeting: { date: DateStr; time: string } | null;
}

/** LINE のテキストは 5,000 文字まで。参考書が多い生徒でも超えないよう、遅れの一覧は 8 冊で切る */
const MAX_BEHIND = 8;

export function buildWeeklyReport(w: World, sid: string, input: WeeklyReportInput): WeeklyReport {
  const { week } = input;
  const end = dateAdd(week, 6);
  // 週が終わったあとの日付で数える（「今日」より先の予定を未消化にしない）
  const asOf: World = { ...w, today: w.today < end ? w.today : end };
  const ws = weekStats(asOf, sid, week), last = weekStats(asOf, sid, dateAdd(week, -7));
  const behind = booksOf(w, sid).map(b => bookProgress(w, sid, b.materialId))
    .filter(p => p.status.label === '遅れ' || p.status.label === 'やや遅れ')
    .sort((a, b) => b.late - a.late)
    .map(p => ({ name: p.m.short || p.m.name, label: p.status.label, done: p.done, total: p.total }));
  const nm = nextMeeting(w, sid, w.today);
  const meeting = nm ? { date: nm.date, time: nm.time } : null;

  const diff = ws.minutes - last.minutes;
  const lines = [
    `【${input.schoolName} 週の報告】`,
    `${input.studentName}さん　${mdw(week)}〜${mdw(end)}`,
    '',
    `■ 勉強時間　${ws.minutes ? dur(ws.minutes) : '記録なし'}`,
    last.minutes || ws.minutes ? `　（先週 ${last.minutes ? dur(last.minutes) : '記録なし'}${last.minutes && diff ? `・${diff > 0 ? '+' : '−'}${dur(Math.abs(diff))}` : ''}）` : null,
    `■ 予定の達成　${ws.due.length ? `${ws.done.length} / ${ws.due.length}件（${ws.rate}%）` : 'この週の予定はありませんでした'}`,
    '',
    behind.length ? '■ 予定より遅れている参考書' : '■ 参考書　予定どおり進んでいます',
    ...behind.slice(0, MAX_BEHIND).map(b => `・${b.name}　${b.label}（${b.done} / ${b.total}）`),
    behind.length > MAX_BEHIND ? `・ほか${behind.length - MAX_BEHIND}冊` : null,
    '',
    `■ 次の面談　${meeting ? `${mdw(meeting.date)} ${meeting.time}から` : 'まだ決まっていません'}`,
    input.coachMessage?.trim() ? `\n■ 先生から\n${input.coachMessage.trim()}` : null,
    '',
    'このメッセージは送信専用です。ご質問は塾へ直接お問い合わせください。',
  ].filter((x): x is string => x !== null);
  return { text: lines.join('\n').replace(/\n{3,}/g, '\n\n'), minutes: ws.minutes, lastMinutes: last.minutes, done: ws.done.length, due: ws.due.length, rate: ws.rate, behind, meeting };
}
