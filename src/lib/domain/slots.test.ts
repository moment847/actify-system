import { describe, expect, it } from 'vitest';
import { mergeSlot } from './slots';
import fixture from './__fixtures__/mock-v19.json';
import { fromMock } from './from-mock';
import { meetingSlots } from './plan';
import { dateAdd, toMin, weekStart } from './dates';

describe('枠をまとめる', () => {
  it('重なる枠・くっつく枠は1つにまとめ、ラベルは残す', () => {
    const r = mergeSlot([{ id: 'a', start: '19:00', end: '20:00', label: '塾のあと' }, { id: 'b', start: '21:00', end: '22:00' }, { id: 'c', start: '06:00', end: '06:30' }], '20:00', '21:00');
    expect(r).toEqual({ start: '19:00', end: '22:00', label: '塾のあと', removeIds: ['a', 'b'] });
  });
  it('離れた枠はそのまま', () => {
    expect(mergeSlot([{ id: 'a', start: '06:00', end: '06:30' }], '19:00', '20:00')).toEqual({ start: '19:00', end: '20:00', label: '', removeIds: [] });
  });
});


describe('面談の候補は、まだの学習予定と重ならない', () => {
  it('学習予定に重なる候補を外す（DB の meeting_vs_task と同じ決まり）', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = fromMock(JSON.parse(JSON.stringify((fixture as any).state)), (fixture as any).day);
    const start = dateAdd(weekStart(w.today), 7), sid = 's1';
    const all = meetingSlots(w, sid, start, { avoidTasks: false }), safe = meetingSlots(w, sid, start);
    // 候補の1つにわざと学習予定を重ねる
    const target = all[0];
    w.tasks.push({ id: 'x', studentId: sid, date: target.date, time: target.time, duration: 30, materialId: null, unitId: null, vague: 'mock', title: '模試の直し', status: 'todo', quizVersionId: null, max: null, noQuiz: true, retest: false, score: null, actual: null });
    const after = meetingSlots(w, sid, start);
    expect(after.some(x => x.date === target.date && x.time === target.time)).toBe(false);
    for (const x of after) expect(w.tasks.some(t => t.studentId === sid && t.status === 'todo' && t.date === x.date && toMin(t.time) < toMin(x.time) + w.meetingLength && toMin(t.time) + t.duration > toMin(x.time))).toBe(false);
    expect(safe.length).toBeLessThanOrEqual(all.length);
  });
});
