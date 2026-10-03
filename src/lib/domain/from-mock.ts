// モック v19 の state（localStorage に入っていた形）を World に直す。テストとデモの確認だけで使う。
import type { DateStr, FeedbackTag, Subject, Task, VagueKind, World } from './types';

/* eslint-disable @typescript-eslint/no-explicit-any */
const SUBJECT: Record<string, Subject> = { 英語: 'english', 数学: 'math', 国語: 'japanese', 理科: 'science', 社会: 'social', その他: 'other' };
const TAG: Record<string, FeedbackTag> = { かんたん: 'easy', ちょうどいい: 'just_right', むずかしい: 'hard', 時間が足りない: 'not_enough_time' };
const VAGUES: VagueKind[] = ['buffer', 'mock', 'school', 'weak', 'free'];

export function fromMock(state: any, today: DateStr): World {
  return {
    today,
    materials: state.materials.filter((m: any) => !m.hidden).map((m: any) => ({
      id: m.id, name: m.name, short: m.short, subject: SUBJECT[m.subject] ?? 'other', kind: m.type === 'インプット' ? 'input' : 'practice',
      intervals: m.intervals, keywords: m.keys || [], units: m.nodes.map((n: any) => ({ id: n.id, label: n.label })),
    })),
    quizVersions: state.pdfs.map((p: any) => ({ id: p.id, unitId: p.node, version: p.version, max: p.max })),
    tasks: state.tasks.map((t: any): Task => {
      const vague = t.material === 'free';
      return {
        id: t.id, studentId: t.student, date: t.date, time: t.time, duration: t.duration,
        materialId: vague ? null : t.material, unitId: vague ? null : t.node,
        vague: vague ? (VAGUES.includes(t.vague) ? t.vague : 'free') : null, title: vague ? t.title : null,
        status: t.status, quizVersionId: t.pdf || null, max: t.max ?? null, noQuiz: !!t.noQuiz, retest: !!t.retest,
        score: t.score ?? null, actual: t.actual ?? null,
        feedback: t.comment ? { tag: TAG[t.comment.tag] ?? null, body: t.comment.text || '', date: t.comment.date } : null,
        reply: t.reply ? { body: t.reply.text, date: t.reply.date } : null,
      };
    }),
    slots: state.avail.map((a: any) => ({ id: a.id, studentId: a.student, date: a.repeat ? null : a.date, weekday: a.repeat ? a.weekday : null, start: a.start, end: a.end, label: a.label || '' })),
    slotSkips: new Set(state.availSkip.map((x: any) => `${x.id}:${x.date}`)),
    books: state.books.map((b: any) => ({ studentId: b.student, materialId: b.material, start: b.start, target: b.target })),
    meetings: state.meetings.map((m: any) => ({ id: m.id, studentId: m.student, date: m.date, time: m.time, len: m.len })),
    coachOpen: state.coachOpen.map((o: any) => ({ id: o.id, date: o.repeat ? null : o.date, weekday: o.repeat ? o.weekday : null, start: o.start, end: o.end })),
    meetingLength: state.booking.len,
    reviewSkips: new Set(state.skips),
  };
}
