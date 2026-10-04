-- Actify：保護者のLINE・模試と過去問・通知・主担当と副担当・塾の契約（2026-10-05）
--
-- 1. 主担当と副担当：1人の生徒を複数の講師で持つ。面談の予約は主担当と（主担当はいつも1人）
-- 2. 保護者：LINE で週の報告を受け取る人。アプリのアカウントは持たない（塾の LINE 公式アカウントと友だちになり、合言葉を送ってつなぐ）
-- 3. 模試・過去問の成績：生徒本人も講師も入れられる
-- 4. 通知：アプリの中の通知と、端末への通知（Web Push）。出来事（返信・面談）はトリガで、時刻で決まるものは定期の処理で入れる
-- 5. 塾の契約（Stripe）：書くのはサーバ（service_role）だけ。塾の運営は見るだけ

-- ---------- 1. 主担当と副担当 ----------
alter table public.coach_assignments add column is_main boolean not null default false;
update public.coach_assignments a set is_main = true
  where (a.coach_id, a.student_id) in (select distinct on (student_id) coach_id, student_id from public.coach_assignments order by student_id, created_at, coach_id);
create unique index coach_assignments_one_main on public.coach_assignments (student_id) where is_main;

-- 最初の担当は主担当にする。主担当を外したら、いちばん古い担当を主担当にする
create function private.keep_main_coach() returns trigger
language plpgsql security definer set search_path = '' as $$
declare sid uuid := coalesce(new.student_id, old.student_id);
begin
  if pg_trigger_depth() > 1 then return null; end if;
  if not exists (select 1 from public.coach_assignments a where a.student_id = sid and a.is_main) then
    update public.coach_assignments a set is_main = true
      where (a.coach_id, a.student_id) = (select b.coach_id, b.student_id from public.coach_assignments b where b.student_id = sid order by b.created_at, b.coach_id limit 1);
  end if;
  return null;
end $$;
-- 入れたとき・外したときだけ（主担当の付け替えは set_main_coach が1つの処理で行う）
create trigger keep_main after insert or delete on public.coach_assignments
  for each row execute function private.keep_main_coach();

-- 主担当を替える（同じ生徒のほかの担当は副担当にする）。運営だけ
create function public.set_main_coach(p_student uuid, p_coach uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not (private.is_school_admin() and exists (select 1 from public.students s where s.id = p_student and s.school_id = private.my_school())) then
    raise exception '主担当を替えられるのは運営だけです' using errcode = '42501';
  end if;
  if not exists (select 1 from public.coach_assignments a where a.student_id = p_student and a.coach_id = p_coach) then
    raise exception 'その講師は担当ではありません' using errcode = '22023';
  end if;
  update public.coach_assignments set is_main = false where student_id = p_student and is_main and coach_id <> p_coach;
  update public.coach_assignments set is_main = true where student_id = p_student and coach_id = p_coach;
end $$;

-- ---------- 2. 保護者と LINE ----------
-- 塾の LINE 公式アカウントの、友だち追加に使う ID（@xxxx）。秘密ではないので塾の行に持つ
alter table public.schools add column line_basic_id text check (line_basic_id is null or line_basic_id ~ '^@[a-z0-9._-]{2,30}$');

-- LINE の鍵（チャネルシークレット・アクセストークン）。アプリ側で暗号化してから入れる。サーバ（service_role）だけが読める
create table public.school_line_channels (
  school_id uuid primary key references public.schools (id) on delete cascade,
  channel_secret_enc text not null,
  access_token_enc text not null,
  updated_at timestamptz not null default now()
);

-- 保護者がLINEで送る合言葉：見間違えやすい文字（0/O・1/I/L）を除いた8文字
create function private.new_link_code() returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  abc constant text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  b bytea := extensions.gen_random_bytes(8);
  out text := '';
begin
  for i in 0..7 loop out := out || substr(abc, (get_byte(b, i) % length(abc)) + 1, 1); end loop;
  return out;
end $$;

create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  name text not null check (length(trim(name)) between 1 and 60),
  relation text not null default '' check (length(relation) <= 20),         -- 母・父など
  line_user_id text,                                                       -- つながったら入る（サーバだけが入れる）
  linked_at timestamptz,
  link_code text not null default private.new_link_code(),
  link_code_expires_at timestamptz not null default now() + interval '14 days',
  weekly_report boolean not null default true,
  created_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  unique (link_code),
  unique (student_id, line_user_id),
  unique (id, school_id),
  check ((line_user_id is null) = (linked_at is null))
);
create index guardians_student_idx on public.guardians (student_id);
create index guardians_line_idx on public.guardians (school_id, line_user_id) where line_user_id is not null;

