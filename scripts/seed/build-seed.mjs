// デモの塾のデータ（モック v19 と同じ中身）から supabase/seed.sql を作る。
// 使い方:
//   node scripts/seed/build-seed.mjs                 … モックと同じ 2026-10-02 を「今日」とする
//   node scripts/seed/build-seed.mjs --today=2026-11-20 … 日付をずらして、今日を基準にしたデモにする
// ログイン：パスワードはすべて DEMO_PASSWORD（下）。本番の塾のデータには使わないこと。
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const fx = JSON.parse(readFileSync(join(root, 'src/lib/domain/__fixtures__/mock-v19.json'), 'utf8'));
const arg = process.argv.find(a => a.startsWith('--today='));
const TODAY = arg ? arg.slice(8) : fx.day;
const SHIFT = Math.round((Date.parse(TODAY + 'T12:00:00Z') - Date.parse(fx.day + 'T12:00:00Z')) / 864e5);
if (SHIFT % 7 !== 0) console.warn(`注意：${SHIFT}日ずらすと曜日が変わります（勉強できる時間の曜日もずれます）`);
export const DEMO_PASSWORD = 'actify-demo-2026';

// モックのIDから、毎回同じ UUID を作る
const uuid = key => { const h = createHash('md5').update('actify-demo:' + key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`; };
const q = v => v === null || v === undefined ? 'null' : typeof v === 'number' ? String(v) : typeof v === 'boolean' ? String(v) : `'${String(v).replaceAll("'", "''")}'`;
const shift = d => { if (!d) return d; const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + SHIFT); return x.toISOString().slice(0, 10); };

const SCHOOL = uuid('school');
const SUBJECT = { 英語: 'english', 数学: 'math', 国語: 'japanese', 理科: 'science', 社会: 'social', その他: 'other' };
const KIND = { インプット: 'input', 演習: 'practice' };
const TAG = { かんたん: 'easy', ちょうどいい: 'just_right', むずかしい: 'hard', 時間が足りない: 'not_enough_time' };
const VAGUE = ['buffer', 'mock', 'school', 'weak', 'free'];
const ROLE = { 生徒: 'student', 講師: 'coach', 運営: 'admin' };
const EMAIL = { s1: 'hina@demo.actify.jp', s2: 'yuma@demo.actify.jp', s3: 'misaki@demo.actify.jp', s4: 'ren@demo.actify.jp', c1: 'sasaki@demo.actify.jp', a1: 'admin@demo.actify.jp' };
const st = fx.state;
const out = [];
const P = s => out.push(s);

P(`-- 自動生成：scripts/seed/build-seed.mjs（手で直さない）
-- デモの塾「Actify デモ塾」。中身はモック v19 と同じ。今日＝${TODAY}
-- ログイン：${Object.values(EMAIL).join(' / ')}（パスワードは ${DEMO_PASSWORD}）
begin;
insert into public.schools (id, name, timezone) values (${q(SCHOOL)}, 'Actify デモ塾', 'Asia/Tokyo');
`);

// 人
for (const p of st.people) {
  const id = uuid(p.id), email = EMAIL[p.id];
  P(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', ${q(id)}, 'authenticated', 'authenticated', ${q(email)}, extensions.crypt(${q(DEMO_PASSWORD)}, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at)
  values (${q(id)}, ${q(id)}, jsonb_build_object('sub', ${q(id)}, 'email', ${q(email)}, 'email_verified', true), 'email', now());
insert into public.profiles (id, school_id, role, display_name, status) values (${q(id)}, ${q(SCHOOL)}, ${q(ROLE[p.role])}, ${q(p.name)}, 'active');`);
}
for (const p of st.people.filter(x => x.role === '生徒')) {
  const c = st.coach[p.id] || { message: '', memo: '' };
  P(`insert into public.students (id, school_id, grade, goal_school, goal_faculty, exam_on, coach_message)
  values (${q(uuid(p.id))}, ${q(SCHOOL)}, ${q(p.grade)}, ${q(p.goal.school)}, ${q(p.goal.faculty)}, ${q(p.goal.date)}, ${q(c.message)});
insert into public.coach_notes (student_id, school_id, memo) values (${q(uuid(p.id))}, ${q(SCHOOL)}, ${q(c.memo)});
insert into public.coach_assignments (coach_id, student_id, school_id) values (${q(uuid('c1'))}, ${q(uuid(p.id))}, ${q(SCHOOL)});`);
}

// 教材と範囲
for (const m of st.materials.filter(x => !x.hidden)) {
  P(`insert into public.materials (id, school_id, name, short_name, subject, kind, review_intervals, keywords)
  values (${q(uuid('m:' + m.id))}, ${q(SCHOOL)}, ${q(m.name)}, ${q(m.short)}, ${q(SUBJECT[m.subject])}, ${q(KIND[m.type])}, '{${m.intervals.join(',')}}', array[${(m.keys || []).map(q).join(',')}]::text[]);`);
  P(`insert into public.material_units (id, school_id, material_id, seq, label) values\n` +
    m.nodes.map((n, i) => `  (${q(uuid('u:' + n.id))}, ${q(SCHOOL)}, ${q(uuid('m:' + m.id))}, ${i + 1}, ${q(n.label)})`).join(',\n') + ';');
}
// 小テストの版（ファイルは scripts/seed/upload-demo-files.ts が置く）
P(`insert into public.quiz_versions (id, school_id, unit_id, version, max_score, problem_path, answer_path, file_name) values\n` +
  st.pdfs.map(p => `  (${q(uuid('q:' + p.id))}, ${q(SCHOOL)}, ${q(uuid('u:' + p.node))}, ${p.version}, ${p.max}, ${q(SCHOOL + '/demo/sample-questions.pdf')}, ${q(SCHOOL + '/demo/sample-answers.pdf')}, ${q(p.name)})`).join(',\n') + ';');

// 担当の参考書
P(`insert into public.student_books (student_id, material_id, school_id, start_on, target_on) values\n` +
  st.books.map(b => `  (${q(uuid(b.student))}, ${q(uuid('m:' + b.material))}, ${q(SCHOOL)}, ${q(shift(b.start))}, ${q(shift(b.target))})`).join(',\n') + ';');

// 勉強できる時間
P(`insert into public.study_slots (id, school_id, student_id, on_date, weekday, start_time, end_time, label) values\n` +
  st.avail.map(a => `  (${q(uuid('a:' + a.student + a.date + a.start))}, ${q(SCHOOL)}, ${q(uuid(a.student))}, ${a.repeat ? 'null' : q(shift(a.date))}, ${a.repeat ? a.weekday : 'null'}, ${q(a.start)}, ${q(a.end)}, ${q(a.label || '')})`).join(',\n') + ';');

// 予定：日付の順に1件ずつ入れる（再テストかどうかは、入れた時点で済ませた範囲があるかで決まるため）
const sorted = [...st.tasks].sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
for (const t of sorted) {
  const vague = t.material === 'free';
  const vk = vague ? (VAGUE.includes(t.vague) ? t.vague : 'free') : null;
  const done = t.status === 'done';
  P(`insert into public.tasks (id, school_id, student_id, on_date, start_time, duration_min, material_id, unit_id, vague, title, status, quiz_version_id, no_quiz, score, actual_min, done_at)
  values (${q(uuid('t:' + t.id))}, ${q(SCHOOL)}, ${q(uuid(t.student))}, ${q(shift(t.date))}, ${q(t.time)}, ${t.duration}, ${vague ? 'null' : q(uuid('m:' + t.material))}, ${vague ? 'null' : q(uuid('u:' + t.node))}, ${q(vk)}, ${q(vague ? t.title : null)}, ${q(t.status)}, ${t.pdf ? q(uuid('q:' + t.pdf)) : 'null'}, ${!!t.noQuiz}, ${t.score ?? 'null'}, ${t.actual ?? 'null'}, ${done ? `(${q(shift(t.date))}::date + ${q(t.time)}::time + ${t.actual || t.duration} * interval '1 minute') at time zone 'Asia/Tokyo'` : 'null'});`);
  if (t.comment && (t.comment.tag || t.comment.text))
    P(`insert into public.task_feedback (task_id, student_id, school_id, tag, body) values (${q(uuid('t:' + t.id))}, ${q(uuid(t.student))}, ${q(SCHOOL)}, ${q(TAG[t.comment.tag] || null)}, ${q(t.comment.text || '')});`);
  if (t.reply)
    P(`insert into public.task_replies (task_id, student_id, school_id, coach_id, body) values (${q(uuid('t:' + t.id))}, ${q(uuid(t.student))}, ${q(SCHOOL)}, ${q(uuid('c1'))}, ${q(t.reply.text)});`);
}

// 面談
P(`insert into public.booking_settings (coach_id, school_id, length_min, published) values (${q(uuid('c1'))}, ${q(SCHOOL)}, ${st.booking.len}, ${st.booking.published});`);
P(`insert into public.coach_open_slots (school_id, coach_id, on_date, weekday, start_time, end_time) values\n` +
  st.coachOpen.map(o => `  (${q(SCHOOL)}, ${q(uuid('c1'))}, ${o.repeat ? 'null' : q(shift(o.date))}, ${o.repeat ? o.weekday : 'null'}, ${q(o.start)}, ${q(o.end)})`).join(',\n') + ';');
P(`insert into public.meetings (id, school_id, coach_id, student_id, on_date, start_time, length_min) values\n` +
  st.meetings.map(m => `  (${q(uuid('mt:' + m.student + m.date))}, ${q(SCHOOL)}, ${q(uuid('c1'))}, ${q(uuid(m.student))}, ${q(shift(m.date))}, ${q(m.time)}, ${m.len})`).join(',\n') + ';');

// 配る資料・AI相談のあいさつ
P(`insert into public.resources (school_id, name, file_path, target_student_id, created_at) values\n` +
  st.resources.map(d => `  (${q(SCHOOL)}, ${q(d.name)}, ${q(SCHOOL + '/demo/study-guide.pdf')}, ${d.target === 'all' ? 'null' : q(uuid(d.target))}, ${q(shift(d.date))}::date)`).join(',\n') + ';');
for (const [sid, log] of Object.entries(st.chat))
  for (const m of log) P(`insert into public.chat_messages (school_id, student_id, sender, body, mood) values (${q(SCHOOL)}, ${q(uuid(sid))}, ${q(m.from === 'bot' ? 'bot' : 'student')}, ${q(m.text)}, ${q(m.mood || null)});`);

// 2026-10-05 に足したデモ：副担当・保護者（LINE）・模試と過去問・契約（scripts/seed/demo-extra.json）
const ex = JSON.parse(readFileSync(join(root, 'scripts/seed/demo-extra.json'), 'utf8'));
P(`update public.schools set line_basic_id = ${q(ex.lineBasicId)} where id = ${q(SCHOOL)};`);
for (const c of ex.subCoaches) {
  const id = uuid(c.id);
  P(`insert into auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, confirmation_token, recovery_token, email_change, email_change_token_new)
  values ('00000000-0000-0000-0000-000000000000', ${q(id)}, 'authenticated', 'authenticated', ${q(c.email)}, extensions.crypt(${q(DEMO_PASSWORD)}, extensions.gen_salt('bf')), now(), '{"provider":"email","providers":["email"]}', '{}', '', '', '', '');
insert into auth.identities (provider_id, user_id, identity_data, provider, last_sign_in_at)
  values (${q(id)}, ${q(id)}, jsonb_build_object('sub', ${q(id)}, 'email', ${q(c.email)}, 'email_verified', true), 'email', now());
insert into public.profiles (id, school_id, role, display_name, status) values (${q(id)}, ${q(SCHOOL)}, 'coach', ${q(c.name)}, 'active');`);
  for (const sid of c.students) P(`insert into public.coach_assignments (coach_id, student_id, school_id) values (${q(id)}, ${q(uuid(sid))}, ${q(SCHOOL)});`);
}
for (const g of ex.guardians)
  P(`insert into public.guardians (id, school_id, student_id, name, relation, line_user_id, linked_at, weekly_report) values (${q(uuid('g:' + g.id))}, ${q(SCHOOL)}, ${q(uuid(g.student))}, ${q(g.name)}, ${q(g.relation)}, ${g.linked ? q(g.lineUser) : 'null'}, ${g.linked ? `(${q(shift('2026-09-08'))}::date + time '20:00') at time zone 'Asia/Tokyo'` : 'null'}, ${g.weeklyReport !== false});`);
for (const x of ex.exams) {
  P(`insert into public.exam_results (id, school_id, student_id, kind, title, provider, taken_on, exam_year, total_score, total_max, passing_score, deviation, target, judgement, note) values (${q(uuid('x:' + x.id))}, ${q(SCHOOL)}, ${q(uuid(x.student))}, ${q(x.kind)}, ${q(x.title)}, ${q(x.provider || '')}, ${q(shift(x.date))}, ${x.year ?? 'null'}, ${x.score ?? 'null'}, ${x.max ?? 'null'}, ${x.passing ?? 'null'}, ${x.dev ?? 'null'}, ${q(x.target || '')}, ${q(x.judge || null)}, ${q(x.note || '')});`);
  P(`insert into public.exam_subject_scores (result_id, school_id, subject, score, max_score, deviation, seq) values\n` +
    x.subjects.map(([sub, sc, mx, dv], i) => `  (${q(uuid('x:' + x.id))}, ${q(SCHOOL)}, ${q(sub)}, ${sc}, ${mx}, ${dv ?? 'null'}, ${i})`).join(',\n') + ';');
}
P(`insert into public.school_billing (school_id, status, seats, trial_end) values (${q(SCHOOL)}, ${q(ex.billing.status)}, ${ex.billing.seats}, (${q(shift(ex.billing.trialEnd))}::date + time '23:59') at time zone 'Asia/Tokyo');`);

P('commit;');
writeFileSync(join(root, 'supabase/seed.sql'), out.join('\n') + '\n');
// テストとアプリから、デモのIDを引けるように
writeFileSync(join(root, 'src/lib/domain/__fixtures__/demo-ids.json'), JSON.stringify({
  today: TODAY, school: SCHOOL,
  people: Object.fromEntries(st.people.map(p => [p.id, { id: uuid(p.id), email: EMAIL[p.id] }])),
  materials: Object.fromEntries(st.materials.filter(m => !m.hidden).map(m => [m.id, uuid('m:' + m.id)])),
}, null, 1));
console.log(`seed.sql: today=${TODAY} shift=${SHIFT}日 tasks=${st.tasks.length}`);
export { uuid };
