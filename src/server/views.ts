import 'server-only';
// 画面ごとに出す中身（読み込み → 計算 → 画面がそのまま描ける形）。どれも RLS の効くクライアントで読む。
// 中身と並びはモック v19 の各画面と同じ（reference/mock-v19 の student.js / teacher.js / admin.js）
import type { SupabaseClient } from '@supabase/supabase-js';
import { byTime, dateAdd, daysBetween, dow, toMin, weekDays, weekStart } from '@/lib/domain/dates';
import {
  availRegistered, blockGaps, blockTasks, bookProgress, booksOf, candidatesFor, coachOpenOn, coachOpenRegistered, freePdf, isMissed, lastMeeting, mat,
  meetingInWeek, meetingOn, meetingSlots, needsPdf, nextMeeting, pdfMissing, pdfUse, pdfsOf, recommendPreview, reviewQueue, shortages, studentAlerts,
  taskLabel, tasksOf, typicalDur, unitOf, visibleMats, weekBlocks, weekStats,
} from '@/lib/domain/plan';
import type { Task, World } from '@/lib/domain/types';
import { loadStudents, loadWorld, mainStudentIds, readAll, type Actor } from '@/lib/data/load';

type Sb = SupabaseClient;

/** 予定1件を画面に出す形に */
function taskView(w: World, t: Task) {
  const m = mat(w, t.materialId), u = unitOf(w, t.unitId);
  return {
    id: t.id, date: t.date, time: t.time, duration: t.duration, status: t.status, title: taskLabel(w, t),
    material: m ? { id: m.id, name: m.name, short: m.short, subject: m.subject, kind: m.kind } : null,
    unit: u ? { id: u.unit.id, label: u.unit.label, index: u.index } : null,
    vague: t.vague, retest: t.retest, hasQuiz: !!t.quizVersionId, max: t.max, score: t.score, actual: t.actual,
    missed: isMissed(w, t), quizMissing: pdfMissing(w, t),
    timer: t.startedAt ? { startedAt: t.startedAt, pausedAt: t.pausedAt ?? null, pausedMs: t.pausedMs ?? 0 } : null,
    feedback: t.feedback ?? null, reply: t.reply ?? null,
  };
}
const progressView = (w: World, sid: string, mid: string) => {
  const p = bookProgress(w, sid, mid);
  return { material: { id: p.m.id, name: p.m.name, short: p.m.short, subject: p.m.subject }, total: p.total, done: p.done, expected: p.expected, target: p.b.target, finish: p.finish, status: p.status, avg: p.avg,
    cells: p.cells.map(c => ({ unitId: c.n.id, label: c.n.label, done: c.done, planned: c.planned, last: c.last, tries: c.tries })) };
};

// ---------- 生徒 ----------
export async function studentHomeView(sb: Sb, actor: Actor) {
  const [w, [me], { data: todos }] = await Promise.all([loadWorld(sb, actor, [actor.id]), loadStudents(sb, actor), sb.rpc('my_meeting_todos', { p_limit: 1 })]);
  const sid = actor.id, today = tasksOf(w, sid).filter(t => t.date === w.today).sort(byTime);
  const running = today.find(t => t.startedAt && t.status !== 'done');
  // 次の予定：動いているタイマー → まだの予定（予備時間は出さない）
  const hero = running ?? today.find(t => t.status !== 'done' && t.vague !== 'buffer') ?? null;
  const ws = weekStats(w, sid);
  const nx = nextMeeting(w, sid);
  return {
    name: me?.name ?? actor.name, today: w.today,
    goal: me ? { school: me.goalSchool, faculty: me.goalFaculty, examOn: me.examOn, daysLeft: me.examOn ? daysBetween(w.today, me.examOn) : null } : null,
    studiedToday: ws.perDay[dow(w.today)], todayCount: today.length, todayDone: today.filter(t => t.status === 'done').length,
    hero: hero ? taskView(w, hero) : null,
    others: today.filter(t => t !== hero).map(t => taskView(w, t)),
    needsScore: today.filter(t => t.status === 'done' && t.quizVersionId && t.score == null).map(t => taskView(w, t)),
    missed: tasksOf(w, sid).filter(t => isMissed(w, t)).sort(byTime).map(t => taskView(w, t)),
    canUseBuffer: tasksOf(w, sid).some(t => isMissed(w, t)),
    books: booksOf(w, sid).map(b => progressView(w, sid, b.materialId)),
    week: { minutes: ws.minutes, perDay: ws.perDay, due: ws.due.length, done: ws.done.length },
    coach: { message: me?.coachMessage ?? '', nextMeeting: nx ? { date: nx.date, time: nx.time, len: nx.len } : null,
      // 面談で先生と決めた「次回までにやること」（講師が共有した欄だけ）
      todo: ((todos ?? []) as { on_date: string; todo: string }[]).map(t => ({ date: t.on_date, text: t.todo }))[0] ?? null },
  };
}

