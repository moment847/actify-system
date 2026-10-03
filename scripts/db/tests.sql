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
  if (select count(*) from public.profiles) <> 2 then raise exception 'T5 FAILED: profiles % (self + coach expected)', (select count(*) from public.profiles); end if;
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
  if (select count(*) from public.profiles) <> 7 then raise exception 'T21 FAILED: admin profiles %', (select count(*) from public.profiles); end if;
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

\echo 'ALL DB TESTS PASSED'
