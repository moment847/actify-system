-- Actify：DB の中で守る決まりと、生徒が使う操作
--
-- 1. 予定の範囲の順番（モックの resequence）と、小テストの版の自動付与（autoAttach）は、
--    予定が変わるたびにトリガで必ず通す。どこから入れても（画面・API・管理用のSQL）同じ結果になる。
-- 2. 生徒は tasks を直接書き換えられない（RLS）。始める・止める・完了・未完了に戻す は下の関数から。
-- 3. 面談の予約は「前日まで」「講師が公開している時間の中」「その週の1回」を関数の中で確かめる。

-- ---------- 再テストかどうかは、入れた時点で「その範囲を済ませたことがあるか」で決める ----------
create function private.set_retest() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.unit_id is not null and (tg_op = 'INSERT' or new.unit_id is distinct from old.unit_id) then
    new.is_retest := exists (select 1 from public.tasks t
      where t.student_id = new.student_id and t.unit_id = new.unit_id and t.status = 'done' and t.id <> new.id);
  end if;
  if new.unit_id is null then new.is_retest := false; end if;
  -- 小テストの版を付けたら満点も合わせる。付けないなら満点も消す（点数が入っていない予定だけ）
  if new.quiz_version_id is not null and (tg_op = 'INSERT' or new.quiz_version_id is distinct from old.quiz_version_id) then
    select q.max_score into new.max_score from public.quiz_versions q where q.id = new.quiz_version_id;
  elsif new.quiz_version_id is null and new.score is null and new.status = 'todo' then
    new.max_score := null;
  end if;
  if new.no_quiz and new.status = 'todo' then new.quiz_version_id := null; new.max_score := null; end if;
  return new;
end $$;
create trigger set_retest before insert or update on public.tasks for each row execute function private.set_retest();

