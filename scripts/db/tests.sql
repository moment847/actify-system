-- スキーマ・RLS・トリガ・関数のテスト。scripts/db/verify.sh から、seed.sql（デモの塾）の後に流す。
-- 期待に反したら例外で止まる（ON_ERROR_STOP）。ログインした扱いは request.jwt.claim.sub で作る。
\set ON_ERROR_STOP on
\set QUIET on

-- ---------- 準備：デモの塾の人のID ----------
select id as hina from auth.users where email = 'hina@demo.actify.jp' \gset
select id as yuma from auth.users where email = 'yuma@demo.actify.jp' \gset
select id as misaki from auth.users where email = 'misaki@demo.actify.jp' \gset
select id as coach from auth.users where email = 'sasaki@demo.actify.jp' \gset
select id as admin from auth.users where email = 'admin@demo.actify.jp' \gset
select id as school_a from public.schools where name = 'Actify デモ塾' \gset
set test.hina = :'hina';
set test.yuma = :'yuma';
set test.misaki = :'misaki';
set test.coach = :'coach';
set test.admin = :'admin';
set test.school_a = :'school_a';

-- もう1つの塾（B）と、担当のいない講師（A）
insert into auth.users (id, email) values
  ('b0000000-0000-4000-8000-000000000001', 'admin@b.example'),
  ('b0000000-0000-4000-8000-000000000002', 'coach@b.example'),
  ('b0000000-0000-4000-8000-000000000003', 'student@b.example'),
  ('a0000000-0000-4000-8000-0000000000c2', 'coach2@demo.actify.jp');
insert into public.schools (id, name) values ('bbbbbbbb-0000-4000-8000-000000000000', 'B塾');
insert into public.profiles (id, school_id, role, display_name) values
  ('b0000000-0000-4000-8000-000000000001', 'bbbbbbbb-0000-4000-8000-000000000000', 'admin', 'B運営'),
  ('b0000000-0000-4000-8000-000000000002', 'bbbbbbbb-0000-4000-8000-000000000000', 'coach', 'B講師'),
  ('b0000000-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000000', 'student', 'B生徒'),
  ('a0000000-0000-4000-8000-0000000000c2', :'school_a', 'coach', '担当なし講師');
insert into public.students (id, school_id) values ('b0000000-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000000');
insert into public.coach_assignments (coach_id, student_id, school_id) values ('b0000000-0000-4000-8000-000000000002', 'b0000000-0000-4000-8000-000000000003', 'bbbbbbbb-0000-4000-8000-000000000000');
insert into public.materials (id, school_id, name, short_name, subject, kind, review_intervals)
  values ('bbbbbbbb-0000-4000-8000-0000000000aa', 'bbbbbbbb-0000-4000-8000-000000000000', 'B単語帳', 'B単語', 'english', 'input', '{1,7}');
insert into public.material_units (school_id, material_id, seq, label) values ('bbbbbbbb-0000-4000-8000-000000000000', 'bbbbbbbb-0000-4000-8000-0000000000aa', 1, '1–100');
insert into public.tasks (school_id, student_id, on_date, start_time, duration_min, vague, title)
  values ('bbbbbbbb-0000-4000-8000-000000000000', 'b0000000-0000-4000-8000-000000000003', current_date, '19:00', 30, 'school', 'B課題');
insert into storage.objects (bucket_id, name) values
  ('quiz-pdfs', :'school_a' || '/quiz/a.pdf'),
  ('quiz-pdfs', 'bbbbbbbb-0000-4000-8000-000000000000/quiz/b.pdf'),
  ('chat-images', :'school_a' || '/' || :'hina' || '/x.jpg');

-- T1：デモのデータ（モック v19 と同じ）が入っていて、範囲の順番はモックと同じ（そろえ直しても動かない）
do $$
declare moved int;
begin
  if (select count(*) from public.tasks t where t.school_id = current_setting('test.school_a')::uuid) <> 129 then
    raise exception 'T1 FAILED: tasks (got %)', (select count(*) from public.tasks);
  end if;
  select sum(private.normalize_plan(s.id)) into moved from public.students s where s.school_id = current_setting('test.school_a')::uuid;
  if moved <> 0 then raise exception 'T1 FAILED: normalize moved % tasks', moved; end if;
  if (select count(*) from public.tasks where quiz_version_id is not null) <> 128 then
    raise exception 'T1 FAILED: quiz count (got %)', (select count(*) from public.tasks where quiz_version_id is not null);
  end if;
  raise notice 'T1 OK: seed parity with mock v19';
end $$;

-- T2：別の塾の教材を、この塾の予定に結びつけられない（複合外部キー）
do $$
begin
  begin
    insert into public.tasks (student_id, on_date, start_time, duration_min, material_id, unit_id)
    select current_setting('test.hina')::uuid, current_date + 3, '19:00', 30, m.id, u.id
    from public.materials m join public.material_units u on u.material_id = m.id where m.id = 'bbbbbbbb-0000-4000-8000-0000000000aa';
    raise exception 'T2 FAILED: cross-school material accepted';
  exception when foreign_key_violation then raise notice 'T2 OK: cross-school reference blocked';
  end;
end $$;

-- T3：同じ生徒に同じ版は二度付けない
do $$
declare v uuid; u uuid; m uuid;
begin
  select t.quiz_version_id, t.unit_id, t.material_id into v, u, m from public.tasks t
    where t.student_id = current_setting('test.hina')::uuid and t.quiz_version_id is not null and t.status = 'done' limit 1;
  begin
    insert into public.tasks (student_id, on_date, start_time, duration_min, material_id, unit_id, quiz_version_id, status, done_at)
    values (current_setting('test.hina')::uuid, current_date - 30, '05:00', 30, m, u, v, 'done', now());
    raise exception 'T3 FAILED: duplicate version accepted';
  exception when unique_violation then raise notice 'T3 OK: one version per student';
  end;
end $$;

-- T4：1つの範囲の「まだの予定」は1件だけ
do $$
declare u uuid; m uuid;
begin
  select t.unit_id, t.material_id into u, m from public.tasks t
    where t.student_id = current_setting('test.hina')::uuid and t.status = 'todo' and t.unit_id is not null limit 1;
  begin
    insert into public.tasks (student_id, on_date, start_time, duration_min, material_id, unit_id)
    values (current_setting('test.hina')::uuid, current_date + 20, '05:00', 30, m, u);
    raise exception 'T4 FAILED: second todo for the same unit accepted';
  exception when exclusion_violation then raise notice 'T4 OK: one todo per unit';
  end;
end $$;

-- ---------- 生徒（山田 陽菜）として ----------
set role authenticated;
set request.jwt.claim.sub = :'hina';

-- T5：生徒は自分の行だけ。講師メモ・小テストの版・ほかの生徒・別の塾は見えない
do $$
begin
  if (select count(*) from public.students) <> 1 then raise exception 'T5 FAILED: students %', (select count(*) from public.students); end if;
  if (select count(*) from public.tasks where student_id <> auth.uid()) <> 0 then raise exception 'T5 FAILED: other tasks visible'; end if;
  if (select count(*) from public.tasks) <> 46 then raise exception 'T5 FAILED: own tasks %', (select count(*) from public.tasks); end if;
  if (select count(*) from public.coach_notes) <> 0 then raise exception 'T5 FAILED: coach notes visible to student'; end if;
  if (select count(*) from public.quiz_versions) <> 0 then raise exception 'T5 FAILED: quiz versions visible to student'; end if;
  if (select count(*) from public.profiles) <> 3 then raise exception 'T5 FAILED: profiles % (self + main and sub coach expected)', (select count(*) from public.profiles); end if;
  if (select count(*) from public.materials) <> 4 then raise exception 'T5 FAILED: materials %', (select count(*) from public.materials); end if;
  if (select count(*) from public.coach_open_slots) = 0 then raise exception 'T5 FAILED: student cannot see coach open slots'; end if;
  if (select count(*) from public.meetings where student_id <> auth.uid()) <> 0 then raise exception 'T5 FAILED: other students meetings visible'; end if;
  if (select count(*) from public.resources) <> 3 then raise exception 'T5 FAILED: resources %', (select count(*) from public.resources); end if;
  raise notice 'T5 OK: student sees only own data';
end $$;

-- T6：生徒は予定を直接書き換えられない（RLS で0行）。完了は関数から
do $$
declare n int;
begin
  update public.tasks set duration_min = 5 where student_id = auth.uid();
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T6 FAILED: student updated % tasks directly', n; end if;
  raise notice 'T6 OK: student cannot update tasks directly';