-- LINE のつながり（line_user_id）は、サーバ（LINE からの知らせを受けたとき）だけが入れる。
-- 講師と運営ができるのは「つながりを切る」（両方を空にする）ことだけ
create function private.guard_guardian() returns trigger
language plpgsql set search_path = '' as $$
begin
  -- 守るのは、アプリから直接書いたとき（ログインした人の権限）だけ。DB の関数（合言葉の作り直し・LINE のつながり）は通す
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.line_user_id is not null or new.linked_at is not null then
      raise exception 'LINE のつながりは、保護者が合言葉を送ったときにだけ入ります' using errcode = '42501';
    end if;
    new.link_code := private.new_link_code(); new.link_code_expires_at := now() + interval '14 days';
    return new;
  end if;
  if (new.line_user_id is distinct from old.line_user_id or new.linked_at is distinct from old.linked_at)
     and not (new.line_user_id is null and new.linked_at is null) then
    raise exception 'LINE のつながりは、保護者が合言葉を送ったときにだけ入ります' using errcode = '42501';
  end if;
  if new.link_code is distinct from old.link_code or new.link_code_expires_at is distinct from old.link_code_expires_at then
    raise exception '合言葉は「作り直す」から変えてください' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_guardian before insert or update on public.guardians for each row execute function private.guard_guardian();
create trigger fill_school before insert or update of student_id on public.guardians for each row execute function private.fill_school_from_student();

