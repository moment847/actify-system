-- Actify：2026-10-10 の点検で見つけた DB の誤り
--
-- 1. 主担当の講師を退会にすると、その生徒に主担当がいなくなった（keep_main_coach がトリガの中から呼ばれると何もしなかった）
-- 2. 終わった予定（記録）を直接消せた（動かすのは止めていたが、消すのは止めていなかった。消すと同じ版の小テストをもう一度付けられる）
-- 3. 予備時間に「やり残し」を入れるとき、過去の使われなかった予備時間・時間だけの予定まで入れていた
-- 4. 返信の時刻と講師を、送った値で書けた（運営の「返信の速さ」を本人が操作できた）
-- 5. 面談の締め切り（前日まで）を、生徒が自分のタイムゾーンを西に変えてすり抜けられた。面談は主担当と（副担当の予約が主担当の予約を消していた）
-- 6. 退会・休会の人が、役割を見ないポリシーでいくつかの行を読み書きできた（AI 相談・ひとこと・面談・講師の面談の枠・チャットの写真）
-- 7. 時刻で決まる通知が 0 時をまたぐと外れていた（23:50 の15分後が 00:05 になり、23:46〜23:59 の予定に通知が出ない。0 時をまたぐ予定を終わったとみなす）
-- 8. 面談の取り消しの通知が、UTC の日付で「もう終わった面談か」を見ていた
-- 9. 端末への通知：「通知しない時間」で待たせた通知が毎回先頭に来て、ほかの人の通知が送れなくなった。送れなかった通知を送り直さなかった
-- 10. Stripe の知らせ：処理の途中で関数が切られると「処理済み」のまま残り、Stripe の再送を捨てていた
-- 11. 役割の変更：生徒 ⇔ 講師・運営 を変えると、生徒の行（students）が無い生徒・生徒の行が残った講師ができた
-- 12. 目次を直すと、途中の行を消したときに後ろの範囲の記録が別の章にずれた（行の位置で合わせていた）

-- ---------- 1. 主担当はいつも1人 ----------
create or replace function private.keep_main_coach() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sid uuid := coalesce(new.student_id, old.student_id);
begin
  -- 以前は pg_trigger_depth() > 1 で抜けていた。退会（on_profile_withdrawn）や、アカウントを消したときの連鎖の削除では
  -- このトリガが2段目で動くので、主担当が外れたまま残った。このトリガは insert / delete でしか動かず、中の update で自分は呼ばれない
  if not exists (select 1 from public.coach_assignments a where a.student_id = sid and a.is_main) then
    update public.coach_assignments a set is_main = true
      where (a.coach_id, a.student_id) = (select b.coach_id, b.student_id from public.coach_assignments b where b.student_id = sid order by b.created_at, b.coach_id limit 1);
  end if;
  return null;
end $$;
-- いま主担当のいない生徒を直す
update public.coach_assignments a set is_main = true
  where (a.coach_id, a.student_id) in (
    select distinct on (b.student_id) b.coach_id, b.student_id from public.coach_assignments b
    where not exists (select 1 from public.coach_assignments c where c.student_id = b.student_id and c.is_main)
    order by b.student_id, b.created_at, b.coach_id);

-- ---------- 2. 終わった予定は消せない ----------
create function private.guard_done_task_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- 直接の削除だけを止める（生徒のアカウントを消したときの連鎖の削除は通す。連鎖はトリガの中なので深さが 2 以上）
  if old.status = 'done' and auth.uid() is not null and pg_trigger_depth() = 1 then
    raise exception '終わった予定は消せません。直すなら、いちど未完了に戻してください' using errcode = '23514';
  end if;
  return old;
end $$;
create trigger guard_done_task_delete before delete on public.tasks for each row execute function private.guard_done_task_delete();

-- ---------- 3. 予備時間に入れるのは、範囲のあるやり残しだけ ----------
create or replace function public.fill_buffer(p_buffer uuid) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  b public.tasks;
  mv public.tasks;
  today date;
begin
  b := private.task_for_actor(p_buffer);
  if b.vague is distinct from 'buffer' or b.status <> 'todo' then raise exception '予備時間ではありません' using errcode = '22023'; end if;
  today := private.local_today(b.student_id);
  -- 時間だけの予定（予備時間・模試の直しなど）はやり残しに数えない（画面の候補と同じ。plan.ts は unitId のある予定だけを出す）
  select * into mv from public.tasks
    where student_id = b.student_id and status = 'todo' and on_date < today and id <> b.id and unit_id is not null
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