end $$;

-- T7：完了（点数・ひとこと）。点数は満点まで。タイマーなしなら予定の時間。もう一度呼ぶと点数とひとことだけ直る
do $$
declare t uuid; mx int; r public.tasks;
begin
  select id, max_score into t, mx from public.tasks where status = 'todo' and quiz_version_id is not null order by on_date limit 1;
  begin
    perform public.complete_task(t, mx + 1, null, '');
    raise exception 'T7 FAILED: score over max accepted';
  exception when invalid_parameter_value then null;
  end;
  perform public.complete_task(t, mx - 1, 'hard', 'affect と effect で迷った');
  select * into r from public.tasks where id = t;
  if r.status <> 'done' or r.score <> mx - 1 or r.actual_min <> r.duration_min then raise exception 'T7 FAILED: %', row_to_json(r); end if;
  if not exists (select 1 from public.task_feedback where task_id = t and tag = 'hard' and body = 'affect と effect で迷った') then raise exception 'T7 FAILED: feedback'; end if;
  perform public.complete_task(t, mx, null, '');
  if (select score from public.tasks where id = t) <> mx then raise exception 'T7 FAILED: score edit'; end if;
  if exists (select 1 from public.task_feedback where task_id = t) then raise exception 'T7 FAILED: empty feedback should delete'; end if;
  perform public.reopen_task(t);
  if (select status::text || coalesce(score::text, '-') from public.tasks where id = t) <> 'todo-' then raise exception 'T7 FAILED: reopen'; end if;
  raise notice 'T7 OK: complete / edit / reopen';
end $$;

-- T8：タイマー。始めると、ほかに動いていたタイマーは止まる。5分未満で完了したら予定の時間
do $$
declare a uuid; b uuid;
begin
  select id into a from public.tasks where status = 'todo' order by on_date, start_time limit 1;
  select id into b from public.tasks where status = 'todo' and id <> a order by on_date, start_time limit 1;
  perform public.start_task(a);
  perform public.start_task(b);
  if (select started_at from public.tasks where id = a) is not null then raise exception 'T8 FAILED: other timer not stopped'; end if;
  perform public.pause_task(b);
  perform public.resume_task(b);
  perform public.complete_task(b, null, null, '');
  if (select actual_min = duration_min from public.tasks where id = b) is not true then raise exception 'T8 FAILED: short timer should record planned duration'; end if;
  perform public.reopen_task(b);
  raise notice 'T8 OK: timer';
end $$;

-- T9：ほかの生徒の予定は操作できない
reset role;
select id as yuma_task from public.tasks where student_id = :'yuma' and status = 'todo' limit 1 \gset
set test.yuma_task = :'yuma_task';
set role authenticated;
set request.jwt.claim.sub = :'hina';
do $$
begin
  begin
    perform public.complete_task(current_setting('test.yuma_task')::uuid, null, null, '');
    raise exception 'T9 FAILED: completed another student task';
  exception when no_data_found then raise notice 'T9 OK: cannot touch other students tasks';
  end;
end $$;

-- T10：AI相談は自分の分だけ。Actifyくんの返事（sender=bot）は生徒からは書けない
do $$
begin
  insert into public.chat_messages (student_id, sender, body) values (auth.uid(), 'student', '今日なにからやる？');
  begin
    insert into public.chat_messages (student_id, sender, body) values (auth.uid(), 'bot', 'なりすまし');
    raise exception 'T10 FAILED: student wrote a bot message';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.chat_messages) <> 2 then raise exception 'T10 FAILED: chat count %', (select count(*) from public.chat_messages); end if;
  raise notice 'T10 OK: chat';
end $$;

-- T11：ひとことは自分の予定にだけ。役割は本人では変えられない
do $$
begin
  begin
    update public.profiles set role = 'admin' where id = auth.uid();
    raise exception 'T11 FAILED: student changed own role';
  exception when insufficient_privilege then null;
  end;
  update public.profiles set display_name = '山田 ひな' where id = auth.uid();
  update public.profiles set display_name = '山田 陽菜' where id = auth.uid();
  raise notice 'T11 OK: profile guard';
end $$;

-- T12：ファイル置き場。生徒は小テストのPDFを直接見られない（サーバが確かめてから期限つきURLを作る）。自分のチャットの写真は見られる
do $$
begin
  if (select count(*) from storage.objects where bucket_id = 'quiz-pdfs') <> 0 then raise exception 'T12 FAILED: student sees quiz pdfs'; end if;
  if (select count(*) from storage.objects where bucket_id = 'chat-images') <> 1 then raise exception 'T12 FAILED: own chat image'; end if;
  begin
    insert into storage.objects (bucket_id, name) values ('quiz-pdfs', current_setting('test.school_a') || '/quiz/evil.pdf');
    raise exception 'T12 FAILED: student uploaded a quiz pdf';
  exception when insufficient_privilege then null;
  end;
  raise notice 'T12 OK: storage for students';
end $$;

-- T13：面談の予約。前日まで・面談できる時間の中だけ。同じ週は入れ替え
reset role;
insert into public.coach_open_slots (coach_id, on_date, start_time, end_time) values
  (:'coach', private.local_today(:'hina') + 3, '19:00', '21:00'),
  (:'coach', private.local_today(:'hina'), '19:00', '21:00');
set role authenticated;
set request.jwt.claim.sub = :'hina';
do $$
declare d date := private.local_today(auth.uid()) + 3; m uuid; wk date;
begin
  begin
    perform public.book_meeting(private.local_today(auth.uid()), '19:00');
    raise exception 'T13 FAILED: same-day booking accepted';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.book_meeting(d, '08:00');
    raise exception 'T13 FAILED: booking outside open slot accepted';
  exception when invalid_parameter_value then null;
  end;
  m := public.book_meeting(d, '19:00');
  if (select start_time from public.meetings where id = m) <> '19:00' then raise exception 'T13 FAILED: booking'; end if;
  m := public.book_meeting(d, '20:00');
  wk := d - (extract(isodow from d)::int - 1);
  if (select count(*) from public.meetings where student_id = auth.uid() and week_start = wk) <> 1 then raise exception 'T13 FAILED: week should hold one meeting'; end if;
  raise notice 'T13 OK: booking rules';
end $$;

-- T14：ほかの生徒と同じ時間は取れない（講師の面談は重ならない）
set request.jwt.claim.sub = :'yuma';
do $$
declare d date := private.local_today(auth.uid()) + 3;
begin
  begin
    perform public.book_meeting(d, '20:00');
    raise exception 'T14 FAILED: overlapping booking accepted';
  exception when exclusion_violation then null;
  end;
  if (select count(*) from public.meeting_busy(current_setting('test.coach')::uuid, d, d)) < 1 then raise exception 'T14 FAILED: busy times hidden'; end if;
  raise notice 'T14 OK: no double booking';
end $$;

-- 準備：版がまだ無い範囲（運営が目次に足した、という想定）
reset role;
insert into public.material_units (material_id, seq, label)
  select m.id, 99, 'テスト用' from public.materials m where m.school_id = :'school_a' and m.short_name = 'ターゲット1900';
set role authenticated;

-- ---------- 講師（佐々木）として ----------
set request.jwt.claim.sub = :'coach';

-- T15：担当の4人と、その記録・講師メモが見える。AI相談は見えない。別の塾は見えない
do $$
begin
  if (select count(*) from public.students) <> 4 then raise exception 'T15 FAILED: students %', (select count(*) from public.students); end if;
  if (select count(*) from public.coach_notes) <> 4 then raise exception 'T15 FAILED: coach notes'; end if;
  if (select count(*) from public.chat_messages) <> 0 then raise exception 'T15 FAILED: coach can read AI chat'; end if;
  if (select count(*) from public.tasks where school_id <> current_setting('test.school_a')::uuid) <> 0 then raise exception 'T15 FAILED: other school tasks'; end if;
  if (select count(*) from public.quiz_versions) = 0 then raise exception 'T15 FAILED: coach cannot see quiz versions'; end if;
  if (select count(*) from storage.objects where bucket_id = 'quiz-pdfs') <> 1 then raise exception 'T15 FAILED: coach storage scope'; end if;
  if (select count(*) from storage.objects where bucket_id = 'chat-images') <> 0 then raise exception 'T15 FAILED: coach sees chat images'; end if;
  raise notice 'T15 OK: coach scope';