export async function studentScheduleView(sb: Sb, actor: Actor, weekOffset = 0) {
  const w = await loadWorld(sb, actor, [actor.id]), sid = actor.id;
  const start = dateAdd(weekStart(w.today), weekOffset * 7), ws = weekStats(w, sid, start);
  return {
    start, days: weekDays(start), today: w.today,
    registered: availRegistered(w, sid, start), canCopy: availRegistered(w, sid, dateAdd(start, -7)),
    slots: weekDays(start).flatMap(d => w.slots.filter(a => a.studentId === sid && (a.weekday !== null ? a.weekday === dow(d) && !w.slotSkips.has(`${a.id}:${d}`) : a.date === d))
      .map(a => ({ id: a.id, date: d, start: a.start, end: a.end, label: a.label, repeat: a.weekday !== null }))),
    tasks: ws.ts.sort(byTime).map(t => taskView(w, t)),
    totals: { avail: ws.avail, planned: ws.planned },
    meeting: meetingCard(w, sid, start),
  };
}

/** 生徒の「予定」の上の面談の欄（モックの meetCard） */
function meetingCard(w: World, sid: string, start: string) {
  const m = meetingInWeek(w, sid, start);
  if (start < weekStart(w.today)) return { state: m ? 'past' as const : 'none' as const, meeting: m };
  if (m) return { state: 'booked' as const, meeting: m, canChange: m.date > (w.bookingToday ?? w.today), over: m.date < w.today };
  const slots = meetingSlots(w, sid, start);
  if (!slots.length) return { state: 'unavailable' as const, reason: weekDays(start).some(d => d > w.today) ? '予約できる時間がもうありません' : '予約は前日までです' };
  return { state: 'open' as const, best: slots[0], others: slots.slice(1), length: w.meetingLength };
}

export async function studentRecordsView(sb: Sb, actor: Actor, materialId?: string, limit = 12) {
  const w = await loadWorld(sb, actor, [actor.id]), sid = actor.id, ws = weekStats(w, sid);
  const all = tasksOf(w, sid).filter(t => t.status === 'done');
  let streak = 0; for (let d = w.today; all.some(t => t.date === d); d = dateAdd(d, -1)) streak++;
  const list = all.filter(t => (t.score != null || t.feedback) && (!materialId || t.materialId === materialId)).sort(byTime).reverse();
  return {
    week: { minutes: ws.minutes, perDay: ws.perDay, due: ws.due.length, done: ws.done.length, bySubject: ws.bySubject },
    total: { minutes: all.reduce((a, t) => a + (t.actual || t.duration), 0), days: new Set(all.map(t => t.date)).size, count: all.length },
    today: { minutes: ws.perDay[dow(w.today)], streak },
    books: booksOf(w, sid).map(b => progressView(w, sid, b.materialId)),
    records: list.slice(0, limit).map(t => taskView(w, t)), more: list.length > limit,
  };
}

export async function studentResourcesView(sb: Sb) {
  const { data } = await sb.from('resources').select('id, name, created_at, target_student_id').order('created_at', { ascending: false });
  return (data ?? []).map(r => ({ id: r.id, name: r.name, date: r.created_at, forMe: !!r.target_student_id }));
}

export async function chatLogView(sb: Sb, actor: Actor, limit = 80) {
  const { data } = await sb.from('chat_messages').select('id, sender, body, image_path, mood, created_at').eq('student_id', actor.id).order('id', { ascending: false }).limit(limit);
  return (data ?? []).reverse();
}

