-- レビューで見つかった穴をふさぐ（2026-10-03）
-- 1. ファイルのパスは、その行の塾（チャットの写真は塾と生徒）のフォルダの中だけ。
--    サーバは service_role で期限つきURLを作るので、DB に別の塾のパスが入ると Storage の制限を迂回できてしまう
-- 2. 面談の時間と、まだの学習予定は重ならない（どちらから入れても DB で止める。同じ生徒の操作は順番に処理する）
-- 3. AI の呼び出しに上限（1人1日の回数・同時に1件・塾ごとの月の予算）。呼ぶ前に枠を取り、終わったら原価を書く

-- ---------- 1. パスの所属 ----------
-- 「塾のID/」で始まり、「..」の段を含まない
create function private.path_in(p_path text, p_prefix text) returns boolean
language sql immutable set search_path = '' as $$
  select p_path is not null and left(p_path, length(p_prefix)) = p_prefix and length(p_path) > length(p_prefix)
     and p_path !~ '(^|/)\.\.?(/|$)' and position(chr(92) in p_path) = 0;
$$;

alter table public.resources add constraint resources_path_in_school
  check (private.path_in(file_path, school_id::text || '/'));
alter table public.quiz_versions add constraint quiz_paths_in_school
  check (private.path_in(problem_path, school_id::text || '/') and private.path_in(answer_path, school_id::text || '/'));
alter table public.materials add constraint materials_toc_in_school
  check (toc_image_path is null or private.path_in(toc_image_path, school_id::text || '/'));
alter table public.chat_messages add constraint chat_image_in_own_folder
  check (image_path is null or private.path_in(image_path, school_id::text || '/' || student_id::text || '/'));

-- ---------- 2. 面談とまだの学習予定は重ならない ----------
create function private.minutes(t time) returns int
language sql immutable set search_path = '' as $$ select (extract(epoch from t) / 60)::int $$;

-- 予定を入れる・動かすとき：その生徒の面談と重なったら止める（今日より前の予定は記録なので見ない）
create function private.task_vs_meeting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.meetings;
begin
  if new.status <> 'todo' or new.on_date < private.local_today(new.student_id) then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('actify-plan:' || new.student_id::text, 0));
  select * into m from public.meetings x
    where x.student_id = new.student_id and x.on_date = new.on_date
      and private.minutes(x.start_time) < private.minutes(new.start_time) + new.duration_min
      and private.minutes(x.start_time) + x.length_min > private.minutes(new.start_time)
    limit 1;
  if m.id is not null then
    raise exception '面談の時間（%〜）には学習を入れられません', to_char(m.start_time, 'HH24:MI') using errcode = '23P01';
  end if;
  return new;
end $$;
create trigger task_vs_meeting before insert or update of on_date, start_time, duration_min, status, student_id on public.tasks
  for each row execute function private.task_vs_meeting();

-- 面談を入れる・動かすとき：その生徒のまだの学習予定と重なったら止める
create function private.meeting_vs_task() returns trigger
language plpgsql security definer set search_path = '' as $$
declare t public.tasks;
begin
  if new.on_date < private.local_today(new.student_id) then return new; end if;
  perform pg_advisory_xact_lock(hashtextextended('actify-plan:' || new.student_id::text, 0));
  select * into t from public.tasks x
    where x.student_id = new.student_id and x.status = 'todo' and x.on_date = new.on_date
      and private.minutes(x.start_time) < private.minutes(new.start_time) + new.length_min
      and private.minutes(x.start_time) + x.duration_min > private.minutes(new.start_time)
    limit 1;
  if t.id is not null then
    raise exception 'その時間（%〜）には学習の予定が入っています。先に予定を動かしてください', to_char(t.start_time, 'HH24:MI') using errcode = '23P01';
  end if;
  return new;
end $$;
create trigger meeting_vs_task before insert or update of on_date, start_time, length_min, student_id on public.meetings
  for each row execute function private.meeting_vs_task();