end $$;

-- T16：範囲の順番は日付の順にそろう（モックの再現：土曜に次の範囲を入れたあとで火曜に足すと、火曜が若い番号）
do $$
declare
  en uuid; nxt int; sat date; tue date; a uuid; b uuid;
begin
  select m.id into en from public.materials m where m.short_name = 'ターゲット1900';
  -- 次の範囲 = まだ一度も予定に入っていない、いちばん若い範囲
  select min(u.seq) into nxt from public.material_units u where u.material_id = en
    and not exists (select 1 from public.tasks t where t.student_id = current_setting('test.hina')::uuid and t.unit_id = u.id);
  sat := private.local_today(current_setting('test.hina')::uuid) + 14; sat := sat - (extract(isodow from sat)::int - 1) + 5;
  tue := sat - 4;
  insert into public.tasks (student_id, on_date, start_time, duration_min, material_id, unit_id)
    select current_setting('test.hina')::uuid, sat, '09:00', 30, en, u.id from public.material_units u where u.material_id = en and u.seq = nxt returning id into a;
  insert into public.tasks (student_id, on_date, start_time, duration_min, material_id, unit_id)
    select current_setting('test.hina')::uuid, tue, '06:00', 30, en, u.id from public.material_units u where u.material_id = en and u.seq = nxt + 1 returning id into b;
  if (select u.seq from public.tasks t join public.material_units u on u.id = t.unit_id where t.id = b) <> nxt then
    raise exception 'T16 FAILED: Tuesday should get the earlier unit';
  end if;
  if (select u.seq from public.tasks t join public.material_units u on u.id = t.unit_id where t.id = a) <> nxt + 1 then
    raise exception 'T16 FAILED: Saturday should be pushed back';
  end if;
  -- 小テストは付け直されて、どちらにも付いている（その生徒が使っていない版）
  if (select count(*) from public.tasks where id in (a, b) and quiz_version_id is not null) <> 2 then raise exception 'T16 FAILED: quizzes reattached'; end if;
  delete from public.tasks where id in (a, b);
  raise notice 'T16 OK: units follow date order, quizzes reattached';
end $$;

-- T17：版が尽きた範囲は小テストなしで入り、新しい版を登録すると自動で付く
do $$
declare u uuid; en uuid; t uuid; q uuid;
begin
  select m.id into en from public.materials m where m.short_name = 'ターゲット1900';
  -- 版の無い範囲（準備で運営が足した「テスト用」）を使う
  select x.id into u from public.material_units x where x.material_id = en
    and not exists (select 1 from public.quiz_versions v where v.unit_id = x.id)
    and not exists (select 1 from public.tasks y where y.student_id = current_setting('test.hina')::uuid and y.unit_id = x.id)
    order by x.seq limit 1;
  if u is null then raise exception 'T17 FAILED: no unit without versions (setup)'; end if;
  insert into public.tasks (student_id, on_date, start_time, duration_min, material_id, unit_id)
    values (current_setting('test.hina')::uuid, private.local_today(current_setting('test.hina')::uuid) + 30, '06:00', 30, en, u) returning id into t;
  if (select quiz_version_id from public.tasks where id = t) is not null then raise exception 'T17 FAILED: quiz attached without versions'; end if;
  insert into public.quiz_versions (unit_id, version, max_score, problem_path, answer_path)
    values (u, 1, 20, current_setting('test.school_a') || '/quiz/new.pdf', current_setting('test.school_a') || '/quiz/new-a.pdf') returning id into q;
  if (select quiz_version_id from public.tasks where id = t) is distinct from q then raise exception 'T17 FAILED: new version not auto-attached'; end if;
  if (select max_score from public.tasks where id = t) <> 20 then raise exception 'T17 FAILED: max score'; end if;
  delete from public.tasks where id = t;
  raise notice 'T17 OK: new quiz versions attach to waiting tasks';
end $$;

-- T18：講師は生徒のひとことを書けない。返信は書ける。school_id を偽っても自分の塾に入る
do $$
declare t uuid; s uuid;
begin
  select id into t from public.tasks where student_id = current_setting('test.hina')::uuid and status = 'done' limit 1;
  begin
    insert into public.task_feedback (task_id, student_id, tag) values (t, current_setting('test.hina')::uuid, 'easy');
    raise exception 'T18 FAILED: coach wrote student feedback';
  exception when insufficient_privilege then null;
  end;
  insert into public.task_replies (task_id, student_id, coach_id, body) values (t, current_setting('test.hina')::uuid, auth.uid(), 'いいね')
    on conflict (task_id) do update set body = excluded.body;
  insert into public.tasks (school_id, student_id, on_date, start_time, duration_min, vague, title)
    values ('bbbbbbbb-0000-4000-8000-000000000000', current_setting('test.hina')::uuid, current_date + 5, '19:00', 30, 'mock', '模試の直し') returning school_id, id into s, t;
  if s <> current_setting('test.school_a')::uuid then raise exception 'T18 FAILED: school spoof'; end if;
  delete from public.tasks where id = t;
  raise notice 'T18 OK: feedback / reply / school spoof';
end $$;

-- T19：講師は当日でも面談を入れられる。生徒の予約を取り消せる。講師は直接（関数なしで）入れることもできる
reset role;
delete from public.meetings where student_id = :'misaki';
set role authenticated;
set request.jwt.claim.sub = :'coach';
do $$
declare m uuid;
begin
  m := public.book_meeting(private.local_today(current_setting('test.misaki')::uuid), '19:00', current_setting('test.misaki')::uuid);
  perform public.cancel_meeting(m);
  -- 講師は表に直接入れることもできる（RLS で担当の生徒だけ）
  insert into public.meetings (coach_id, student_id, on_date, start_time, length_min)
    values (auth.uid(), current_setting('test.misaki')::uuid, private.local_today(current_setting('test.misaki')::uuid) + 7, '10:00', 30);
  raise notice 'T19 OK: coach books same day and cancels';
end $$;

-- T20：担当のいない講師は、生徒を1人も見られない
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-0000000000c2';
do $$
begin
  if (select count(*) from public.students) <> 0 or (select count(*) from public.tasks) <> 0 then raise exception 'T20 FAILED: unassigned coach sees students'; end if;
  raise notice 'T20 OK: coach without assignments sees no students';
end $$;

-- ---------- 運営（デモの塾）として ----------
set request.jwt.claim.sub = :'admin';
do $$
begin
  if (select count(*) from public.students) <> 4 then raise exception 'T21 FAILED: admin students'; end if;
  if (select count(*) from public.chat_messages) <> 0 then raise exception 'T21 FAILED: admin can read AI chat'; end if;
  if (select count(*) from public.profiles) <> 8 then raise exception 'T21 FAILED: admin profiles %', (select count(*) from public.profiles); end if;
  begin
    update public.profiles set role = 'coach' where id = auth.uid();
    raise exception 'T21 FAILED: admin changed own role';
  exception when insufficient_privilege then null;
  end;
  update public.profiles set status = 'paused' where id = current_setting('test.misaki')::uuid;
  update public.profiles set status = 'active' where id = current_setting('test.misaki')::uuid;
  raise notice 'T21 OK: admin scope and guards';
end $$;

-- ---------- 別の塾（B）の運営として ----------
set request.jwt.claim.sub = 'b0000000-0000-4000-8000-000000000001';
do $$
begin
  if (select count(*) from public.tasks) <> 1 then raise exception 'T22 FAILED: B sees % tasks', (select count(*) from public.tasks); end if;
  if (select count(*) from public.materials) <> 1 then raise exception 'T22 FAILED: B sees A materials'; end if;
  if (select count(*) from public.profiles where school_id <> 'bbbbbbbb-0000-4000-8000-000000000000') <> 0 then raise exception 'T22 FAILED: B sees A people'; end if;
  if (select count(*) from storage.objects) <> 1 then raise exception 'T22 FAILED: B storage scope'; end if;
  raise notice 'T22 OK: schools are isolated';
end $$;

-- ---------- 未ログイン ----------
reset role;
set role anon;
do $$
begin
  begin
    perform count(*) from public.tasks;
    raise exception 'T23 FAILED: anon can read tasks';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.book_meeting(current_date + 3, '19:00');
    raise exception 'T23 FAILED: anon can call book_meeting';
  exception when insufficient_privilege then null;
  end;
  raise notice 'T23 OK: anon has no access';
end $$;
reset role;