// ---------- 講師 ----------
export async function coachHomeView(sb: Sb, actor: Actor) {
  const students = await loadStudents(sb, actor);
  const w = await loadWorld(sb, actor, students.map(s => s.id));
  const nextWeek = dateAdd(weekStart(w.today), 7);
  const cards = students.map(s => {
    const ws = weekStats(w, s.id), nw = weekStats(w, s.id, nextWeek), al = studentAlerts(w, s.id);
    const cm = tasksOf(w, s.id).filter(t => t.feedback).sort(byTime).at(-1);
    const nx = nextMeeting(w, s.id);
    return {
      id: s.id, name: s.name, grade: s.grade, goalSchool: s.goalSchool, daysLeft: s.examOn ? daysBetween(w.today, s.examOn) : null,
      nextMeeting: nx ? { date: nx.date, time: nx.time } : null, alerts: al,
      thisWeek: { due: ws.due.length, done: ws.done.length }, nextWeek: { avail: nw.avail, planned: nw.planned },
      books: booksOf(w, s.id).map(b => { const p = bookProgress(w, s.id, b.materialId); return { short: p.m.short, done: p.done, total: p.total, expected: p.expected, status: p.status }; }),
      lastComment: cm ? { date: cm.date, material: mat(w, cm.materialId)?.short ?? '', ...cm.feedback } : null,
    };
  }).sort((a, b) => b.alerts.length - a.alerts.length);
  return { today: w.today, cards };
}

/**
 * 計画の画面：週のカレンダー（勉強できる時間・予定・面談・空き）と、右の欄（選んだ時間のまとまり・入れる候補・コメント・目標）。
 * block を渡さなければ、空きのある最初のまとまりを選ぶ
 */
export async function coachPlanView(sb: Sb, actor: Actor, studentId: string, weekOffset?: number, block?: { date: string; start: string }) {
  const students = await loadStudents(sb, actor);
  if (!students.some(s => s.id === studentId)) return null;
  const w = await loadWorld(sb, actor, [studentId]), sid = studentId;
  // 金・土・日は来週の計画を立てる日（来週から開く）
  const off = weekOffset ?? (dow(w.today) >= 4 ? 1 : 0);
  const start = dateAdd(weekStart(w.today), off * 7), days = weekDays(start);
  const blocks = weekBlocks(w, sid, start);
  const gapsOf = (b: (typeof blocks)[number]) => blockGaps(w, sid, b);
  const sel = (block && blocks.find(b => b.date === block.date && b.s === toMin(block.start))) || blocks.find(b => gapsOf(b).length) || blocks[0] || null;
  const ws = weekStats(w, sid, start);
  const reviews = reviewQueue(w, sid);
  const side = sel ? (() => {
    const gaps = gapsOf(sel), g0 = gaps[0];
    const mt = meetingOn(w, sid, sel.date);
    return {
      block: { date: sel.date, start: sel.s, end: sel.e, label: sel.label, rest: gaps.reduce((a, [s, e]) => a + e - s, 0) },
      tasks: blockTasks(w, sid, sel).map(t => ({ ...taskView(w, t), kind: t.vague ? '時間だけ' : isMissed(w, t) ? 'やり残し' : t.retest ? '再テスト' : '初回' })),
      meeting: mt && toMin(mt.time) < sel.e && toMin(mt.time) + mt.len > sel.s ? mt : null,
      gaps,
      candidates: g0 ? candidatesFor(w, sid, { date: sel.date, s: g0[0], e: g0[1] }).map(c => ({ kind: c.kind, id: c.id, unitId: c.node, material: c.m.short, label: unitOf(w, c.node)?.unit.label ?? '', badge: c.badge, tone: c.tone, reason: c.reason, minutes: c.typ, hasQuiz: !!c.pdf })) : [],
      recommendPreview: recommendPreview(w, sid, sel).map(x => ({ material: x.m.short, label: unitOf(w, x.node)?.unit.label ?? '', badge: x.badge, reason: x.reason })),
      typical: Object.fromEntries(booksOf(w, sid).map(b => [b.materialId, typicalDur(w, sid, b.materialId)])),
    };
  })() : null;
  return {
    student: students.find(s => s.id === sid)!, students: students.map(s => ({ id: s.id, name: s.name })),
    weekOffset: off, start, days, today: w.today,
    registered: availRegistered(w, sid, start), canCopy: availRegistered(w, sid, dateAdd(start, -7)),
    slots: days.flatMap(d => w.slots.filter(a => a.studentId === sid && (a.weekday !== null ? a.weekday === dow(d) && !w.slotSkips.has(`${a.id}:${d}`) : a.date === d)).map(a => ({ id: a.id, date: d, start: a.start, end: a.end, label: a.label, repeat: a.weekday !== null }))),
    tasks: ws.ts.sort(byTime).map(t => taskView(w, t)),
    meetings: w.meetings.filter(m => m.studentId === sid && days.includes(m.date)),
    blocks: blocks.map(b => ({ date: b.date, start: b.s, end: b.e, label: b.label, gaps: gapsOf(b) })),
    totals: { avail: ws.avail, free: blocks.reduce((a, b) => a + gapsOf(b).reduce((x, [s, e]) => x + e - s, 0), 0) },
    side,
    // 右の欄の「教材」：担当の参考書と、ほかの教材（範囲の一覧つき。✓済・●予定あり・再テストの時期・前回の点数）
    materials: visibleMats(w).map(m => ({
      id: m.id, name: m.name, short: m.short, subject: m.subject, kind: m.kind, assigned: booksOf(w, sid).some(b => b.materialId === m.id),
      units: m.units.map(n => {
        const ts = tasksOf(w, sid).filter(t => t.unitId === n.id), dn = ts.filter(t => t.status === 'done'), pl = ts.find(t => t.status !== 'done');
        const rv = reviews.find(r => r.node === n.id), sc = dn.filter(t => t.score != null).at(-1);
        return { id: n.id, label: n.label, done: dn.length, planned: pl ? pl.date : null, reviewDue: rv?.due ?? null, last: sc ? Math.round((sc.score! / sc.max!) * 100) : null,
          quiz: pdfsOf(w, n.id).length ? (freePdf(w, sid, n.id) ? 'available' : 'used_up') : needsPdf(w, n.id) ? 'none' : 'not_needed' };
      }),
    })),
    comments: commentsByMaterial(w, sid),
    who: await whoView(sb, w, sid, students.find(s => s.id === sid)!),
  };
}