-- ---------- 4. 返信・ひとことの時刻と書いた人は DB が決める ----------
create or replace function private.stamp_actor() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;   -- service_role・seed はそのまま
  if tg_table_name = 'task_replies' then
    if tg_op = 'INSERT' then new.coach_id := auth.uid(); new.created_at := now();
    else new.coach_id := old.coach_id; new.created_at := old.created_at;   -- 書き直しても「いつ・誰が返信したか」は変えない
    end if;
  elsif tg_table_name = 'task_feedback' then
    if tg_op = 'INSERT' then new.created_at := now(); else new.created_at := old.created_at; end if;
  else new.created_by := auth.uid();
  end if;
  return new;
end $$;
drop trigger stamp_actor on public.task_replies;
create trigger stamp_actor before insert or update on public.task_replies for each row execute function private.stamp_actor();
create trigger stamp_actor before insert or update on public.task_feedback for each row execute function private.stamp_actor();

-- ---------- 5. 面談：主担当と・締め切りは塾の暦でも確かめる ----------
-- 「今日」は生徒のタイムゾーンと塾のタイムゾーンの遅い方。生徒は自分のタイムゾーンを変えられる（留学など）ので、
-- 西に変えて「今日」を前日に戻し、当日の予約・取り消しをすり抜けられた。遅い方を使えば、変えても締め切りは早まるだけ
create function private.deadline_today(p_student uuid) returns date
language sql stable security definer set search_path = '' as $$
  select greatest((now() at time zone coalesce(p.timezone, s.timezone))::date, (now() at time zone s.timezone)::date)
  from public.profiles p join public.schools s on s.id = p.school_id where p.id = p_student;
$$;

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
  -- 面談は主担当と（README）。以前は副担当が予約すると、主担当の面談を消して副担当の面談に置き換えていた
  select a.coach_id into cid from public.coach_assignments a where a.student_id = sid and a.is_main;
  if cid is null then raise exception '担当の講師がいません' using errcode = '22023'; end if;
  if p_coach is not null and p_coach <> cid then
    raise exception '面談は主担当の講師と入れます' using errcode = '22023';
  end if;
  -- 副担当は面談を入れ直せない（主担当の面談を消してしまう）。運営と主担当だけ
  if not is_student and private.my_role() = 'coach' and auth.uid() <> cid then
    raise exception '面談は主担当の講師が入れます' using errcode = '42501';
  end if;
  select coalesce(b.length_min, 30), coalesce(b.published, true) into len, pub
    from (select 1) x left join public.booking_settings b on b.coach_id = cid;

  if is_student then
    today := private.deadline_today(sid);
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
    today := private.local_today(sid);
    if p_on_date < today then raise exception '過去の日には入れられません' using errcode = '22023'; end if;
  end if;

  delete from public.meetings m where m.student_id = sid and m.week_start = wk and m.on_date >= today;
  begin
    insert into public.meetings (school_id, coach_id, student_id, on_date, start_time, length_min, created_by)
    values ((select s.school_id from public.students s where s.id = sid), cid, sid, p_on_date, p_start, len, auth.uid())
    returning id into new_id;
  exception
    when exclusion_violation then
      if sqlerrm like '%学習の予定%' then raise; end if;
      raise exception 'その時間はほかの予約が入っています' using errcode = '23P01';
    when unique_violation then raise exception 'この週はもう面談をしています' using errcode = '23505';
  end;
  return new_id;
end $$;