-- T24：ポリシーは1テーブル × 1コマンド × 1本。public の security definer 関数は anon が呼べない
do $$
declare dup text; leak text;
begin
  select string_agg(tablename || ':' || cmd, ', ') into dup from (
    select tablename, cmd from pg_policies where schemaname = 'public' or (schemaname = 'storage' and policyname like 'actify%')
    group by schemaname, tablename, cmd having count(*) > 1) x;
  if dup is not null then raise exception 'T24 FAILED: multiple policies %', dup; end if;
  select string_agg(p.proname, ', ') into leak from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private') and p.prosecdef and has_function_privilege('anon', p.oid, 'execute');
  if leak is not null then raise exception 'T24 FAILED: anon can execute %', leak; end if;
  raise notice 'T24 OK: one policy per command, no anon execute';
end $$;

-- T25：予備時間に、いちばん古いやり残しを入れる
insert into public.tasks (student_id, on_date, start_time, duration_min, vague, title)
  values (:'hina', private.local_today(:'hina') + 1, '19:00', 120, 'buffer', '予備時間') returning id as buffer_task \gset
set test.buffer = :'buffer_task';
set role authenticated;
set request.jwt.claim.sub = :'hina';
do $$
declare mv uuid; mvd int;
begin
  mv := public.fill_buffer(current_setting('test.buffer')::uuid);
  if mv is null then raise exception 'T25 FAILED: nothing moved'; end if;
  select duration_min into mvd from public.tasks where id = mv;
  if (select on_date from public.tasks where id = mv) <> private.local_today(auth.uid()) + 1 then raise exception 'T25 FAILED: not moved'; end if;
  if (select duration_min from public.tasks where id = current_setting('test.buffer')::uuid) <> 120 - mvd then raise exception 'T25 FAILED: buffer not shortened'; end if;
  raise notice 'T25 OK: fill buffer';
end $$;
reset role;

-- ---------- レビューで見つかった穴（2026-10-03） ----------
-- T26：別の塾のファイルのパスは、資料・小テスト・目次・チャットの写真のどれにも登録できない
set role authenticated;
set request.jwt.claim.sub = :'coach';
do $$
declare u uuid;
begin
  begin
    insert into public.resources (name, file_path) values ('盗み見', 'bbbbbbbb-0000-4000-8000-000000000000/quiz/b.pdf');
    raise exception 'T26 FAILED: other school path accepted for resources';
  exception when check_violation then null;
  end;
  begin
    insert into public.resources (name, file_path) values ('上へ', current_setting('test.school_a') || '/../bbbbbbbb-0000-4000-8000-000000000000/quiz/b.pdf');
    raise exception 'T26 FAILED: dot-dot path accepted';
  exception when check_violation then null;
  end;
  begin
    update public.resources set file_path = 'bbbbbbbb-0000-4000-8000-000000000000/quiz/b.pdf' where school_id = current_setting('test.school_a')::uuid;
    raise exception 'T26 FAILED: other school path accepted on update';
  exception when check_violation then null;
  end;
  select id into u from public.material_units limit 1;
  begin
    insert into public.quiz_versions (unit_id, version, max_score, problem_path, answer_path)
      values (u, 99, 20, current_setting('test.school_a') || '/quiz/ok.pdf', 'bbbbbbbb-0000-4000-8000-000000000000/quiz/b.pdf');
    raise exception 'T26 FAILED: other school answer path accepted';
  exception when check_violation then null;
  end;
  raise notice 'T26 OK: file paths stay inside the school folder';
end $$;
set request.jwt.claim.sub = :'hina';
do $$
begin
  begin
    insert into public.chat_messages (student_id, sender, body, image_path) values (auth.uid(), 'student', 'x', current_setting('test.school_a') || '/' || current_setting('test.yuma') || '/x.jpg');
    raise exception 'T26b FAILED: another student image path accepted';
  exception when check_violation then null;
  end;
  raise notice 'T26b OK: chat image must be in own folder';
end $$;

-- T27：面談の時間と、まだの学習予定は重ならない（どちらから入れても止まる）。終わった予定（記録）は見ない
reset role;
insert into public.coach_open_slots (coach_id, on_date, start_time, end_time) values (:'coach', private.local_today(:'hina') + 10, '18:00', '22:00');
insert into public.meetings (coach_id, student_id, on_date, start_time, length_min) values (:'coach', :'hina', private.local_today(:'hina') + 10, '19:00', 30);
set role authenticated;
set request.jwt.claim.sub = :'coach';
do $$
declare d date := private.local_today(current_setting('test.hina')::uuid) + 10; t uuid;
begin
  begin
    insert into public.tasks (student_id, on_date, start_time, duration_min, vague, title) values (current_setting('test.hina')::uuid, d, '18:45', 30, 'mock', '模試の直し');
    raise exception 'T27 FAILED: task overlapping a meeting accepted';
  exception when exclusion_violation then null;
  end;
  insert into public.tasks (student_id, on_date, start_time, duration_min, vague, title) values (current_setting('test.hina')::uuid, d, '18:00', 60, 'mock', '模試の直し') returning id into t;
  -- 動かして面談に重ねるのも止まる（18:00〜19:00 はちょうど接するだけなので通っている）
  begin
    update public.tasks set duration_min = 75 where id = t;
    raise exception 'T27 FAILED: stretching into a meeting accepted';
  exception when exclusion_violation then null;
  end;
  -- 学習の予定がある時間に面談は入れられない（講師が直接でも、関数からでも）
  begin
    update public.meetings set start_time = '18:30' where student_id = current_setting('test.hina')::uuid and on_date = d;
    raise exception 'T27 FAILED: meeting moved onto a task';
  exception when exclusion_violation then null;
  end;
  begin
    perform public.book_meeting(d, '18:15', current_setting('test.hina')::uuid);
    raise exception 'T27 FAILED: book_meeting onto a task';
  exception when exclusion_violation then
    if sqlerrm not like '%学習の予定%' then raise exception 'T27 FAILED: wrong message %', sqlerrm; end if;
  end;
  delete from public.tasks where id = t;
  raise notice 'T27 OK: meetings and planned study never overlap';
end $$;
reset role;

-- T28：AI の上限。service_role だけが枠を取れる。同時に1件・1人1日の回数・塾の月の予算
set role authenticated;
set request.jwt.claim.sub = :'hina';
do $$
begin
  begin
    perform public.ai_reserve(current_setting('test.school_a')::uuid, auth.uid(), 'chat', 10);
    raise exception 'T28 FAILED: student can reserve AI';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;
-- service_role には JWT の sub が無い（auth.uid() は null）
set request.jwt.claim.sub = '';
set role service_role;
do $$
declare a bigint; s uuid := current_setting('test.school_a')::uuid; u uuid := current_setting('test.hina')::uuid;
begin
  update public.schools set ai_daily_limit_per_user = 2, ai_monthly_budget_jpy = 30 where id = s;
  a := public.ai_reserve(s, u, 'chat', 10);
  begin
    perform public.ai_reserve(s, u, 'chat', 10);
    raise exception 'T28 FAILED: second call while one is running';
  exception when raise_exception then if sqlerrm <> 'AI_BUSY' then raise; end if;
  end;
  perform public.ai_settle(a, 'claude-opus-5-5', 'actify-chat.v1', 1000, 200, 8, null);
  a := public.ai_reserve(s, u, 'chat', 10);
  perform public.ai_settle(a, 'claude-opus-5-5', 'actify-chat.v1', 1000, 200, 8, null);
  begin
    perform public.ai_reserve(s, u, 'chat', 10);
    raise exception 'T28 FAILED: daily limit not enforced';
  exception when raise_exception then if sqlerrm <> 'AI_DAILY_LIMIT' then raise; end if;
  end;
  -- 月の予算（30円）：使った16円 + 見込み20円 > 30円 で止まる（別の人でも）
  begin
    perform public.ai_reserve(s, current_setting('test.admin')::uuid, 'toc_ocr', 20);
    raise exception 'T28 FAILED: budget not enforced';
  exception when raise_exception then if sqlerrm <> 'AI_BUDGET' then raise; end if;
  end;
  update public.schools set ai_daily_limit_per_user = 30, ai_monthly_budget_jpy = 5000 where id = s;
  raise notice 'T28 OK: AI limits';
end $$;
reset role;