function commentsByMaterial(w: World, sid: string) {
  return booksOf(w, sid).map(b => {
    const cs = tasksOf(w, sid).filter(t => t.materialId === b.materialId && t.feedback).sort(byTime).reverse();
    return { material: mat(w, b.materialId)!.short, materialId: b.materialId, unread: cs.filter(t => !t.reply).length,
      items: cs.slice(0, 30).map(t => ({ taskId: t.id, date: t.date, unit: unitOf(w, t.unitId)?.unit.label ?? '', score: t.score, max: t.max, feedback: t.feedback!, reply: t.reply ?? null })) };
  }).filter(g => g.items.length);
}

async function whoView(sb: Sb, w: World, sid: string, s: Awaited<ReturnType<typeof loadStudents>>[number]) {
  const { data: note } = await sb.from('coach_notes').select('memo').eq('student_id', sid).maybeSingle();
  const nx = nextMeeting(w, sid);
  return { name: s.name, grade: s.grade, goalSchool: s.goalSchool, goalFaculty: s.goalFaculty, examOn: s.examOn, message: s.coachMessage, memo: note?.memo ?? '',
    books: booksOf(w, sid).map(b => ({ materialId: b.materialId, short: mat(w, b.materialId)!.short, target: b.target })),
    unassigned: visibleMats(w).filter(m => !booksOf(w, sid).some(b => b.materialId === m.id)).map(m => ({ id: m.id, name: m.name })),
    nextMeeting: nx, shortages: shortages(w, sid).map(x => ({ unitId: x.node, label: unitOf(w, x.node)?.unit.label ?? '', material: unitOf(w, x.node)?.m.short ?? '', why: x.why })) };
}

export async function coachMeetView(sb: Sb, actor: Actor, weekOffset = 0) {
  // 面談は主担当と。副担当の生徒は、この画面の予約の一覧に出さない（主担当の画面で入れる）
  const mains = await mainStudentIds(sb, actor.id);
  const students = (await loadStudents(sb, actor)).filter(s => mains.has(s.id));
  const w = await loadWorld(sb, actor, students.map(s => s.id));
  const start = dateAdd(weekStart(w.today), weekOffset * 7), days = weekDays(start);
  const { data: setting } = await sb.from('booking_settings').select('length_min, published').eq('coach_id', actor.id).maybeSingle();
  const openMin = days.reduce((a, d) => a + coachOpenOn(w, d).reduce((x, o) => x + toMin(o.end) - toMin(o.start), 0), 0);
  return {
    start, days, today: w.today, length: setting?.length_min ?? 30, published: setting?.published ?? true,
    open: days.flatMap(d => coachOpenOn(w, d).map(o => ({ id: o.id, date: d, start: o.start, end: o.end, repeat: o.weekday !== null }))),
    openMinutes: openMin, registered: coachOpenRegistered(w, start), canCopy: coachOpenRegistered(w, dateAdd(start, -7)),
    meetings: w.meetings.filter(m => days.includes(m.date) && (!m.coachId || m.coachId === actor.id)).map(m => ({ ...m, name: students.find(s => s.id === m.studentId)?.name ?? '' })),
    rows: students.map(s => {
      const m = meetingInWeek(w, s.id, start), best = m ? null : meetingSlots(w, s.id, start)[0] ?? null, last = lastMeeting(w, s.id);
      return { id: s.id, name: s.name, meeting: m ? { ...m, over: m.date < w.today } : null, best, lastWeek: best?.same && last ? { date: last.date, time: last.time } : null };
    }),
  };
}