create or replace function public.cancel_meeting(p_meeting uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare m public.meetings;
begin
  select * into m from public.meetings where id = p_meeting;
  if m.id is null then raise exception '予約が見つかりません' using errcode = 'P0002'; end if;
  if m.student_id = auth.uid() and private.my_role() = 'student' then
    if m.on_date <= private.deadline_today(m.student_id) then raise exception '前日を過ぎたので、取り消しは先生に連絡してください' using errcode = '22023'; end if;
  elsif private.can_manage_student(m.student_id) then
    if m.on_date < private.local_today(m.student_id) then raise exception '終わった面談は取り消せません' using errcode = '22023'; end if;
  else
    raise exception '予約が見つかりません' using errcode = 'P0002';
  end if;
  delete from public.meetings where id = m.id;
end $$;

-- ---------- 6. 退会・休会の人は、役割を見ないポリシーでも読めない・書けない ----------
alter policy "chat_messages select" on public.chat_messages
  using (student_id = (select auth.uid()) and (select private.my_role()) = 'student');
alter policy "task_feedback update" on public.task_feedback
  using (student_id = (select auth.uid()) and (select private.my_role()) = 'student')
  with check (student_id = (select auth.uid()) and (select private.my_role()) = 'student');
alter policy "task_feedback delete" on public.task_feedback
  using (student_id = (select auth.uid()) and (select private.my_role()) = 'student');
alter policy "meetings select" on public.meetings
  using (((student_id = (select auth.uid()) or coach_id = (select auth.uid())) and (select private.my_role()) is not null)
      or private.can_manage_student(student_id));
alter policy "coach_open_slots insert" on public.coach_open_slots
  with check ((coach_id = (select auth.uid()) and (select private.my_role()) = 'coach') or ((select private.is_school_admin()) and school_id = (select private.my_school())));
alter policy "coach_open_slots update" on public.coach_open_slots
  using ((coach_id = (select auth.uid()) and (select private.my_role()) = 'coach') or ((select private.is_school_admin()) and school_id = (select private.my_school())))
  with check ((coach_id = (select auth.uid()) and (select private.my_role()) = 'coach') or ((select private.is_school_admin()) and school_id = (select private.my_school())));
alter policy "coach_open_slots delete" on public.coach_open_slots
  using ((coach_id = (select auth.uid()) and (select private.my_role()) = 'coach') or ((select private.is_school_admin()) and school_id = (select private.my_school())));
alter policy "coach_open_slots select" on public.coach_open_slots
  using ((coach_id = (select auth.uid()) and (select private.my_role()) is not null) or private.is_my_coach(coach_id)
      or ((select private.is_school_admin()) and school_id = (select private.my_school())));
alter policy "booking_settings insert" on public.booking_settings
  with check ((coach_id = (select auth.uid()) and (select private.my_role()) = 'coach') or ((select private.is_school_admin()) and school_id = (select private.my_school())));
alter policy "booking_settings update" on public.booking_settings
  using ((coach_id = (select auth.uid()) and (select private.my_role()) = 'coach') or ((select private.is_school_admin()) and school_id = (select private.my_school())))
  with check ((coach_id = (select auth.uid()) and (select private.my_role()) = 'coach') or ((select private.is_school_admin()) and school_id = (select private.my_school())));
alter policy "booking_settings select" on public.booking_settings
  using ((coach_id = (select auth.uid()) and (select private.my_role()) is not null) or private.is_my_coach(coach_id)
      or ((select private.is_school_admin()) and school_id = (select private.my_school())));
alter policy "actify objects select" on storage.objects
  using (
    ((bucket_id in ('quiz-pdfs', 'resources', 'toc-images'))
      and (storage.foldername(name))[1] = (select private.my_school())::text
      and (select private.is_staff()))
    or (bucket_id = 'chat-images'
      and (storage.foldername(name))[1] = (select private.my_school())::text
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and (select private.my_role()) = 'student')
  );

-- ---------- 7. 時刻で決まる通知は、日付と時刻をつなげて比べる ----------
create or replace function public.enqueue_due_notifications() returns int
language plpgsql security definer set search_path = '' as $$
declare n0 bigint; n1 bigint;
begin
  select count(*) into n0 from public.notifications;
  -- 予定の15分前（予備時間は除く）。0 時をまたいでも外れないように、日付＋時刻で比べる
  perform private.notify(t.student_id, 'task_start', to_char(t.start_time, 'HH24:MI') || 'から ' || coalesce(t.title, m.short_name || ' ' || u.label),
      t.duration_min || '分 · タイマーを始めると、勉強時間が記録されます', '/student', 'task_start:' || t.id)
    from public.tasks t
    join public.profiles p on p.id = t.student_id
    join public.schools s on s.id = t.school_id
    cross join lateral (select now() at time zone coalesce(p.timezone, s.timezone) as ln) x
    left join public.materials m on m.id = t.material_id left join public.material_units u on u.id = t.unit_id
    where t.status = 'todo' and t.vague is distinct from 'buffer' and t.started_at is null
      and t.on_date between x.ln::date and x.ln::date + 1
      and t.on_date + t.start_time > x.ln
      and t.on_date + t.start_time <= x.ln + interval '15 minutes';
  -- 21:30 を過ぎて、今日の終わった予定に記録がない（1日1回）。0 時をまたぐ予定は、まだ終わっていない
  perform private.notify(y.student_id, 'missed_record', '今日の記録がまだの予定が' || y.n || '件あります', 'やった予定は完了に、できなかった予定はそのままで大丈夫です', '/student', 'missed:' || y.student_id || ':' || y.d)
    from (
      select t.student_id, x.ln::date as d, count(*) as n
      from public.tasks t join public.profiles p on p.id = t.student_id join public.schools s on s.id = t.school_id
      cross join lateral (select now() at time zone coalesce(p.timezone, s.timezone) as ln) x
      where t.status = 'todo' and t.vague is distinct from 'buffer'
        and x.ln::time >= time '21:30'
        and t.on_date = x.ln::date
        and t.on_date + t.start_time + t.duration_min * interval '1 minute' <= x.ln
      group by 1, 2) y;
  -- 19:00 を過ぎて、明日が面談（生徒と講師の両方）
  perform private.notify(who.uid, 'meeting_tomorrow', '明日 ' || to_char(mt.start_time, 'HH24:MI') || 'から面談です', who.body, who.url, 'meet_tmr:' || mt.id || ':' || who.uid)
    from public.meetings mt
    join public.profiles ps on ps.id = mt.student_id
    join public.schools s on s.id = mt.school_id
    cross join lateral (values
      (mt.student_id, '先生と' || mt.length_min || '分。今週うまくいったこと・困ったことを1つずつ考えておくと話しやすいです', '/student/schedule'),
      (mt.coach_id, ps.display_name || 'さんと' || mt.length_min || '分', '/coach/meet')) who(uid, body, url)
    where (now() at time zone coalesce(ps.timezone, s.timezone))::time >= time '19:00'
      and mt.on_date = (now() at time zone coalesce(ps.timezone, s.timezone))::date + 1;
  select count(*) into n1 from public.notifications;
  return n1 - n0;
end $$;

-- ---------- 8. 面談の取り消しの通知は、生徒の暦で「まだ先の面談」だけ ----------
create or replace function private.notify_meeting() returns trigger
language plpgsql security definer set search_path = '' as $$
declare m public.meetings := coalesce(new, old); who text; whenr text;
begin
  whenr := to_char(m.on_date, 'FMMM/FMDD') || ' ' || to_char(m.start_time, 'HH24:MI');
  if tg_op = 'INSERT' then
    if auth.uid() is distinct from m.student_id then
      perform private.notify(m.student_id, 'meeting_booked', '面談が入りました', whenr || '（' || m.length_min || '分）', '/student/schedule', 'meet:' || m.id || ':s');
    end if;
    if auth.uid() is distinct from m.coach_id then
      select p.display_name into who from public.profiles p where p.id = m.student_id;
      perform private.notify(m.coach_id, 'meeting_booked', coalesce(who, '生徒') || 'さんが面談を予約しました', whenr, '/coach/meet', 'meet:' || m.id || ':c');
    end if;
  elsif tg_op = 'DELETE' and m.on_date >= private.local_today(m.student_id) then
    if exists (select 1 from public.meetings x where x.student_id = m.student_id and x.week_start = m.week_start) then return null; end if;
    if auth.uid() is distinct from m.student_id then
      perform private.notify(m.student_id, 'meeting_cancelled', '面談が取り消されました', whenr, '/student/schedule', 'meetx:' || m.id || ':s');
    end if;
    if auth.uid() is distinct from m.coach_id then
      select p.display_name into who from public.profiles p where p.id = m.student_id;
      perform private.notify(m.coach_id, 'meeting_cancelled', coalesce(who, '生徒') || 'さんの面談が取り消されました', whenr, '/coach/meet', 'meetx:' || m.id || ':c');
    end if;
  end if;
  return null;
end $$;

-- ---------- 9. 端末への通知：待たせる・送り直す ----------
alter table public.notifications
  add column push_after timestamptz,                               -- この時刻までは端末に送らない（通知しない時間・送り直しの間隔）
  add column push_attempts smallint not null default 0;            -- 送れなかった回数（3回で諦める）
drop index public.notifications_unpushed_idx;
create index notifications_unpushed_idx on public.notifications (coalesce(push_after, created_at)) where pushed_at is null;
create or replace function private.guard_notification() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.id, new.school_id, new.user_id, new.kind, new.title, new.body, new.url, new.dedupe_key, new.created_at, new.pushed_at, new.push_after, new.push_attempts)
     is distinct from (old.id, old.school_id, old.user_id, old.kind, old.title, old.body, old.url, old.dedupe_key, old.created_at, old.pushed_at, old.push_after, old.push_attempts) then
    raise exception '通知は「読んだ」にすることだけできます' using errcode = '42501';
  end if;
  return new;