-- ---------- 自分で洗い直した分（2026-10-04） ----------
-- T29：塾の運営は AI の上限を変えられない（service_role だけ）
set role authenticated;
set request.jwt.claim.sub = :'admin';
do $$
begin
  begin
    update public.schools set ai_monthly_budget_jpy = 999999999 where id = current_setting('test.school_a')::uuid;
    raise exception 'T29 FAILED: school admin raised AI budget';
  exception when insufficient_privilege then null;
  end;
  update public.schools set name = 'Actify デモ塾' where id = current_setting('test.school_a')::uuid;
  raise notice 'T29 OK: AI limits locked for school admins';
end $$;

-- T30：タイムゾーンの名前は確かめる（変な値で全部の操作が落ちないように）
set request.jwt.claim.sub = :'hina';
do $$
begin
  begin
    update public.profiles set timezone = 'Mars/Olympus' where id = auth.uid();
    raise exception 'T30 FAILED: bad timezone accepted';
  exception when invalid_parameter_value then null;
  end;
  update public.profiles set timezone = 'America/Los_Angeles' where id = auth.uid();
  if private.local_today(auth.uid()) is null then raise exception 'T30 FAILED: local_today'; end if;
  update public.profiles set timezone = null where id = auth.uid();
  raise notice 'T30 OK: timezone validated';
end $$;

-- T31：終わった予定（記録）は動かせない・消せない。点数は直せる。未完了に戻せば動かせる
set request.jwt.claim.sub = :'coach';
do $$
declare t uuid; n int;
begin
  select id into t from public.tasks where student_id = current_setting('test.hina')::uuid and status = 'done' and quiz_version_id is not null limit 1;
  begin
    update public.tasks set start_time = '05:00' where id = t;
    raise exception 'T31 FAILED: moved a done task';
  exception when check_violation then null;
  end;
  begin
    update public.tasks set duration_min = duration_min + 5 where id = t;
    raise exception 'T31 FAILED: resized a done task';
  exception when check_violation then null;
  end;
  update public.tasks set score = 1 where id = t;
  update public.tasks set score = 10 where id = t;
  raise notice 'T31 OK: done tasks are records';
end $$;

-- T32：版の番号は DB が付ける（同じ範囲に2件入れると 次の番号・その次）。アプリは番号を送らない
do $$
declare u uuid; a int; b int; base int;
begin
  select x.id into u from public.material_units x where x.label = 'テスト用' limit 1;
  select coalesce(max(version), 0) into base from public.quiz_versions where unit_id = u;
  insert into public.quiz_versions (unit_id, max_score, problem_path, answer_path)
    values (u, 20, current_setting('test.school_a') || '/quiz/p1.pdf', current_setting('test.school_a') || '/quiz/a1.pdf') returning version into a;
  insert into public.quiz_versions (unit_id, max_score, problem_path, answer_path)
    values (u, 20, current_setting('test.school_a') || '/quiz/p2.pdf', current_setting('test.school_a') || '/quiz/a2.pdf') returning version into b;
  if a <> base + 1 or b <> base + 2 then raise exception 'T32 FAILED: versions % %', a, b; end if;
  if (select created_by from public.quiz_versions where unit_id = u and version = b) <> auth.uid() then raise exception 'T32 FAILED: created_by not stamped'; end if;
  raise notice 'T32 OK: versions numbered by DB';
end $$;

-- T33：3つ以上の入れ替え（土・金・火 の順に次の範囲を入れると、火 < 金 < 土 の順に若い番号になる）
do $$
declare
  en uuid; nxt int; sat date; fri date; tue date; a uuid; b uuid; c uuid; sa int; sb int; sc int;
begin
  select m.id into en from public.materials m where m.short_name = 'ターゲット1900' and m.school_id = current_setting('test.school_a')::uuid;
  select min(u.seq) into nxt from public.material_units u where u.material_id = en and u.label <> 'テスト用'
    and not exists (select 1 from public.tasks t where t.student_id = current_setting('test.hina')::uuid and t.unit_id = u.id);
  sat := private.local_today(current_setting('test.hina')::uuid) + 21; sat := sat - (extract(isodow from sat)::int - 1) + 5;
  fri := sat - 1; tue := sat - 4;
  insert into public.tasks (student_id, on_date, start_time, duration_min, material_id, unit_id)
    select current_setting('test.hina')::uuid, sat, '09:00', 30, en, u.id from public.material_units u where u.material_id = en and u.seq = nxt returning id into a;
  insert into public.tasks (student_id, on_date, start_time, duration_min, material_id, unit_id)
    select current_setting('test.hina')::uuid, fri, '20:00', 30, en, u.id from public.material_units u where u.material_id = en and u.seq = nxt + 1 returning id into b;
  insert into public.tasks (student_id, on_date, start_time, duration_min, material_id, unit_id)
    select current_setting('test.hina')::uuid, tue, '06:00', 30, en, u.id from public.material_units u where u.material_id = en and u.seq = nxt + 2 returning id into c;
  select u.seq into sa from public.tasks t join public.material_units u on u.id = t.unit_id where t.id = a;
  select u.seq into sb from public.tasks t join public.material_units u on u.id = t.unit_id where t.id = b;
  select u.seq into sc from public.tasks t join public.material_units u on u.id = t.unit_id where t.id = c;
  if not (sc = nxt and sb = nxt + 1 and sa = nxt + 2) then raise exception 'T33 FAILED: tue=% fri=% sat=%', sc, sb, sa; end if;
  if (select created_by from public.tasks where id = c) <> auth.uid() then raise exception 'T33 FAILED: created_by'; end if;
  delete from public.tasks where id in (a, b, c);
  raise notice 'T33 OK: three-way reorder';
end $$;

-- T34：返信の講師はログインしている人になる（送った値は無視）。見えない行の update / delete は 0 行
do $$
declare t uuid; n int;
begin
  select id into t from public.tasks where student_id = current_setting('test.hina')::uuid and status = 'done' limit 1;
  insert into public.task_replies (task_id, coach_id, body) values (t, 'a0000000-0000-4000-8000-0000000000c2', 'なりすまし')
    on conflict (task_id) do update set coach_id = excluded.coach_id, body = excluded.body;
  if (select coach_id from public.task_replies where task_id = t) <> auth.uid() then raise exception 'T34 FAILED: coach_id spoofed'; end if;
  update public.tasks set duration_min = 30 where id = current_setting('test.yuma_task')::uuid and false;
  update public.materials set name = 'x' where school_id = 'bbbbbbbb-0000-4000-8000-000000000000';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T34 FAILED: updated another school materials'; end if;
  delete from public.tasks where school_id = 'bbbbbbbb-0000-4000-8000-000000000000';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T34 FAILED: deleted another school tasks'; end if;
  raise notice 'T34 OK: stamps and cross-school writes';
end $$;
reset role;


-- =========================================================
-- 2026-10-05：主担当と副担当・保護者・成績・通知・契約
-- =========================================================
-- T35：主担当はいつも1人。副担当を足しても主担当は変わらない。付け替えは運営だけ。主担当を外すと残りが主担当になる
set role authenticated;
set request.jwt.claim.sub = :'admin';
do $$
declare h uuid := current_setting('test.hina')::uuid; c2 uuid := 'a0000000-0000-4000-8000-0000000000c2'; c1 uuid := current_setting('test.coach')::uuid;
begin
  insert into public.coach_assignments (coach_id, student_id) values (c2, h);
  if (select coach_id from public.coach_assignments where student_id = h and is_main) <> c1 then raise exception 'T35 FAILED: main changed by adding sub'; end if;
  perform public.set_main_coach(h, c2);
  if (select coach_id from public.coach_assignments where student_id = h and is_main) <> c2 then raise exception 'T35 FAILED: set_main_coach'; end if;
  if (select count(*) from public.coach_assignments where student_id = h and is_main) <> 1 then raise exception 'T35 FAILED: two mains'; end if;
  delete from public.coach_assignments where student_id = h and coach_id = c2;
  if (select coach_id from public.coach_assignments where student_id = h and is_main) <> c1 then raise exception 'T35 FAILED: main not promoted after delete'; end if;
end $$;
set request.jwt.claim.sub = :'coach';
do $$
begin
  begin
    perform public.set_main_coach(current_setting('test.hina')::uuid, current_setting('test.coach')::uuid);
    raise exception 'T35 FAILED: coach could set main';
  exception when insufficient_privilege then null;
  end;
  raise notice 'T35 OK: main coach is always one';
end $$;