-- ---------- 範囲の順番をそろえる＋小テストの版を付ける ----------
-- まだやっていない1周目の予定（todo かつ 再テストでない）は、入れた順ではなく日付の順に範囲の番号がそろう。
-- 動いた予定の小テストは付け直す。返り値は、範囲が入れ替わった予定の数。
create function private.normalize_plan(p_student uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  moved int;
begin
  with plan as (
    select t.id, t.material_id, t.unit_id,
           row_number() over (partition by t.material_id order by t.on_date, t.start_time, t.created_at, t.id) as rn
    from public.tasks t
    where t.student_id = p_student and t.status = 'todo' and not t.is_retest and t.unit_id is not null
  ), ordered as (
    select p.material_id, p.unit_id, row_number() over (partition by p.material_id order by u.seq) as rn
    from plan p join public.material_units u on u.id = p.unit_id
  ), moves as (
    select plan.id, ordered.unit_id as new_unit
    from plan join ordered on ordered.material_id = plan.material_id and ordered.rn = plan.rn
    where plan.unit_id <> ordered.unit_id
  )
  update public.tasks t set unit_id = m.new_unit, quiz_version_id = null
  from moves m where t.id = m.id;
  get diagnostics moved = row_count;

  perform private.attach_quizzes(p_student, null);
  return moved;
end $$;

-- 小テストが付いていない予定に、その生徒がまだ使っていない版を付ける（いちばん若い版から）。
-- p_unit を渡すとその範囲だけ（新しい版を登録したとき）。
create function private.attach_quizzes(p_student uuid, p_unit uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  n int;
begin
  update public.tasks t set quiz_version_id = (
      select q.id from public.quiz_versions q
      where q.unit_id = t.unit_id
        and not exists (select 1 from public.tasks o where o.student_id = t.student_id and o.quiz_version_id = q.id and o.id <> t.id)
      order by q.version limit 1)
  where t.status = 'todo' and t.quiz_version_id is null and not t.no_quiz and t.unit_id is not null
    and (p_student is null or t.student_id = p_student)
    and (p_unit is null or t.unit_id = p_unit)
    and exists (select 1 from public.quiz_versions q where q.unit_id = t.unit_id
                and not exists (select 1 from public.tasks o where o.student_id = t.student_id and o.quiz_version_id = q.id and o.id <> t.id));
  get diagnostics n = row_count;
  return n;
end $$;

-- 予定が変わったら、変わった生徒の予定をそろえ直す（自分の更新では再帰しない）
create function private.tasks_changed() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  for sid in
    select student_id from new_rows union select student_id from old_rows
  loop
    perform private.normalize_plan(sid);
  end loop;
  return null;
end $$;

create function private.tasks_inserted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  for sid in select distinct student_id from new_rows loop perform private.normalize_plan(sid); end loop;
  return null;
end $$;

create function private.tasks_deleted() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  if pg_trigger_depth() > 1 then return null; end if;
  for sid in select distinct student_id from old_rows loop perform private.normalize_plan(sid); end loop;
  return null;
end $$;

create trigger normalize_after_insert after insert on public.tasks
  referencing new table as new_rows for each statement execute function private.tasks_inserted();
create trigger normalize_after_update after update on public.tasks
  referencing new table as new_rows old table as old_rows for each statement execute function private.tasks_changed();
create trigger normalize_after_delete after delete on public.tasks
  referencing old table as old_rows for each statement execute function private.tasks_deleted();

-- 新しい版を登録したら、小テストが無くて待っていた予定に付ける
create function private.quiz_versions_added() returns trigger
language plpgsql security definer set search_path = '' as $$
declare u uuid;
begin
  for u in select distinct unit_id from new_rows loop perform private.attach_quizzes(null, u); end loop;
  return null;
end $$;
create trigger attach_after_insert after insert on public.quiz_versions
  referencing new table as new_rows for each statement execute function private.quiz_versions_added();

-- ---------- 生徒の操作：タイマー ----------
create function private.task_for_actor(p_task uuid) returns public.tasks
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  select * into t from public.tasks where id = p_task;
  if t.id is null or not ((t.student_id = auth.uid() and private.my_role() = 'student') or private.can_manage_student(t.student_id)) then
    raise exception '予定が見つかりません' using errcode = 'P0002';
  end if;
  return t;
end $$;

create function public.start_task(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.task_for_actor(p_task);
  if t.status = 'done' then raise exception '完了した予定です' using errcode = '22023'; end if;
  -- ほかに動いているタイマーは止める（1人1つ）
  update public.tasks set started_at = null, paused_at = null, paused_ms = 0
    where student_id = t.student_id and id <> t.id and started_at is not null and status = 'todo';
  update public.tasks set started_at = now(), paused_at = null, paused_ms = 0 where id = t.id;
end $$;

create function public.pause_task(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.task_for_actor(p_task);
  if t.started_at is null or t.paused_at is not null then return; end if;
  update public.tasks set paused_at = now() where id = t.id;
end $$;

create function public.resume_task(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.task_for_actor(p_task);
  if t.paused_at is null then return; end if;
  update public.tasks set paused_ms = paused_ms + (extract(epoch from now() - paused_at) * 1000)::bigint, paused_at = null where id = t.id;
end $$;

create function public.stop_task_timer(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.task_for_actor(p_task);
  update public.tasks set started_at = null, paused_at = null, paused_ms = 0 where id = t.id;
end $$;

-- ---------- 生徒の操作：完了（点数とひとこと） ----------
-- 勉強時間はタイマーの計測（止めていた時間は数えない）。タイマーを使っていなければ予定の時間。
-- 「始める」から5分未満で完了したら押し間違いとみなして予定の時間。上限は予定の3倍。
-- 完了済みの予定に呼ぶと、点数とひとことだけを直す。
create function public.complete_task(p_task uuid, p_score int default null, p_tag public.feedback_tag default null, p_body text default '')
returns void
language plpgsql security definer set search_path = '' as $$
declare
  t public.tasks;
  elapsed_ms bigint;
  minutes int;
  body text := coalesce(trim(p_body), '');
begin
  t := private.task_for_actor(p_task);
  if length(body) > 80 then raise exception 'ひとことは80字までです' using errcode = '22001'; end if;
  if p_score is not null and (t.max_score is null or p_score < 0 or p_score > t.max_score) then
    raise exception '点数は0〜%点で入れてください', coalesce(t.max_score, 0) using errcode = '22023';
  end if;

  if t.status = 'todo' then
    if t.started_at is not null then
      elapsed_ms := (extract(epoch from coalesce(t.paused_at, now()) - t.started_at) * 1000)::bigint - t.paused_ms;
      minutes := greatest(1, round(elapsed_ms / 60000.0)::int);
      minutes := least(minutes, t.duration_min * 3);
      if minutes < 5 then minutes := t.duration_min; end if;
    else
      minutes := t.duration_min;
    end if;
    update public.tasks set status = 'done', done_at = now(), actual_min = minutes,
      started_at = null, paused_at = null, paused_ms = 0,
      score = coalesce(p_score, score)
    where id = t.id;
  else
    update public.tasks set score = p_score where id = t.id and p_score is not null;
  end if;

  -- ひとこと：生徒が書いたときだけ（講師が代わりに完了しても、生徒の声は書かない）
  if t.student_id = auth.uid() then
    if p_tag is null and body = '' then
      delete from public.task_feedback where task_id = t.id;
    else
      insert into public.task_feedback (task_id, student_id, school_id, tag, body)
      values (t.id, t.student_id, t.school_id, p_tag, body)
      on conflict (task_id) do update set tag = excluded.tag, body = excluded.body;
    end if;
  end if;
end $$;

-- 未完了に戻す（点数と勉強時間は消す。ひとことは残す）
create function public.reopen_task(p_task uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  t := private.task_for_actor(p_task);
  if t.status = 'todo' then return; end if;
  update public.tasks set status = 'todo', done_at = null, score = null, actual_min = null where id = t.id;
end $$;

-- 予備時間に、いちばん古いやり残しを入れる（生徒のホームのボタン）
create function public.fill_buffer(p_buffer uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.tasks;
  mv public.tasks;
  today date;
begin
  b := private.task_for_actor(p_buffer);
  if b.vague is distinct from 'buffer' or b.status <> 'todo' then raise exception '予備時間ではありません' using errcode = '22023'; end if;
  today := private.local_today(b.student_id);
  select * into mv from public.tasks
    where student_id = b.student_id and status = 'todo' and on_date < today and id <> b.id
    order by on_date, start_time limit 1;
  if mv.id is null then return null; end if;
  update public.tasks set on_date = b.on_date, start_time = b.start_time where id = mv.id;
  if b.duration_min - mv.duration_min < 10 then
    delete from public.tasks where id = b.id;
  else
    update public.tasks set start_time = b.start_time + mv.duration_min * interval '1 minute', duration_min = b.duration_min - mv.duration_min where id = b.id;
  end if;
  return mv.id;
end $$;

-- ---------- 面談 ----------
-- 生徒が予約できる時間を計算するために、担当講師の予約で埋まっている時間を返す（ほかの生徒の名前は出さない）
create function public.meeting_busy(p_coach uuid, p_from date, p_to date)
returns table (on_date date, start_time time, length_min int, mine boolean)
language sql stable security definer set search_path = '' as $$
  select m.on_date, m.start_time, m.length_min, m.student_id = auth.uid()
  from public.meetings m
  where m.coach_id = p_coach and m.on_date between p_from and p_to
    and (p_coach = auth.uid() or private.is_my_coach(p_coach)
         or (private.is_school_admin() and m.school_id = private.my_school()));
$$;

-- 面談を予約する。同じ週の予約は入れ替える。
-- 生徒：前日まで・講師が受付中・面談できる時間の中だけ。講師と運営：当日でも入れられる（過去は不可）
create function public.book_meeting(p_on_date date, p_start time, p_student uuid default null, p_coach uuid default null)
returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  sid uuid := coalesce(p_student, auth.uid());
  cid uuid;
  is_student boolean;
  len int;
  pub boolean;
  today date;
  wk date := p_on_date - (extract(isodow from p_on_date)::int - 1);
  new_id uuid;
begin
  is_student := sid = auth.uid() and private.my_role() = 'student';
  if not is_student and not private.can_manage_student(sid) then
    raise exception '面談を入れられません' using errcode = '42501';
  end if;
  -- 講師：指定が無ければ、自分（講師が入れるとき）か、生徒の最初の担当
  cid := coalesce(p_coach,
    case when private.my_role() = 'coach' then auth.uid() end,
    (select a.coach_id from public.coach_assignments a where a.student_id = sid order by a.created_at limit 1));
  if cid is null or not exists (select 1 from public.coach_assignments a where a.coach_id = cid and a.student_id = sid) then
    raise exception '担当の講師がいません' using errcode = '22023';
  end if;
  select coalesce(b.length_min, 30), coalesce(b.published, true) into len, pub
    from (select 1) x left join public.booking_settings b on b.coach_id = cid;
  today := private.local_today(sid);

  if is_student then
    if not pub then raise exception '先生が予約の受付を止めています' using errcode = '22023'; end if;
    if p_on_date <= today then raise exception '予約は前日までです' using errcode = '22023'; end if;
    if exists (select 1 from public.meetings m where m.student_id = sid and m.week_start = wk and m.on_date <= today) then
      raise exception 'この週の面談はもう変えられません。先生に連絡してください' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.coach_open_slots o
      where o.coach_id = cid
        and (o.on_date = p_on_date or (o.weekday is not null and o.weekday = extract(isodow from p_on_date)::int - 1))
        and o.start_time <= p_start and o.end_time >= p_start + len * interval '1 minute') then
      raise exception 'その時間は面談できる時間ではありません' using errcode = '22023';
    end if;
  else
    if p_on_date < today then raise exception '過去の日には入れられません' using errcode = '22023'; end if;
  end if;

  delete from public.meetings m where m.student_id = sid and m.week_start = wk and m.on_date >= today;
  insert into public.meetings (school_id, coach_id, student_id, on_date, start_time, length_min, created_by)
  values ((select s.school_id from public.students s where s.id = sid), cid, sid, p_on_date, p_start, len, auth.uid())
  returning id into new_id;
  return new_id;
exception
  when exclusion_violation then raise exception 'その時間はほかの予約が入っています' using errcode = '23P01';
  when unique_violation then raise exception 'この週はもう面談をしています' using errcode = '23505';
end $$;

-- 予約を取り消す。生徒は前日まで、講師と運営は当日まで
create function public.cancel_meeting(p_meeting uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.meetings; today date;
begin
  select * into m from public.meetings where id = p_meeting;
  if m.id is null then raise exception '予約が見つかりません' using errcode = 'P0002'; end if;
  today := private.local_today(m.student_id);
  if m.student_id = auth.uid() and private.my_role() = 'student' then
    if m.on_date <= today then raise exception '前日を過ぎたので、取り消しは先生に連絡してください' using errcode = '22023'; end if;
  elsif private.can_manage_student(m.student_id) then
    if m.on_date < today then raise exception '終わった面談は取り消せません' using errcode = '22023'; end if;
  else
    raise exception '予約が見つかりません' using errcode = 'P0002';
  end if;
  delete from public.meetings where id = m.id;
end $$;

-- ---------- 権限 ----------
-- 生徒・講師が呼ぶ関数は authenticated だけ。未ログインは呼べない
revoke all on function public.start_task(uuid) from public, anon;
revoke all on function public.pause_task(uuid) from public, anon;
revoke all on function public.resume_task(uuid) from public, anon;
revoke all on function public.stop_task_timer(uuid) from public, anon;
revoke all on function public.complete_task(uuid, int, public.feedback_tag, text) from public, anon;
revoke all on function public.reopen_task(uuid) from public, anon;
revoke all on function public.fill_buffer(uuid) from public, anon;
revoke all on function public.meeting_busy(uuid, date, date) from public, anon;
revoke all on function public.book_meeting(date, time, uuid, uuid) from public, anon;
revoke all on function public.cancel_meeting(uuid) from public, anon;
grant execute on function public.start_task(uuid), public.pause_task(uuid), public.resume_task(uuid), public.stop_task_timer(uuid),
  public.complete_task(uuid, int, public.feedback_tag, text), public.reopen_task(uuid), public.fill_buffer(uuid),
  public.meeting_busy(uuid, date, date), public.book_meeting(date, time, uuid, uuid), public.cancel_meeting(uuid)
  to authenticated, service_role;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
