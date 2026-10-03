-- seed の直後のデモの塾を、アプリが読む形（列名そのまま）の JSON にする。
-- src/lib/data/db-parity.test.ts が「DB → World → 計算」がモックと同じ答えになるかを確かめるのに使う
\set QUIET on
\pset tuples_only on
\pset format unaligned
select json_build_object(
  'materials', (select json_agg(x order by x.name) from (select id, name, short_name, subject, kind, review_intervals, keywords, archived_at from public.materials) x),
  'units', (select json_agg(x order by x.material_id, x.seq) from (select id, material_id, seq, label from public.material_units) x),
  'quizVersions', (select json_agg(x order by x.unit_id, x.version) from (select id, unit_id, version, max_score from public.quiz_versions) x),
  'tasks', (select json_agg(x order by x.on_date, x.start_time) from (select id, student_id, on_date, start_time, duration_min, material_id, unit_id, vague, title, status, quiz_version_id, max_score, no_quiz, is_retest, score, actual_min, started_at, paused_at, paused_ms, created_at from public.tasks) x),
  'feedback', (select json_agg(x) from (select task_id, tag, body, created_at from public.task_feedback) x),
  'replies', (select json_agg(x) from (select task_id, body, created_at from public.task_replies) x),
  'slots', (select json_agg(x order by x.student_id, x.on_date, x.start_time) from (select id, student_id, on_date, weekday, start_time, end_time, label from public.study_slots) x),
  'slotSkips', coalesce((select json_agg(x) from (select slot_id, on_date from public.study_slot_skips) x), '[]'),
  'books', (select json_agg(x) from (select student_id, material_id, start_on, target_on from public.student_books) x),
  'meetings', (select json_agg(x) from (select id, student_id, coach_id, on_date, start_time, length_min from public.meetings) x),
  'coachOpen', (select json_agg(x) from (select id, on_date, weekday, start_time, end_time from public.coach_open_slots) x),
  'reviewSkips', coalesce((select json_agg(x) from (select student_id, unit_id, attempt from public.review_skips) x), '[]'),
  'meetingLength', (select length_min from public.booking_settings limit 1)
);