-- T36：保護者。講師は自分の担当の生徒にだけ足せる。LINE のつながりは手で入れられない。生徒本人には見えない
do $$
declare g uuid; code text; code2 text;
begin
  begin
    insert into public.guardians (student_id, name, line_user_id, linked_at) values (current_setting('test.hina')::uuid, 'なりすまし', 'Ufake', now());
    raise exception 'T36 FAILED: line_user_id set by coach';
  exception when insufficient_privilege then null;
  end;
  insert into public.guardians (student_id, name, relation) values (current_setting('test.hina')::uuid, '山田 恵子', '母') returning id, link_code into g, code;
  if code !~ '^[A-HJ-NP-Z2-9]{8}$' then raise exception 'T36 FAILED: link code %', code; end if;
  begin
    update public.guardians set line_user_id = 'Ufake', linked_at = now() where id = g;
    raise exception 'T36 FAILED: coach linked LINE by hand';
  exception when insufficient_privilege then null;
  end;
  code2 := public.renew_link_code(g);
  if code2 = code then raise exception 'T36 FAILED: code not renewed'; end if;
  begin
    insert into public.guardians (student_id, name) values ('b0000000-0000-4000-8000-000000000003', '別の塾');
    raise exception 'T36 FAILED: other school guardian';
  exception when insufficient_privilege or foreign_key_violation then null;
  end;
  perform set_config('test.guardian', g::text, false);
  perform set_config('test.code', code2, false);
end $$;
set request.jwt.claim.sub = :'hina';
do $$
begin
  if (select count(*) from public.guardians) <> 0 then raise exception 'T36 FAILED: student sees guardians'; end if;
end $$;
reset role;
set request.jwt.claim.sub = '';
set role service_role;
do $$
declare g uuid;
begin
  g := public.link_guardian_line(current_setting('test.school_a')::uuid, lower(substr(current_setting('test.code'), 1, 4) || '-' || substr(current_setting('test.code'), 5)), 'U1234567890abcdef');
  if g is distinct from current_setting('test.guardian')::uuid then raise exception 'T36 FAILED: link by code (got %)', g; end if;
  if (select line_user_id from public.guardians where id = g) <> 'U1234567890abcdef' then raise exception 'T36 FAILED: line id'; end if;
  if public.link_guardian_line(current_setting('test.school_a')::uuid, current_setting('test.code'), 'Uother') is not null then raise exception 'T36 FAILED: code reused'; end if;
  if public.link_guardian_line('bbbbbbbb-0000-4000-8000-000000000000', current_setting('test.code'), 'Uother') is not null then raise exception 'T36 FAILED: other school code'; end if;
  raise notice 'T36 OK: guardians and LINE linking';
end $$;
reset role;

-- T37：成績。生徒は自分の分だけ書ける。模試と過去問で入れられる項目が違う。講師は担当の生徒の分を見られる
set role authenticated;
set request.jwt.claim.sub = :'hina';
do $$
declare r uuid;
begin
  insert into public.exam_results (student_id, kind, title, provider, taken_on, total_score, total_max, deviation, target, judgement)
    values (current_setting('test.hina')::uuid, 'mock', '全統共通テスト模試', '河合塾', current_date - 10, 612, 900, 58.4, '早稲田大学 商学部', 'C') returning id into r;
  insert into public.exam_subject_scores (result_id, subject, score, max_score, deviation) values (r, '英語', 152, 200, 61.2), (r, '数学', 118, 200, 55.0);
  if (select created_by from public.exam_results where id = r) <> auth.uid() then raise exception 'T37 FAILED: created_by'; end if;
  begin
    insert into public.exam_results (student_id, kind, title, taken_on) values (current_setting('test.yuma')::uuid, 'mock', '他人', current_date);
    raise exception 'T37 FAILED: wrote another student exam';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.exam_results (student_id, kind, title, taken_on, deviation) values (current_setting('test.hina')::uuid, 'past', '早稲田 商', current_date, 50);
    raise exception 'T37 FAILED: deviation on past exam';
  exception when check_violation then null;
  end;
  insert into public.exam_results (student_id, kind, title, taken_on, exam_year, total_score, total_max, passing_score)
    values (current_setting('test.hina')::uuid, 'past', '早稲田大学 商学部', current_date - 3, 2025, 98.5, 150, 102.3);
  perform set_config('test.exam', r::text, false);
end $$;
set request.jwt.claim.sub = :'coach';
do $$
begin
  if (select count(*) from public.exam_subject_scores where result_id = current_setting('test.exam')::uuid) <> 2 then raise exception 'T37 FAILED: coach cannot see subjects'; end if;
end $$;
set request.jwt.claim.sub = 'b0000000-0000-4000-8000-000000000002';
do $$
begin
  if exists (select 1 from public.exam_results where student_id = current_setting('test.hina')::uuid) then raise exception 'T37 FAILED: other school coach sees exams'; end if;
  raise notice 'T37 OK: exam results';
end $$;

-- T38：通知。講師が返信すると生徒に届く。本人は読んだ印だけ付けられる。自分で通知を作れない。人の通知は見えない
set request.jwt.claim.sub = :'coach';
do $$
declare t uuid;
begin
  select id into t from public.tasks where student_id = current_setting('test.hina')::uuid and status = 'done' order by on_date desc limit 1;
  insert into public.task_replies (task_id, body) values (t, 'よくできています') on conflict (task_id) do update set body = excluded.body;
end $$;
set request.jwt.claim.sub = :'hina';
do $$
declare n bigint;
begin
  select id into n from public.notifications where kind = 'reply' order by id desc limit 1;
  if n is null then raise exception 'T38 FAILED: no reply notification'; end if;
  update public.notifications set read_at = now() where id = n;
  begin
    update public.notifications set title = 'x' where id = n;
    raise exception 'T38 FAILED: changed title';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.notifications (school_id, user_id, kind, title, dedupe_key) values (current_setting('test.school_a')::uuid, auth.uid(), 'reply', 'x', 'x');
    raise exception 'T38 FAILED: inserted notification';
  exception when insufficient_privilege then null;
  end;
end $$;
set request.jwt.claim.sub = :'yuma';
do $$
begin
  if exists (select 1 from public.notifications where user_id = current_setting('test.hina')::uuid) then raise exception 'T38 FAILED: sees others'; end if;
  raise notice 'T38 OK: notifications';
end $$;

-- T39：面談の通知。講師が入れると生徒に届く。同じ週に入れ直したときは「取り消し」を出さない
reset role;
select coalesce(max(id), 0) as n0 from public.notifications \gset
set test.n0 = :'n0';
set role authenticated;
set request.jwt.claim.sub = :'coach';
do $$
declare d date := private.local_today(current_setting('test.misaki')::uuid) + 35;
begin
  d := d - (extract(isodow from d)::int - 1) + 2;   -- 5週あとの水曜
  perform set_config('test.meet_day', d::text, false);
  perform public.book_meeting(d, '20:00', current_setting('test.misaki')::uuid);
end $$;
do $$
begin
  perform public.book_meeting(current_setting('test.meet_day')::date + 1, '20:30', current_setting('test.misaki')::uuid);
end $$;
reset role;
do $$
declare booked int; cancelled int;
begin
  select count(*) filter (where kind = 'meeting_booked'), count(*) filter (where kind = 'meeting_cancelled') into booked, cancelled
    from public.notifications where user_id = current_setting('test.misaki')::uuid and id > current_setting('test.n0')::bigint;
  if booked <> 2 or cancelled <> 0 then raise exception 'T39 FAILED: booked % cancelled %', booked, cancelled; end if;
  if exists (select 1 from public.notifications where user_id = current_setting('test.coach')::uuid and kind like 'meeting%' and id > current_setting('test.n0')::bigint) then
    raise exception 'T39 FAILED: coach notified about own booking';
  end if;
  raise notice 'T39 OK: meeting notifications';
end $$;