-- book_meeting の重なりのエラーを、どちらの理由か分かる文で返す（面談どうし／学習の予定）
create or replace function public.book_meeting(p_on_date date, p_start time, p_student uuid default null, p_coach uuid default null)
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
        and private.minutes(o.start_time) <= private.minutes(p_start)
        and private.minutes(o.end_time) >= private.minutes(p_start) + len) then
      raise exception 'その時間は面談できる時間ではありません' using errcode = '22023';
    end if;
  else
    if p_on_date < today then raise exception '過去の日には入れられません' using errcode = '22023'; end if;
  end if;

  delete from public.meetings m where m.student_id = sid and m.week_start = wk and m.on_date >= today;
  begin
    insert into public.meetings (school_id, coach_id, student_id, on_date, start_time, length_min, created_by)
    values ((select s.school_id from public.students s where s.id = sid), cid, sid, p_on_date, p_start, len, auth.uid())
    returning id into new_id;
  exception
    when exclusion_violation then
      -- 学習の予定と重なった（トリガ）なら、その文をそのまま返す。講師の面談どうしの重なりなら一般的な文
      if sqlerrm like '%学習の予定%' then raise; end if;
      raise exception 'その時間はほかの予約が入っています' using errcode = '23P01';
    when unique_violation then raise exception 'この週はもう面談をしています' using errcode = '23505';
  end;
  return new_id;
end $$;
revoke all on function public.book_meeting(date, time, uuid, uuid) from public, anon;
grant execute on function public.book_meeting(date, time, uuid, uuid) to authenticated, service_role;

-- ---------- 3. AI の上限 ----------
alter table public.schools
  add column ai_monthly_budget_jpy int not null default 5000 check (ai_monthly_budget_jpy >= 0),
  add column ai_daily_limit_per_user int not null default 30 check (ai_daily_limit_per_user >= 0);
alter table public.ai_calls
  add column status text not null default 'done' check (status in ('pending', 'done'));
create index ai_calls_user_idx on public.ai_calls (user_id, created_at desc);

-- 呼ぶ前に枠を取る。取れなければ理由のコードで止める（AI_BUSY / AI_DAILY_LIMIT / AI_BUDGET）。
-- 塾ごとに順番に処理するので、同時に送っても上限を超えない。service_role だけが呼べる
create function public.ai_reserve(p_school uuid, p_user uuid, p_purpose text, p_estimate_jpy int)
returns bigint
language plpgsql security definer set search_path = '' as $$
declare
  s public.schools;
  tz_now timestamp;
  n int;
  spent int;
  new_id bigint;
begin
  perform pg_advisory_xact_lock(hashtextextended('actify-ai:' || p_school::text, 0));
  select * into s from public.schools where id = p_school;
  if s.id is null then raise exception 'AI_SCHOOL' using errcode = 'P0001'; end if;
  tz_now := now() at time zone s.timezone;
  -- 同じ人の呼び出しが動いている間は、次を受けない（2分たったものは止まったとみなす）
  if exists (select 1 from public.ai_calls c where c.user_id = p_user and c.status = 'pending' and c.created_at > now() - interval '2 minutes') then
    raise exception 'AI_BUSY' using errcode = 'P0001';
  end if;
  select count(*) into n from public.ai_calls c
    where c.user_id = p_user and (c.created_at at time zone s.timezone)::date = tz_now::date;
  if n >= s.ai_daily_limit_per_user then raise exception 'AI_DAILY_LIMIT' using errcode = 'P0001'; end if;
  select coalesce(sum(c.cost_jpy), 0) into spent from public.ai_calls c
    where c.school_id = p_school and date_trunc('month', c.created_at at time zone s.timezone) = date_trunc('month', tz_now);
  if spent + greatest(p_estimate_jpy, 0) > s.ai_monthly_budget_jpy then raise exception 'AI_BUDGET' using errcode = 'P0001'; end if;
  insert into public.ai_calls (school_id, user_id, purpose, model, prompt_version, cost_jpy, status)
  values (p_school, p_user, p_purpose, '', '', greatest(p_estimate_jpy, 0), 'pending') returning id into new_id;
  return new_id;
end $$;

-- 終わったら、実際のモデル・トークン・原価を書く
create function public.ai_settle(p_id bigint, p_model text, p_prompt_version text, p_input_tokens int, p_output_tokens int, p_cost_jpy int, p_error text)
returns void
language sql security definer set search_path = '' as $$
  update public.ai_calls set model = p_model, prompt_version = p_prompt_version, input_tokens = greatest(p_input_tokens, 0),
    output_tokens = greatest(p_output_tokens, 0), cost_jpy = greatest(p_cost_jpy, 0), error = p_error, status = 'done'
  where id = p_id;
$$;

revoke all on function public.ai_reserve(uuid, uuid, text, int) from public, anon, authenticated;
revoke all on function public.ai_settle(bigint, text, text, int, int, int, text) from public, anon, authenticated;
grant execute on function public.ai_reserve(uuid, uuid, text, int), public.ai_settle(bigint, text, text, int, int, int, text) to service_role;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
