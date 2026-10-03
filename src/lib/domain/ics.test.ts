import { describe, expect, it } from 'vitest';
import { icsText } from './ics';

describe('面談の .ics', () => {
  it('開始と終了・タイムゾーン・件名が入り、行の区切りは CRLF', () => {
    const t = icsText('Actify 面談', [{ id: 'm1', date: '2026-10-03', time: '13:30', len: 30, summary: '面談（佐々木先生）' }], 'Asia/Tokyo', new Date('2026-10-02T00:00:00Z'));
    expect(t).toContain('DTSTART;TZID=Asia/Tokyo:20261003T133000\r\n');
    expect(t).toContain('DTEND;TZID=Asia/Tokyo:20261003T140000\r\n');
    expect(t).toContain('SUMMARY:面談（佐々木先生）\r\n');
    expect(t).toContain('DTSTAMP:20261002T000000Z');
    expect(t.startsWith('BEGIN:VCALENDAR\r\n') && t.endsWith('END:VCALENDAR\r\n')).toBe(true);
  });
  it('件名のカンマ・セミコロンは逃がす', () => {
    expect(icsText('x', [{ id: 'a', date: '2026-10-03', time: '09:00', len: 20, summary: '面談;A,B' }])).toContain('SUMMARY:面談\;A\\,B');
  });
});