-- T40：時刻で決まる通知。予定の15分前に1回だけ。本人が切った種類は届かない。サーバだけが呼べる
do $$
declare now_t time; t uuid; n int; tz text; off int;
begin
  -- いつ流しても同じ結果になるよう、生徒のタイムゾーンを「いまが昼ごろ」になる所にする（テストの間だけ）
  off := 12 - extract(hour from now() at time zone 'UTC')::int;
  tz := 'Etc/GMT' || case when off > 0 then '-' || off when off < 0 then '+' || (-off) else '' end;
  update public.profiles set timezone = tz where id = current_setting('test.yuma')::uuid;
  now_t := (now() at time zone tz)::time;
  delete from public.tasks where student_id = current_setting('test.yuma')::uuid and on_date = (now() at time zone tz)::date and status = 'todo';
  insert into public.tasks (student_id, on_date, start_time, duration_min, vague, title)
    values (current_setting('test.yuma')::uuid, (now() at time zone tz)::date, date_trunc('minute', now_t + interval '10 minutes')::time, 15, 'school', '学校の課題') returning id into t;
  perform public.enqueue_due_notifications();
  perform public.enqueue_due_notifications();
  select count(*) into n from public.notifications where dedupe_key = 'task_start:' || t;
  if n <> 1 then raise exception 'T40 FAILED: task_start count %', n; end if;
  insert into public.notification_prefs (user_id, task_start) values (current_setting('test.yuma')::uuid, false);
  insert into public.tasks (student_id, on_date, start_time, duration_min, vague, title)
    values (current_setting('test.yuma')::uuid, (now() at time zone tz)::date, date_trunc('minute', now_t + interval '12 minutes')::time, 15, 'school', '学校の課題2') returning id into t;
  perform public.enqueue_due_notifications();
  if exists (select 1 from public.notifications where dedupe_key = 'task_start:' || t) then raise exception 'T40 FAILED: pref ignored'; end if;
  update public.profiles set timezone = null where id = current_setting('test.yuma')::uuid;
  raise notice 'T40 OK: time-based notifications';
end $$;
set role authenticated;
set request.jwt.claim.sub = :'admin';
do $$
begin
  begin
    perform public.enqueue_due_notifications();
    raise exception 'T40 FAILED: admin could call enqueue';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.link_guardian_line(current_setting('test.school_a')::uuid, 'X', 'U');
    raise exception 'T40 FAILED: admin could call link_guardian_line';
  exception when insufficient_privilege then null;
  end;
end $$;
reset role;

-- T41：契約は運営が見るだけ。講師は見えない。LINE の鍵はだれも読めない
insert into public.school_billing (school_id, status, seats) values (:'school_a', 'trialing', 4) on conflict (school_id) do nothing;
insert into public.school_line_channels (school_id, channel_secret_enc, access_token_enc) values (:'school_a', 'enc', 'enc') on conflict (school_id) do nothing;
set role authenticated;
set request.jwt.claim.sub = :'admin';
do $$
declare n int;
begin
  if (select count(*) from public.school_billing) <> 1 then raise exception 'T41 FAILED: admin cannot see billing'; end if;
  update public.school_billing set status = 'active';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T41 FAILED: admin changed billing'; end if;
  if (select count(*) from public.school_line_channels) <> 0 then raise exception 'T41 FAILED: admin reads LINE secrets'; end if;
  begin
    update public.schools set line_basic_id = '@actify-demo' where id = current_setting('test.school_a')::uuid;
  exception when others then raise exception 'T41 FAILED: admin cannot set line id: %', sqlerrm;
  end;
end $$;
set request.jwt.claim.sub = :'coach';
do $$
begin
  if (select count(*) from public.school_billing) <> 0 then raise exception 'T41 FAILED: coach sees billing'; end if;
  if (select count(*) from public.weekly_reports) <> 0 then null; end if;
  raise notice 'T41 OK: billing and secrets';
end $$;
reset role;

-- T42：未ログインは新しい表も読めない
set role anon;
do $$
begin
  begin
    perform 1 from public.guardians;
    raise exception 'T42 FAILED: anon reads guardians';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.exam_results;
    raise exception 'T42 FAILED: anon reads exams';
  exception when insufficient_privilege then null;
  end;
  raise notice 'T42 OK: anon blocked';
end $$;
reset role;

-- T43：LINE の鍵が入っているかは講師・運営だけが分かる（鍵そのものは見えない）。点数は小数2桁（合格最低点 129.95）まで入る
set role authenticated;
set request.jwt.claim.sub = :'coach';
do $$
declare r uuid;
begin
  if not public.line_ready() then raise exception 'T43 FAILED: coach line_ready'; end if;
  insert into public.exam_results (student_id, kind, title, taken_on, exam_year, total_score, total_max, passing_score)
    values (current_setting('test.hina')::uuid, 'past', 'テスト大学', '2026-09-01', 2025, 118, 200, 129.95) returning id into r;
  if (select passing_score from public.exam_results where id = r) <> 129.95 then raise exception 'T43 FAILED: passing score rounded'; end if;
  delete from public.exam_results where id = r;
end $$;
set request.jwt.claim.sub = :'hina';
do $$
begin
  if public.line_ready() then raise exception 'T43 FAILED: student line_ready'; end if;
  raise notice 'T43 OK: line_ready and 2-decimal scores';
end $$;
reset role;

-- T44：休会中の生徒は自分の予定も読めない（請求に数えない人は使えない）。在籍に戻せば読める
set role authenticated;
set request.jwt.claim.sub = :'admin';
update public.profiles set status = 'paused' where id = current_setting('test.hina')::uuid;
set request.jwt.claim.sub = :'hina';
do $$
begin
  if (select count(*) from public.tasks) <> 0 then raise exception 'T44 FAILED: paused student reads tasks'; end if;
  if (select count(*) from public.students) <> 0 then raise exception 'T44 FAILED: paused student reads students'; end if;
  if (select count(*) from public.exam_results) <> 0 then raise exception 'T44 FAILED: paused student reads exams'; end if;
  if private.my_role() is not null then raise exception 'T44 FAILED: paused has role'; end if;
end $$;
set request.jwt.claim.sub = :'admin';
update public.profiles set status = 'active' where id = current_setting('test.hina')::uuid;
set request.jwt.claim.sub = :'hina';
do $$
begin
  if (select count(*) from public.tasks) = 0 then raise exception 'T44 FAILED: active student lost tasks'; end if;
  raise notice 'T44 OK: paused members are locked out';
end $$;
reset role;

-- T45：保護者・成績を別の生徒に移せない。通知の url にタブは入らない
set role authenticated;
set request.jwt.claim.sub = :'coach';
do $$
declare n int;
begin
  begin
    update public.guardians set student_id = current_setting('test.yuma')::uuid where id = current_setting('test.guardian')::uuid;
    raise exception 'T45 FAILED: guardian moved to another student';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.exam_results set student_id = current_setting('test.yuma')::uuid where student_id = current_setting('test.hina')::uuid;
    get diagnostics n = row_count;
    if n > 0 then raise exception 'T45 FAILED: exam moved to another student'; end if;
  exception when insufficient_privilege then null;
  end;
  raise notice 'T45 OK: rows stay with their student';
end $$;
reset role;
do $$
begin
  begin
    insert into public.notifications (school_id, user_id, kind, title, url, dedupe_key)
      values (current_setting('test.school_a')::uuid, current_setting('test.hina')::uuid, 'reply', 'x', E'/\t/evil.example', 't45');
    raise exception 'T45 FAILED: tab in url accepted';
  exception when check_violation then null;
  end;
end $$;

-- ===== 2026-10-10 の点検（review_fixes_3） =====
-- T46：主担当の講師を退会にすると、残った担当が主担当になる
begin;
insert into public.coach_assignments (coach_id, student_id) values ('a0000000-0000-4000-8000-0000000000c2', :'hina');
set role authenticated;
set request.jwt.claim.sub = :'admin';
update public.profiles set status = 'withdrawn' where id = current_setting('test.coach')::uuid;
reset role;
do $$
begin
  if (select count(*) from public.coach_assignments where student_id = current_setting('test.hina')::uuid and is_main) <> 1
     or exists (select 1 from public.coach_assignments where coach_id = current_setting('test.coach')::uuid) then
    raise exception 'T46 FAILED: no main coach after the main coach withdrew';
  end if;
  raise notice 'T46 OK: main coach is kept after withdrawal';
end $$;
rollback;

-- T47：終わった予定（記録）は直接消せない
begin;
set role authenticated;
set request.jwt.claim.sub = :'coach';
do $$
declare t uuid;
begin
  select id into t from public.tasks where student_id = current_setting('test.hina')::uuid and status = 'done' limit 1;
  begin
    delete from public.tasks where id = t;
    raise exception 'T47 FAILED: deleted a done task';
  exception when check_violation then null;
  end;
  raise notice 'T47 OK: done tasks cannot be deleted';
end $$;
reset role;
rollback;

-- T48：予備時間に入れるのは範囲のあるやり残しだけ（過去の使われなかった予備時間は入れない）
begin;
insert into public.tasks (student_id, on_date, start_time, duration_min, vague, title)
  values (:'hina', private.local_today(:'hina') - 40, '05:00', 60, 'buffer', '予備時間') returning id as oldbuf \gset
