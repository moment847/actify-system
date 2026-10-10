// 面談の .ics（Googleカレンダー・iPhoneのカレンダーに取り込める形式）。RFC 5545
import { dateAdd, toMin, toTime } from './dates';

export interface IcsMeeting { id: string; date: string; time: string; len: number; summary: string }

/** 文字の中の「,」「;」「\」と改行を、ics の決まりどおりに逃がす */
const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r\n|\r|\n/g, '\\n');

export function icsText(calName: string, meetings: IcsMeeting[], timeZone = 'Asia/Tokyo', now = new Date()) {
  const ymd = (d: string) => d.replace(/-/g, ''), hm = (t: string) => t.replace(':', '') + '00';
  const stamp = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+Z$/, 'Z');
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Actify//Actify//JA', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(calName)}`];
  if (timeZone === 'Asia/Tokyo')
    L.push('BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:JST', 'END:STANDARD', 'END:VTIMEZONE');
  for (const m of meetings) {
    // 終わりが 0 時をまたぐときは日付を進める（「T243000」は不正な時刻）
    const end = toMin(m.time) + m.len, endDate = dateAdd(m.date, Math.floor(end / 1440));
    L.push('BEGIN:VEVENT', `UID:${m.id}@actify`, `DTSTAMP:${stamp}`, `DTSTART;TZID=${timeZone}:${ymd(m.date)}T${hm(m.time)}`,
      `DTEND;TZID=${timeZone}:${ymd(endDate)}T${hm(toTime(end % 1440))}`, `SUMMARY:${esc(m.summary)}`, 'END:VEVENT');
  }
  L.push('END:VCALENDAR');
  return L.join('\r\n') + '\r\n';
}
