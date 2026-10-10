-- Actify：面談の記録と、AI の予定の提案（2026-10-11）
--
-- 1. 面談の記録（meeting_notes）：面談ごとの議事録と、いつでも書ける自由なメモ。講師と運営だけが読み書きする
--    - 「次回までにやること」（shared_todo）だけは生徒に共有する。生徒は表を直接読めず、関数 my_meeting_todos から共有欄だけを受け取る
--      （生徒向けの AI「Actifyくん」もこの共有欄だけを読む。議事録の本文を生徒の AI に渡すと、AI が生徒に話してしまうため）
--    - AI の要約（決めたこと・宿題・気になること）は summary に入れる。講師が見て直してから共有欄に写す
-- 2. AI の予定の提案（plan_proposals）：AI は「どの教材を多め・少なめにするか・どの日を軽くするか」だけを決め、
--    日時に置くのは今までの計算（suggestions）。提案は保存し、講師が選んだ項目だけを予定に入れる（自動では入れない）

-- ---------- 1. 面談の記録 ----------
create table public.meeting_notes (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  meeting_id uuid references public.meetings (id) on delete set null,   -- 面談の取り消し・入れ直しでも記録は残す
  kind text not null check (kind in ('minutes', 'memo')),              -- minutes＝面談の議事録 / memo＝自由なメモ
  on_date date not null,
  body text not null default '' check (length(body) <= 8000),
  summary jsonb check (summary is null or jsonb_typeof(summary) = 'object'),
  shared_todo text not null default '' check (length(shared_todo) <= 1000),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  check (length(trim(body)) > 0 or length(trim(shared_todo)) > 0)
);
create index meeting_notes_student_idx on public.meeting_notes (student_id, on_date desc, created_at desc);
create trigger fill_school before insert or update of student_id on public.meeting_notes for each row execute function private.fill_school_from_student();
create trigger stamp_actor before insert on public.meeting_notes for each row execute function private.stamp_actor();
create trigger touch before update on public.meeting_notes for each row execute function private.touch_updated_at();

-- 面談に結びつけるなら、同じ生徒の面談だけ。書いた人・書いた時刻は変えられない
create function private.guard_meeting_note() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.meeting_id is not null and not exists (select 1 from public.meetings m where m.id = new.meeting_id and m.student_id = new.student_id) then
    raise exception 'その面談はこの生徒の面談ではありません' using errcode = '22023';
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null then
    new.created_by := old.created_by; new.created_at := old.created_at; new.student_id := old.student_id;
  end if;
  return new;
end $$;
create trigger guard_meeting_note before insert or update on public.meeting_notes for each row execute function private.guard_meeting_note();

alter table public.meeting_notes enable row level security;
-- 担当の講師と同じ塾の運営だけ。生徒は直接読めない（共有欄は my_meeting_todos から）
create policy "meeting_notes select" on public.meeting_notes for select to authenticated using (private.can_manage_student(student_id));
create policy "meeting_notes insert" on public.meeting_notes for insert to authenticated with check (private.can_manage_student(student_id));
create policy "meeting_notes update" on public.meeting_notes for update to authenticated
  using (private.can_manage_student(student_id)) with check (private.can_manage_student(student_id));
-- 消せるのは書いた本人と運営
create policy "meeting_notes delete" on public.meeting_notes for delete to authenticated
  using (private.can_manage_student(student_id) and (created_by = (select auth.uid()) or (select private.is_school_admin())));

-- 生徒が受け取る「次回までにやること」（新しい順）。生徒本人だけ。議事録の本文・要約は返さない
create function public.my_meeting_todos(p_limit int default 3)
returns table (on_date date, todo text)
language sql stable security definer set search_path = '' as $$
  select n.on_date, n.shared_todo from public.meeting_notes n
  where n.student_id = auth.uid() and private.my_role() = 'student' and length(trim(n.shared_todo)) > 0
  order by n.on_date desc, n.created_at desc
  limit least(greatest(coalesce(p_limit, 3), 1), 10);
$$;
revoke all on function public.my_meeting_todos(int) from public, anon;
grant execute on function public.my_meeting_todos(int) to authenticated, service_role;

-- ---------- 2. AI の予定の提案 ----------
create table public.plan_proposals (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  week_start date not null check (extract(isodow from week_start) = 1),
  advice jsonb not null check (jsonb_typeof(advice) = 'object'),     -- AI の方針（多め・少なめ・軽くする日・講師への注意）
  items jsonb not null check (jsonb_typeof(items) = 'array'),        -- 計算で日時に置いた予定の案
  status text not null default 'open' check (status in ('open', 'adopted', 'dismissed')),
  adopted_keys text[] not null default '{}',
  model text not null default '',
  prompt_version text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);
create index plan_proposals_student_idx on public.plan_proposals (student_id, week_start desc, created_at desc);
create trigger fill_school before insert or update of student_id on public.plan_proposals for each row execute function private.fill_school_from_student();
create trigger stamp_actor before insert on public.plan_proposals for each row execute function private.stamp_actor();

-- 案の中身（advice・items）はあとから書き換えられない。変えられるのは採用の状態だけ（採用した項目を記録に残す）
create function private.guard_plan_proposal() returns trigger
language plpgsql set search_path = '' as $$
begin
  if auth.uid() is not null and (new.advice, new.items, new.student_id, new.week_start, new.model, new.prompt_version, new.created_by, new.created_at)
     is distinct from (old.advice, old.items, old.student_id, old.week_start, old.model, old.prompt_version, old.created_by, old.created_at) then
    raise exception '案の中身は変えられません。新しく案を作ってください' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_plan_proposal before update on public.plan_proposals for each row execute function private.guard_plan_proposal();

alter table public.plan_proposals enable row level security;
create policy "plan_proposals select" on public.plan_proposals for select to authenticated using (private.can_manage_student(student_id));
create policy "plan_proposals insert" on public.plan_proposals for insert to authenticated with check (private.can_manage_student(student_id));
create policy "plan_proposals update" on public.plan_proposals for update to authenticated
  using (private.can_manage_student(student_id)) with check (private.can_manage_student(student_id));

-- ---------- 3. AI の原価の用途を足す ----------
alter table public.ai_calls drop constraint ai_calls_purpose_check;
alter table public.ai_calls add constraint ai_calls_purpose_check check (purpose in ('chat', 'toc_ocr', 'note_summary', 'plan_advice'));

revoke all on function private.guard_meeting_note(), private.guard_plan_proposal() from public, anon;
grant execute on function private.guard_meeting_note(), private.guard_plan_proposal() to authenticated, service_role;