-- 合言葉を作り直す（講師・運営）
create function public.renew_link_code(p_guardian uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare g public.guardians; code text := private.new_link_code();
begin
  select * into g from public.guardians where id = p_guardian;
  if g.id is null or not private.can_manage_student(g.student_id) then raise exception '保護者が見つかりません' using errcode = 'P0002'; end if;
  update public.guardians set link_code = code, link_code_expires_at = now() + interval '14 days' where id = g.id;
  return code;
end $$;

-- LINE で合言葉が届いたとき（サーバだけ）。期限内の合言葉なら、その LINE の人とつなぐ
create function public.link_guardian_line(p_school uuid, p_code text, p_line_user text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare g public.guardians;
begin
  select * into g from public.guardians
    where school_id = p_school and link_code = upper(regexp_replace(p_code, '[\s-]', '', 'g')) and link_code_expires_at > now()
    for update;
  if g.id is null then return null; end if;
  begin
    update public.guardians set line_user_id = p_line_user, linked_at = now(),
      link_code = private.new_link_code(), link_code_expires_at = now() where id = g.id;   -- 合言葉は使い捨て
  exception when unique_violation then
    return null;   -- 同じ生徒に、同じ LINE がもうつながっている
  end;
  return g.id;
end $$;

-- 塾の LINE の鍵が入っているか（鍵そのものは見せない）。講師・運営の画面で「LINE の設定がまだ」を出すため
create function public.line_ready() returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_staff() and exists (select 1 from public.school_line_channels c where c.school_id = private.my_school());
$$;

-- 週の報告を送った記録（同じ週に二度送らない）。書くのはサーバだけ
create table public.weekly_reports (
  id bigint generated always as identity primary key,
  school_id uuid not null,
  guardian_id uuid not null,
  student_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  body text not null,
  status text not null check (status in ('sent', 'failed', 'skipped')),
  error text,
  created_at timestamptz not null default now(),
  foreign key (guardian_id, school_id) references public.guardians (id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  unique (guardian_id, week_start)
);
create index weekly_reports_student_idx on public.weekly_reports (student_id, week_start desc);

-- ---------- 3. 模試・過去問の成績 ----------
create type public.exam_kind as enum ('mock', 'past');
create table public.exam_results (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  kind public.exam_kind not null,
  title text not null check (length(trim(title)) between 1 and 80),         -- 模試の名前 / 大学・学部
  provider text not null default '' check (length(provider) <= 40),         -- 河合塾・駿台など（模試）
  taken_on date not null,
  exam_year int check (exam_year between 1990 and 2100),                   -- 過去問の年度
  total_score numeric(7, 2) check (total_score >= 0),
  total_max numeric(7, 2) check (total_max > 0),
  passing_score numeric(7, 2) check (passing_score >= 0),                  -- 合格最低点（過去問。公表値は 129.95 のように小数2桁がある）
  deviation numeric(4, 1) check (deviation between 0 and 100),             -- 偏差値（模試）
  target text not null default '' check (length(target) <= 80),             -- 判定を出した志望校（模試）
  judgement text check (judgement in ('A', 'B', 'C', 'D', 'E')),
  note text not null default '' check (length(note) <= 200),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  unique (id, school_id),
  check (total_score is null or total_max is null or total_score <= total_max),
  check (passing_score is null or total_max is null or passing_score <= total_max),
  check (kind = 'past' or (exam_year is null and passing_score is null)),
  check (kind = 'mock' or (deviation is null and judgement is null and target = ''))
);
create index exam_results_student_idx on public.exam_results (student_id, taken_on);

create table public.exam_subject_scores (
  result_id uuid not null,
  school_id uuid not null,
  subject text not null check (length(trim(subject)) between 1 and 20),
  score numeric(7, 2) check (score >= 0),
  max_score numeric(7, 2) check (max_score > 0),
  deviation numeric(4, 1) check (deviation between 0 and 100),
  seq int not null default 0,
  primary key (result_id, subject),
  foreign key (result_id, school_id) references public.exam_results (id, school_id) on delete cascade,
  check (score is null or max_score is null or score <= max_score)
);

create function private.fill_school_from_result() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select r.school_id into new.school_id from public.exam_results r where r.id = new.result_id;
  if new.school_id is null then raise exception 'result not found' using errcode = '23503'; end if;
  return new;
end $$;
create trigger fill_school before insert or update of student_id on public.exam_results for each row execute function private.fill_school_from_student();
create trigger fill_school before insert or update of result_id on public.exam_subject_scores for each row execute function private.fill_school_from_result();
create trigger stamp_actor before insert on public.exam_results for each row execute function private.stamp_actor();

-- 成績を書けるか：生徒本人か、担当の講師・同じ塾の運営
create function private.can_edit_exam(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_student = auth.uid() and private.my_role() = 'student') or private.can_manage_student(p_student);
$$;

-- ---------- 4. 通知 ----------
create table public.notifications (
  id bigint generated always as identity primary key,
  school_id uuid not null,
  user_id uuid not null,
  kind text not null check (kind in ('task_start', 'missed_record', 'meeting_tomorrow', 'reply', 'meeting_booked', 'meeting_cancelled', 'report_sent')),
  title text not null check (length(title) between 1 and 80),
  body text not null default '' check (length(body) <= 300),
  url text not null default '/' check (url ~ '^/[^/\\]'  or url = '/'),     -- 同じサイトのパスだけ
  dedupe_key text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  pushed_at timestamptz,
  foreign key (user_id, school_id) references public.profiles (id, school_id) on delete cascade,
  unique (user_id, dedupe_key)
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unpushed_idx on public.notifications (created_at) where pushed_at is null;

-- 読んだ印だけは本人が付けられる（ほかの列は変えられない）
create function private.guard_notification() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is null then return new; end if;
  if (new.id, new.school_id, new.user_id, new.kind, new.title, new.body, new.url, new.dedupe_key, new.created_at, new.pushed_at)
     is distinct from (old.id, old.school_id, old.user_id, old.kind, old.title, old.body, old.url, old.dedupe_key, old.created_at, old.pushed_at) then
    raise exception '通知は「読んだ」にすることだけできます' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_notification before update on public.notifications for each row execute function private.guard_notification();

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  user_id uuid not null default auth.uid(),
  endpoint text not null check (endpoint ~ '^https://'),
  p256dh text not null,
  auth_key text not null,
  user_agent text not null default '' check (length(user_agent) <= 300),
  created_at timestamptz not null default now(),
  foreign key (user_id, school_id) references public.profiles (id, school_id) on delete cascade,
  unique (endpoint)
);
create index push_subscriptions_user_idx on public.push_subscriptions (user_id);

create table public.notification_prefs (
  user_id uuid primary key default auth.uid(),
  school_id uuid not null,
  task_start boolean not null default true,
  missed_record boolean not null default true,
  meeting boolean not null default true,
  reply boolean not null default true,
  quiet_start time not null default '23:00',     -- この時間は端末に通知しない（アプリの中には残る）
  quiet_end time not null default '07:00',
  updated_at timestamptz not null default now(),
  foreign key (user_id, school_id) references public.profiles (id, school_id) on delete cascade
);

-- 本人の塾を入れる（送った値は使わない）
create function private.fill_school_from_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select p.school_id into new.school_id from public.profiles p where p.id = new.user_id;
  if new.school_id is null then raise exception 'user not found' using errcode = '23503'; end if;
  return new;
end $$;
create trigger fill_school before insert or update of user_id on public.push_subscriptions for each row execute function private.fill_school_from_user();
create trigger fill_school before insert or update of user_id on public.notification_prefs for each row execute function private.fill_school_from_user();

-- 通知を1件入れる（同じ鍵は二度入れない。本人が切っている種類は入れない）
create function private.notify(p_user uuid, p_kind text, p_title text, p_body text, p_url text, p_key text) returns void
language plpgsql security definer set search_path = '' as $$
declare pref public.notification_prefs; on_ boolean;
begin
  select * into pref from public.notification_prefs where user_id = p_user;
  on_ := case p_kind
    when 'task_start' then coalesce(pref.task_start, true)
    when 'missed_record' then coalesce(pref.missed_record, true)
    when 'meeting_tomorrow' then coalesce(pref.meeting, true)
    when 'meeting_booked' then coalesce(pref.meeting, true)
    when 'meeting_cancelled' then coalesce(pref.meeting, true)
    when 'reply' then coalesce(pref.reply, true)
    else true end;
  if not on_ then return; end if;
  insert into public.notifications (school_id, user_id, kind, title, body, url, dedupe_key)
    select p.school_id, p.id, p_kind, left(p_title, 80), left(p_body, 300), p_url, p_key
    from public.profiles p where p.id = p_user and p.status = 'active'
    on conflict (user_id, dedupe_key) do nothing;
end $$;

-- 出来事の通知：講師の返信 → 生徒
create function private.notify_reply() returns trigger
language plpgsql security definer set search_path = '' as $$
declare label text;
begin
  select coalesce(t.title, m.short_name || ' ' || u.label) into label
    from public.tasks t left join public.materials m on m.id = t.material_id left join public.material_units u on u.id = t.unit_id where t.id = new.task_id;
  perform private.notify(new.student_id, 'reply', '先生から返信がありました', coalesce(label, '') || '：' || left(new.body, 120),
    '/student/records', 'reply:' || new.task_id || ':' || extract(epoch from now())::bigint);
  return null;
end $$;
create trigger notify_reply after insert or update of body on public.task_replies for each row execute function private.notify_reply();

-- 出来事の通知：面談が入った・取り消された → 入れた人ではない方（生徒か講師）
create function private.notify_meeting() returns trigger
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
  elsif tg_op = 'DELETE' and m.on_date >= current_date then
    -- 同じ週に入れ直した（予約の変更）なら、取り消しの通知は出さない（入れた方の通知だけ）
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
-- 処理の終わりに確かめる（予約の変更は「消す → 入れる」なので、終わったときの状態で判断する）
create constraint trigger notify_meeting after insert or delete on public.meetings deferrable initially deferred
  for each row execute function private.notify_meeting();

-- 時刻で決まる通知を入れる（定期の処理から。サーバだけ）。それぞれの人のタイムゾーンの時計で決める
--   予定の15分前 / 21:30 を過ぎて今日の記録がまだの予定がある / 19:00 を過ぎて明日が面談
create function public.enqueue_due_notifications() returns int
language plpgsql security definer set search_path = '' as $$
declare n0 bigint; n1 bigint;
begin
  select count(*) into n0 from public.notifications;
  -- 予定の15分前（予備時間は除く）
  perform private.notify(t.student_id, 'task_start', to_char(t.start_time, 'HH24:MI') || 'から ' || coalesce(t.title, m.short_name || ' ' || u.label),
      t.duration_min || '分 · タイマーを始めると、勉強時間が記録されます', '/student', 'task_start:' || t.id)
    from public.tasks t
    join public.profiles p on p.id = t.student_id
    join public.schools s on s.id = t.school_id
    left join public.materials m on m.id = t.material_id left join public.material_units u on u.id = t.unit_id
    where t.status = 'todo' and t.vague is distinct from 'buffer' and t.started_at is null
      and t.on_date = (now() at time zone coalesce(p.timezone, s.timezone))::date
      and t.start_time > (now() at time zone coalesce(p.timezone, s.timezone))::time
      and t.start_time <= (now() at time zone coalesce(p.timezone, s.timezone))::time + interval '15 minutes';
  -- 21:30 を過ぎて、今日の終わった時刻の予定に記録がない（1日1回）
  perform private.notify(x.student_id, 'missed_record', '今日の記録がまだの予定が' || x.n || '件あります', 'やった予定は完了に、できなかった予定はそのままで大丈夫です', '/student', 'missed:' || x.student_id || ':' || x.d)
    from (
      select t.student_id, (now() at time zone coalesce(p.timezone, s.timezone))::date as d, count(*) as n
      from public.tasks t join public.profiles p on p.id = t.student_id join public.schools s on s.id = t.school_id
      where t.status = 'todo' and t.vague is distinct from 'buffer'
        and (now() at time zone coalesce(p.timezone, s.timezone))::time >= time '21:30'
        and t.on_date = (now() at time zone coalesce(p.timezone, s.timezone))::date
        and t.start_time + t.duration_min * interval '1 minute' <= (now() at time zone coalesce(p.timezone, s.timezone))::time
      group by 1, 2) x;
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

-- ---------- 5. 塾の契約（Stripe） ----------
create table public.school_billing (
  school_id uuid primary key references public.schools (id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  status text not null default 'none' check (status in ('none', 'trialing', 'active', 'past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused')),
  seats int not null default 0 check (seats >= 0),           -- 請求する生徒の数（在籍中の生徒）
  current_period_end timestamptz,
  trial_end timestamptz,
  cancel_at_period_end boolean not null default false,
  updated_at timestamptz not null default now()
);
-- Stripe から届いた知らせ（同じ知らせを二度処理しない）
create table public.billing_events (
  id text primary key,
  type text not null,
  received_at timestamptz not null default now()
);

-- ---------- 権限 ----------
alter table public.school_line_channels enable row level security;
alter table public.guardians enable row level security;
alter table public.weekly_reports enable row level security;
alter table public.exam_results enable row level security;
alter table public.exam_subject_scores enable row level security;
alter table public.notifications enable row level security;
alter table public.push_subscriptions enable row level security;
alter table public.notification_prefs enable row level security;
alter table public.school_billing enable row level security;
alter table public.billing_events enable row level security;

-- school_line_channels / billing_events：ポリシーなし（サーバだけ）

-- guardians：担当の講師と運営。生徒本人には見せない（LINE の ID を持つため）
create policy "guardians select" on public.guardians for select to authenticated using (private.can_manage_student(student_id));
create policy "guardians insert" on public.guardians for insert to authenticated with check (private.can_manage_student(student_id));
create policy "guardians update" on public.guardians for update to authenticated using (private.can_manage_student(student_id)) with check (private.can_manage_student(student_id));
create policy "guardians delete" on public.guardians for delete to authenticated using (private.can_manage_student(student_id));

create policy "weekly_reports select" on public.weekly_reports for select to authenticated using (private.can_manage_student(student_id));

create policy "exam_results select" on public.exam_results for select to authenticated using (private.can_view_student(student_id));
create policy "exam_results insert" on public.exam_results for insert to authenticated with check (private.can_edit_exam(student_id));
create policy "exam_results update" on public.exam_results for update to authenticated using (private.can_edit_exam(student_id)) with check (private.can_edit_exam(student_id));
create policy "exam_results delete" on public.exam_results for delete to authenticated using (private.can_edit_exam(student_id));

create policy "exam_subject_scores select" on public.exam_subject_scores for select to authenticated
  using (exists (select 1 from public.exam_results r where r.id = result_id and private.can_view_student(r.student_id)));
create policy "exam_subject_scores insert" on public.exam_subject_scores for insert to authenticated
  with check (exists (select 1 from public.exam_results r where r.id = result_id and private.can_edit_exam(r.student_id)));
create policy "exam_subject_scores update" on public.exam_subject_scores for update to authenticated
  using (exists (select 1 from public.exam_results r where r.id = result_id and private.can_edit_exam(r.student_id)))
  with check (exists (select 1 from public.exam_results r where r.id = result_id and private.can_edit_exam(r.student_id)));
create policy "exam_subject_scores delete" on public.exam_subject_scores for delete to authenticated
  using (exists (select 1 from public.exam_results r where r.id = result_id and private.can_edit_exam(r.student_id)));

create policy "notifications select" on public.notifications for select to authenticated using (user_id = (select auth.uid()));
create policy "notifications update" on public.notifications for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "push_subscriptions select" on public.push_subscriptions for select to authenticated using (user_id = (select auth.uid()));
create policy "push_subscriptions insert" on public.push_subscriptions for insert to authenticated with check (user_id = (select auth.uid()));
create policy "push_subscriptions delete" on public.push_subscriptions for delete to authenticated using (user_id = (select auth.uid()));

create policy "notification_prefs select" on public.notification_prefs for select to authenticated using (user_id = (select auth.uid()));
create policy "notification_prefs insert" on public.notification_prefs for insert to authenticated with check (user_id = (select auth.uid()));
create policy "notification_prefs update" on public.notification_prefs for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

create policy "school_billing select" on public.school_billing for select to authenticated
  using ((select private.is_school_admin()) and school_id = (select private.my_school()));

-- 未ログイン（anon）には何も見せない（新しい表にも）
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- 関数：生徒・講師・運営が呼ぶものは authenticated、サーバだけのものは service_role
revoke all on function public.set_main_coach(uuid, uuid) from public, anon;
revoke all on function public.renew_link_code(uuid) from public, anon;
revoke all on function public.line_ready() from public, anon;
grant execute on function public.line_ready() to authenticated, service_role;
grant execute on function public.set_main_coach(uuid, uuid), public.renew_link_code(uuid) to authenticated, service_role;
revoke all on function public.link_guardian_line(uuid, text, text) from public, anon, authenticated;
revoke all on function public.enqueue_due_notifications() from public, anon, authenticated;
grant execute on function public.link_guardian_line(uuid, text, text), public.enqueue_due_notifications() to service_role;

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;
