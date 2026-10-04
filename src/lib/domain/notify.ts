// 通知の小道具（画面にも DB にも依存しない）。
// 通知はアプリの中（ベル）には必ず残し、端末への通知（Web Push）だけを「通知しない時間」に止める。
import { toMin } from './dates';
import type { TimeStr } from './types';

/** その人のタイムゾーンでの今の時刻 'HH:MM' */
export function localTime(timeZone: string, now = new Date()): TimeStr {
  const p = new Intl.DateTimeFormat('en-GB', { timeZone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const h = p.find(x => x.type === 'hour')!.value, m = p.find(x => x.type === 'minute')!.value;
  return `${h}:${m}`;
}

/** 通知しない時間か。23:00〜07:00 のように日をまたぐ指定も扱う。始まりと終わりが同じなら「止めない」 */
export function inQuietHours(t: TimeStr, start: TimeStr, end: TimeStr): boolean {
  const x = toMin(t), s = toMin(start), e = toMin(end);
  if (s === e) return false;
  return s < e ? x >= s && x < e : x >= s || x < e;
}

/** 端末に送るのは、作ってから何時間以内の通知までか（通知しない時間が明けたら、古い「15分後に始まります」は送らない） */
export const PUSH_MAX_AGE_HOURS: Record<string, number> = {
  task_start: 0.5, missed_record: 3, meeting_tomorrow: 12, reply: 24, meeting_booked: 24, meeting_cancelled: 24, report_sent: 24,
};
export const pushExpired = (kind: string, createdAt: string, now = new Date()) =>
  (now.getTime() - Date.parse(createdAt)) / 36e5 > (PUSH_MAX_AGE_HOURS[kind] ?? 24);

export const NOTIFY_KIND_LABEL: Record<string, string> = {
  task_start: '予定の時間', missed_record: '記録のし忘れ', meeting_tomorrow: '明日の面談', reply: '先生からの返信',
  meeting_booked: '面談の予約', meeting_cancelled: '面談の取り消し', report_sent: '保護者への週の報告',
};