end $$;

-- ---------- 10. Stripe の知らせは「処理し終えた」印で二度処理を防ぐ ----------
alter table public.billing_events add column processed_at timestamptz;
update public.billing_events set processed_at = received_at;

-- ---------- 11. 生徒と講師・運営の間では役割を変えない ----------
create or replace function private.guard_profile() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;            -- service_role・管理用のSQL
  if new.school_id is distinct from old.school_id then
    raise exception '所属する塾は変えられません' using errcode = '42501';
  end if;
  if (new.role is distinct from old.role or new.status is distinct from old.status)
     and not (private.is_school_admin() and old.id <> auth.uid()) then
    raise exception '役割と状態は運営だけが変えられます' using errcode = '42501';
  end if;
  -- 生徒には生徒の行（students）があり、講師・運営には無い。生徒 ⇔ 講師・運営 を変えると片方だけが残るので、新しいアカウントを作る
  if new.role is distinct from old.role and (old.role = 'student' or new.role = 'student') then
    raise exception '生徒と講師・運営の間では役割を変えられません。新しいアカウントを作ってください' using errcode = '23514';
  end if;
  if new.role is distinct from old.role and old.role = 'coach' and exists (select 1 from public.coach_assignments a where a.coach_id = old.id) then
    raise exception '担当のある講師の役割は変えられません。先に担当を外してください' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;

