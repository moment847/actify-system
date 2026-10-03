// 日付・時刻の小道具。予定は「生徒の暦の上の日付と時刻」を文字列で扱う（タイムゾーンの変換はしない）。
// 週は月曜はじまり、曜日の番号は 0=月 … 6=日。
import type { DateStr, TimeStr } from './types';

export const dateAdd = (d: DateStr, n: number): DateStr => {
  const x = new Date(d + 'T12:00:00Z');
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
};
/** 0=月 … 6=日 */
export const dow = (d: DateStr): number => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7;
export const WD = '月火水木金土日';
export const md = (d: DateStr) => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
export const mdw = (d: DateStr) => `${md(d)}（${WD[dow(d)]}）`;
export const toMin = (t: TimeStr) => +t.slice(0, 2) * 60 + +t.slice(3, 5);
export const toTime = (m: number): TimeStr => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
/** 「3時間54分」の形（小数の「3.9時間」は使わない） */
export const dur = (n: number) => (n >= 60 ? `${Math.floor(n / 60)}時間${n % 60 ? (n % 60) + '分' : ''}` : `${n}分`);
export const hours = (n: number) => dur(Math.round(n));
export const range = (a: string, b: string) => `${a}〜${b}`;
export const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);
export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
export const weekStart = (d: DateStr): DateStr => dateAdd(d, -dow(d));
export const daysBetween = (a: DateStr, b: DateStr) =>
  Math.round((Date.parse(b + 'T12:00:00Z') - Date.parse(a + 'T12:00:00Z')) / 864e5);
export const weekDays = (start: DateStr): DateStr[] => Array.from({ length: 7 }, (_, i) => dateAdd(start, i));
export const byTime = <T extends { date: DateStr; time: TimeStr }>(a: T, b: T) => (a.date + a.time).localeCompare(b.date + b.time);

/** その時刻の、そのタイムゾーンでの暦日（DB の private.local_today と同じ） */
export function localToday(timeZone = 'Asia/Tokyo', now = new Date()): DateStr {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
