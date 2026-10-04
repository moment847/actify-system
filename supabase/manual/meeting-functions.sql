-- Actify：Supabase の SQL Editor に貼って Run する（プロジェクト actify / bbhqujcjohpjhwghoudf）
-- 中身は supabase/migrations の面談の予約（book_meeting・レビュー後の版）と取り消し（cancel_meeting）。
-- 「面談テーブルから行を消す」文を含むため、接続ツールからは承認待ちで止まり、手で流す必要がある。何度流しても同じ結果になる。

-- 予約を取り消す。生徒は前日まで、講師と運営は当日まで
create or replace function public.cancel_meeting(p_meeting uuid) returns void
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
revoke all on function public.cancel_meeting(uuid) from public, anon;
grant execute on function public.cancel_meeting(uuid) to authenticated, service_role;

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

-- 確認：2行出れば完了
select proname from pg_proc where pronamespace = 'public'::regnamespace and proname in ('book_meeting', 'cancel_meeting');