-- ---------- 12. 目次を直すときは、行の位置ではなく範囲の ID で合わせる ----------
-- 以前はアプリが「i 行目 → i 番目の範囲」で名前を書き換えていた。途中の行を1つ消すと、後ろの範囲の名前が1つずつずれ、
-- その範囲の予定・小テスト・再テストの記録が別の章を指すようになった（使っていない最後の範囲だけが消えた）。
-- p_units：[{ "id": 既存の範囲の ID（新しい行は無し）, "label": 名前 }, …] を新しい順番で。名前を変えても ID が同じなら記録はそのまま
create function public.save_material_units(p_material uuid, p_units jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  m public.materials;
  n int := coalesce(jsonb_array_length(p_units), 0);
begin
  select * into m from public.materials where id = p_material;
  if m.id is null or not (private.is_school_admin() and m.school_id = private.my_school()) then
    raise exception '教材が見つかりません' using errcode = '42501';
  end if;
  if n < 1 or n > 500 then raise exception '範囲は1〜500行で入れてください' using errcode = '22023'; end if;
  if exists (select 1 from jsonb_array_elements(p_units) e where length(trim(coalesce(e->>'label', ''))) not between 1 and 120) then
    raise exception '範囲の名前は1〜120文字で入れてください' using errcode = '22023';
  end if;
  if exists (select 1 from jsonb_array_elements(p_units) e where e->>'id' is not null
       and not exists (select 1 from public.material_units u where u.id = (e->>'id')::uuid and u.material_id = p_material))
     or (select count(*) from jsonb_array_elements(p_units) e where e->>'id' is not null)
        <> (select count(distinct e->>'id') from jsonb_array_elements(p_units) e where e->>'id' is not null) then
    raise exception '範囲が見つかりません。画面を読み直してください' using errcode = '22023';
  end if;
  begin
    delete from public.material_units u where u.material_id = p_material
      and u.id not in (select (e->>'id')::uuid from jsonb_array_elements(p_units) e where e->>'id' is not null);
  exception when foreign_key_violation then
    raise exception '予定や小テストで使っている範囲は、行を消せません（名前と順番は直せます）' using errcode = '23503';
  end;
  set constraints public.material_units_material_id_seq_key deferred;
  update public.material_units u set seq = x.ord, label = trim(x.label)
    from (select (e->>'id')::uuid as id, e->>'label' as label, ord::int from jsonb_array_elements(p_units) with ordinality t(e, ord)) x
    where u.id = x.id and x.id is not null;
  insert into public.material_units (school_id, material_id, seq, label)
    select m.school_id, p_material, ord::int, trim(e->>'label') from jsonb_array_elements(p_units) with ordinality t(e, ord) where e->>'id' is null;
end $$;
revoke all on function public.save_material_units(uuid, jsonb) from public, anon;
grant execute on function public.save_material_units(uuid, jsonb) to authenticated, service_role;

revoke all on function private.deadline_today(uuid), private.guard_done_task_delete() from public, anon;
grant execute on function private.deadline_today(uuid), private.guard_done_task_delete() to authenticated, service_role;