insert into public.tasks (student_id, on_date, start_time, duration_min, vague, title)
  values (:'hina', private.local_today(:'hina') + 1, '05:00', 120, 'buffer', '予備時間') returning id as newbuf \gset
set role authenticated;
set request.jwt.claim.sub = :'hina';
select coalesce(public.fill_buffer(:'newbuf')::text, '') as moved \gset
reset role;
set test.moved = :'moved';
do $$
begin
  if current_setting('test.moved') <> '' and (select unit_id from public.tasks where id = current_setting('test.moved')::uuid) is null then
    raise exception 'T48 FAILED: a time-only task was put into the buffer';
  end if;
  raise notice 'T48 OK: only leftovers with a range go into the buffer';
end $$;
rollback;

-- T49：返信の時刻と講師は DB が決める（送った値・書き換えでは変わらない）
begin;
select f.task_id as tid from public.task_feedback f where f.student_id = :'hina' and not exists (select 1 from public.task_replies r where r.task_id = f.task_id) limit 1 \gset
set role authenticated;
set request.jwt.claim.sub = :'coach';
insert into public.task_replies (task_id, body, created_at) values (:'tid', '返信', '2000-01-01');
update public.task_replies set coach_id = 'a0000000-0000-4000-8000-0000000000c2', created_at = '2000-01-01' where task_id = :'tid';
reset role;
set test.tid = :'tid';
do $$
declare r public.task_replies;
begin
  select * into r from public.task_replies where task_id = current_setting('test.tid')::uuid;
  if r.created_at < now() - interval '1 minute' then raise exception 'T49 FAILED: reply time taken from the client'; end if;
  if r.coach_id <> current_setting('test.coach')::uuid then raise exception 'T49 FAILED: reply moved to another coach'; end if;
  raise notice 'T49 OK: reply time and coach are stamped by the DB';
end $$;
rollback;

-- T50：面談の締め切りはタイムゾーンを変えてもすり抜けられない。副担当は面談を入れられない・主担当以外とは入れられない
begin;
insert into public.coach_open_slots (coach_id, on_date, start_time, end_time) values (:'coach', (now() at time zone 'Asia/Tokyo')::date, '04:00', '04:30');
delete from public.meetings where student_id = :'hina';
insert into public.coach_assignments (coach_id, student_id) values ('a0000000-0000-4000-8000-0000000000c2', :'hina');
set role authenticated;
set request.jwt.claim.sub = :'hina';
update public.profiles set timezone = 'Etc/GMT+12' where id = current_setting('test.hina')::uuid;
do $$
begin
  begin
    perform public.book_meeting((now() at time zone 'Asia/Tokyo')::date, '04:00');
    raise exception 'T50 FAILED: booked today by moving the time zone west';
  exception when invalid_parameter_value then null;
  end;
  begin
    perform public.book_meeting((now() at time zone 'Asia/Tokyo')::date + 2, '04:00', null, 'a0000000-0000-4000-8000-0000000000c2');
    raise exception 'T50 FAILED: booked with a sub coach';
  exception when invalid_parameter_value then null;
  end;
end $$;
set request.jwt.claim.sub = 'a0000000-0000-4000-8000-0000000000c2';
do $$
begin
  begin
    perform public.book_meeting(private.local_today(current_setting('test.hina')::uuid) + 2, '04:00', current_setting('test.hina')::uuid);
    raise exception 'T50 FAILED: sub coach replaced the meeting';
  exception when insufficient_privilege then null;
  end;
  raise notice 'T50 OK: meeting deadline and main coach';
end $$;
reset role;
rollback;

-- T51：退会した生徒は AI 相談を読めない・ひとことを書き換えられない。退会した講師は面談の枠を作れない・面談を読めない
begin;
insert into public.chat_messages (student_id, sender, body) values (:'hina', 'student', 'secret');
set request.jwt.claim.sub = :'admin';
update public.profiles set status = 'withdrawn' where id in (:'hina', :'coach');
set role authenticated;
set request.jwt.claim.sub = :'hina';
do $$
declare n int;
begin
  if (select count(*) from public.chat_messages) <> 0 then raise exception 'T51 FAILED: withdrawn student reads chat'; end if;
  update public.task_feedback set body = 'x' where student_id = current_setting('test.hina')::uuid;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'T51 FAILED: withdrawn student edits feedback'; end if;
end $$;
set request.jwt.claim.sub = :'coach';
do $$
begin
  if (select count(*) from public.meetings) <> 0 then raise exception 'T51 FAILED: withdrawn coach reads meetings'; end if;
  begin
    insert into public.coach_open_slots (coach_id, weekday, start_time, end_time) values (current_setting('test.coach')::uuid, 2, '10:00', '11:00');
    raise exception 'T51 FAILED: withdrawn coach inserts open slots';
  exception when insufficient_privilege then null;
  end;
  raise notice 'T51 OK: withdrawn members are locked out everywhere';
end $$;
reset role;
rollback;

-- T52：予定の15分前の通知は、日付と時刻をつなげて見る（0 時をまたいでも出る）
begin;
select (now() at time zone 'Asia/Tokyo' + interval '10 minutes')::date as d, to_char(now() at time zone 'Asia/Tokyo' + interval '10 minutes', 'HH24:MI') as t \gset
update public.profiles set timezone = null where id = :'hina';
insert into public.tasks (student_id, on_date, start_time, duration_min, vague, title)
  values (:'hina', :'d', :'t', 30, 'mock', '模試の直し') returning id as soon \gset
select public.enqueue_due_notifications() >= 0 as ran \gset
set test.soon = :'soon';
do $$
begin
  if not exists (select 1 from public.notifications where dedupe_key = 'task_start:' || current_setting('test.soon')) then raise exception 'T52 FAILED: no 15-minute notice'; end if;
  raise notice 'T52 OK: 15-minute notice';
end $$;
rollback;

-- T53：生徒と講師・運営の間では役割を変えられない
begin;
set role authenticated;
set request.jwt.claim.sub = :'admin';
do $$
begin
  begin
    update public.profiles set role = 'coach' where id = current_setting('test.misaki')::uuid;
    raise exception 'T53 FAILED: student turned into a coach';
  exception when check_violation then null;
  end;
  begin
    update public.profiles set role = 'student' where id = 'a0000000-0000-4000-8000-0000000000c2';
    raise exception 'T53 FAILED: coach turned into a student';
  exception when check_violation then null;
  end;
  raise notice 'T53 OK: no role change between student and staff';
end $$;
reset role;
rollback;

-- T54：目次は範囲の ID で合わせる。途中の行を消しても、ほかの範囲の記録はずれない。使っている範囲は消せない
begin;
set role authenticated;
set request.jwt.claim.sub = :'admin';
do $$
declare mid uuid; u uuid[]; used uuid; lbl text;
begin
  insert into public.materials (name, short_name, subject, kind) values ('目次テスト', '目次', 'english', 'input') returning id into mid;
  perform public.save_material_units(mid, '[{"label":"A"},{"label":"B"},{"label":"C"}]'::jsonb);
  select array_agg(id order by seq) into u from public.material_units where material_id = mid;
  -- B を消して、C を先頭に、D を足す
  perform public.save_material_units(mid, jsonb_build_array(jsonb_build_object('id', u[3], 'label', 'C'), jsonb_build_object('id', u[1], 'label', 'A2'), jsonb_build_object('label', 'D')));
  if (select string_agg(label, ',' order by seq) from public.material_units where material_id = mid) <> 'C,A2,D' then raise exception 'T54 FAILED: order/labels'; end if;
  select label into lbl from public.material_units where id = u[1];
  if lbl <> 'A2' then raise exception 'T54 FAILED: id did not keep its row'; end if;
  -- 使っている範囲は消せない
  insert into public.tasks (student_id, on_date, start_time, duration_min, material_id, unit_id)
    values (current_setting('test.hina')::uuid, private.local_today(current_setting('test.hina')::uuid) + 3, '05:00', 30, mid, u[3]);
  begin
    perform public.save_material_units(mid, jsonb_build_array(jsonb_build_object('id', u[1], 'label', 'A2')));
    raise exception 'T54 FAILED: removed a used unit';
  exception when foreign_key_violation then null;
  end;
  raise notice 'T54 OK: table of contents is saved by unit id';
end $$;
reset role;
rollback;

\echo 'ALL DB TESTS PASSED'
