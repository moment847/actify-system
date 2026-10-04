-- 自分で洗い直して見つけた穴（2026-10-04）
-- 1. 塾の運営が、自分の塾の AI の上限（月の予算・1日の回数）を自由に書き換えられた。上限はサービス側（service_role）だけが変える
-- 2. タイムゾーンに変な文字列を入れると、その人の操作がすべて落ちる（local_today が例外）。入れるときに確かめる
-- 3. 終わった予定（記録）の日付・時刻・長さ・範囲を講師が書き換えられた。モックでも動かせない。点数・ひとことだけ直せる
-- 4. 小テストの版の番号をアプリが数えていた。同時に登録すると重なるので、DB が付ける（範囲ごとに順番に）
-- 5. 範囲の並べ直し（normalize_plan）が、3つ以上の入れ替えで「1つの範囲に todo は1件」の制約に当たりうる。文の終わりで確かめる
-- 6. 返信の講師（coach_id）・作った人（created_by）を、送った値ではなくログインしている人にする

-- ---------- 1. AI の上限は service_role だけ ----------
create function private.guard_school() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null and (new.ai_monthly_budget_jpy is distinct from old.ai_monthly_budget_jpy
                                 or new.ai_daily_limit_per_user is distinct from old.ai_daily_limit_per_user) then
    raise exception 'AI の上限は、サービスの運営だけが変えられます' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_school before update on public.schools for each row execute function private.guard_school();

-- ---------- 2. タイムゾーンの確かめ ----------
create function private.check_timezone() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.timezone is not null then
    begin
      perform now() at time zone new.timezone;
    exception when others then
      raise exception 'タイムゾーンの名前が正しくありません（例：Asia/Tokyo）' using errcode = '22023';
    end;
  end if;
  return new;
end $$;
create trigger check_timezone before insert or update of timezone on public.profiles for each row execute function private.check_timezone();
create trigger check_timezone before insert or update of timezone on public.schools for each row execute function private.check_timezone();

-- ---------- 3. 終わった予定は動かせない（点数・勉強時間・ひとことは直せる） ----------
create function private.guard_done_task() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status = 'done' and new.status = 'done' and (
       new.on_date is distinct from old.on_date or new.start_time is distinct from old.start_time
    or new.duration_min is distinct from old.duration_min or new.unit_id is distinct from old.unit_id
    or new.material_id is distinct from old.material_id or new.quiz_version_id is distinct from old.quiz_version_id
    or new.student_id is distinct from old.student_id) then
    raise exception '終わった予定は動かせません。直すなら、いちど未完了に戻してください' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger guard_done_task before update on public.tasks for each row execute function private.guard_done_task();

-- ---------- 4. 版の番号は DB が付ける ----------
create function private.number_quiz_version() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.version is null then
    perform pg_advisory_xact_lock(hashtextextended('actify-quiz:' || new.unit_id::text, 0));
    select coalesce(max(q.version), 0) + 1 into new.version from public.quiz_versions q where q.unit_id = new.unit_id;
  end if;
  return new;
end $$;
-- 塾を入れるトリガ（fill_school）より後に動くように、名前の順で後ろにする
create trigger zz_number_version before insert on public.quiz_versions for each row execute function private.number_quiz_version();

-- ---------- 5. 並べ直しは、文の終わりで制約を確かめる ----------
create or replace function private.normalize_plan(p_student uuid) returns int
language plpgsql security definer set search_path = '' as $$
declare
  moved int;
begin
  set constraints public.tasks_one_todo_per_unit deferred;
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

-- ---------- 6. 誰が書いたかは、ログインしている人 ----------
create function private.stamp_actor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;   -- service_role・seed はそのまま
  if tg_table_name = 'task_replies' then new.coach_id := auth.uid();
  else new.created_by := auth.uid();
  end if;
  return new;
end $$;
create trigger stamp_actor before insert on public.task_replies for each row execute function private.stamp_actor();
create trigger stamp_actor before insert on public.tasks for each row execute function private.stamp_actor();
create trigger stamp_actor before insert on public.study_slots for each row execute function private.stamp_actor();
create trigger stamp_actor before insert on public.quiz_versions for each row execute function private.stamp_actor();
create trigger stamp_actor before insert on public.resources for each row execute function private.stamp_actor();
create trigger stamp_actor before insert on public.meetings for each row execute function private.stamp_actor();

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