export async function coachPrintsView(sb: Sb, actor: Actor, materialId?: string) {
  const students = await loadStudents(sb, actor);
  const w = await loadWorld(sb, actor, students.map(s => s.id));
  const m = (materialId && mat(w, materialId)) || visibleMats(w)[0];
  const users = students.filter(p => w.books.some(b => b.studentId === p.id && b.materialId === m?.id) || w.tasks.some(t => t.studentId === p.id && t.materialId === m?.id));
  return {
    materials: visibleMats(w).map(x => ({ id: x.id, short: x.short })),
    lack: students.flatMap(s => shortages(w, s.id).map(x => ({ student: s.name, studentId: s.id, unitId: x.node, material: unitOf(w, x.node)?.m.short ?? '', label: unitOf(w, x.node)?.unit.label ?? '', why: x.why }))),
    material: m ? { id: m.id, name: m.name } : null,
    students: users.map(p => ({ id: p.id, name: p.name })),
    rows: m ? m.units.map(n => {
      const vs = pdfsOf(w, n.id);
      return { unitId: n.id, label: n.label, versions: vs.length,
        cells: users.map(p => ({ used: vs.map(v => ({ version: v.version, use: pdfUse(w, p.id, v.id) })).filter(x => x.use), next: vs.length ? freePdf(w, p.id, n.id)?.version ?? null : null })) };
    }) : [],
  };
}

// ---------- 運営 ----------
export async function adminMaterialsView(sb: Sb) {
  // 範囲・版・担当の参考書は1,000行を超える（20冊×50範囲など）ので全部読む。以前は1,000行で切れて数が合わなかった
  const [{ data: mats }, units, qv, books] = await Promise.all([
    sb.from('materials').select('id, name, short_name, subject, kind, review_intervals, keywords, toc_image_path, archived_at').order('created_at'),
    readAll<{ id: string; material_id: string; seq: number; label: string }>((a, b) => sb.from('material_units').select('id, material_id, seq, label').order('material_id').order('seq').range(a, b)),
    readAll<{ unit_id: string }>((a, b) => sb.from('quiz_versions').select('unit_id').order('id').range(a, b)),
    readAll<{ material_id: string; student_id: string }>((a, b) => sb.from('student_books').select('material_id, student_id').order('student_id').order('material_id').range(a, b)),
  ]);
  return (mats ?? []).map(m => {
    const us = (units ?? []).filter(u => u.material_id === m.id);
    return { id: m.id, name: m.name, short: m.short_name, subject: m.subject, kind: m.kind, intervals: m.review_intervals, keywords: m.keywords, tocImagePath: m.toc_image_path, archived: !!m.archived_at,
      units: us.map(u => ({ id: u.id, label: u.label, quizzes: (qv ?? []).filter(q => q.unit_id === u.id).length })),
      covered: us.filter(u => (qv ?? []).some(q => q.unit_id === u.id)).length, students: (books ?? []).filter(b => b.material_id === m.id).length };
  });
}

export async function adminAccountsView(sb: Sb) {
  const [people, st, ca] = await Promise.all([
    readAll<{ id: string; role: string; display_name: string; status: string; created_at: string }>((a, b) => sb.from('profiles').select('id, role, display_name, status, created_at').order('created_at').order('id').range(a, b)),
    readAll<{ id: string; grade: string }>((a, b) => sb.from('students').select('id, grade').order('id').range(a, b)),
    readAll<{ coach_id: string; student_id: string }>((a, b) => sb.from('coach_assignments').select('coach_id, student_id').order('student_id').order('coach_id').range(a, b)),
  ]);
  return (people ?? []).map(p => ({ id: p.id, name: p.display_name, role: p.role, status: p.status,
    grade: st?.find(s => s.id === p.id)?.grade ?? '',
    coaches: (ca ?? []).filter(a => a.student_id === p.id).map(a => a.coach_id),
    students: (ca ?? []).filter(a => a.coach_id === p.id).length }));
}
