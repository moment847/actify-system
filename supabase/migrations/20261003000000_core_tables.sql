-- Actify：テーブルの土台
--
-- 決まりごと
-- - 複数の塾（school）に売る前提。すべての行に school_id を持たせ、親子の school_id は
--   複合外部キーでそろえる（別の塾の生徒・教材を指せないことを、アプリではなくDBで保証する）。
-- - 予定・勉強できる時間・面談は「その生徒の暦の上の日付と時刻」（date + time）で持つ。
--   週のカレンダーで扱う値で、塾のタイムゾーン（schools.timezone、生徒は profiles.timezone で上書き）の壁時計。
--   いつ起きたか（完了した時刻など）は timestamptz（UTC）で持つ。
-- - 週は月曜はじまり。曜日の番号は 0=月 … 6=日（モックと同じ）。

create schema if not exists extensions;
create extension if not exists btree_gist with schema extensions;
create schema if not exists private;

create type public.app_role as enum ('student', 'coach', 'admin');
create type public.member_status as enum ('active', 'paused', 'withdrawn');
create type public.subject as enum ('english', 'math', 'japanese', 'science', 'social', 'other');
create type public.material_kind as enum ('input', 'practice');      -- インプット（覚える）／演習（解く）
create type public.task_status as enum ('todo', 'done');
create type public.vague_kind as enum ('buffer', 'mock', 'school', 'weak', 'free'); -- 時間だけ取る予定
create type public.feedback_tag as enum ('easy', 'just_right', 'hard', 'not_enough_time');
create type public.chat_sender as enum ('student', 'bot');

-- ---------- 塾と人 ----------
create table public.schools (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 100),
  timezone text not null default 'Asia/Tokyo',
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  school_id uuid not null references public.schools (id) on delete restrict,
  role public.app_role not null,
  display_name text not null check (length(trim(display_name)) between 1 and 60),
  status public.member_status not null default 'active',
  timezone text,                                   -- null なら塾のタイムゾーン
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, school_id)
);
create index profiles_school_idx on public.profiles (school_id, role);

create table public.students (
  id uuid primary key,
  school_id uuid not null,
  grade text not null default '',
  goal_school text not null default '',
  goal_faculty text not null default '',
  exam_on date,
  coach_message text not null default '' check (length(coach_message) <= 400),  -- 生徒のホームに出る
  foreign key (id, school_id) references public.profiles (id, school_id) on delete cascade,
  unique (id, school_id)
);

-- 講師メモ：生徒には見せない。生徒の行と分けて、RLS で生徒本人を外す
create table public.coach_notes (
  student_id uuid primary key,
  school_id uuid not null,
  memo text not null default '' check (length(memo) <= 2000),
  updated_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);

create table public.coach_assignments (
  coach_id uuid not null,
  student_id uuid not null,
  school_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (coach_id, student_id),
  foreign key (coach_id, school_id) references public.profiles (id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade
);
create index coach_assignments_student_idx on public.coach_assignments (student_id);

-- ---------- 教材 ----------
create table public.materials (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  short_name text not null check (length(trim(short_name)) between 1 and 30),
  subject public.subject not null,
  kind public.material_kind not null,
  review_intervals int[] not null default '{}',   -- 再テストの間隔（日）。インプットだけ
  keywords text[] not null default '{}',          -- PDFのファイル名・自由入力で教材を見分ける言葉
  toc_image_path text,                            -- 目次の写真（Storage: toc-images）
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (id, school_id),
  check (kind = 'input' or cardinality(review_intervals) = 0),
  check (cardinality(review_intervals) = 0 or 0 < all (review_intervals))
);
create index materials_school_idx on public.materials (school_id);

create table public.material_units (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  material_id uuid not null,
  seq int not null check (seq >= 1),
  label text not null check (length(trim(label)) between 1 and 120),
  foreign key (material_id, school_id) references public.materials (id, school_id) on delete cascade,
  unique (material_id, seq) deferrable initially immediate,   -- 目次の並べ替えで一時的に重なるので
  unique (id, material_id),
  unique (id, school_id)
);

create table public.quiz_versions (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  unit_id uuid not null,
  version int not null check (version >= 1),
  max_score int not null check (max_score between 1 and 1000),
  problem_path text not null,                     -- Storage: quiz-pdfs
  answer_path text not null,
  file_name text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (unit_id, school_id) references public.material_units (id, school_id) on delete restrict,
  unique (unit_id, version),
  unique (id, unit_id)
);

create table public.student_books (
  student_id uuid not null,
  material_id uuid not null,
  school_id uuid not null,
  start_on date not null,
  target_on date not null,                        -- いつまでに1周
  primary key (student_id, material_id),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  foreign key (material_id, school_id) references public.materials (id, school_id) on delete restrict,
  check (target_on >= start_on)
);

-- ---------- 勉強できる時間（生徒が週ごとに登録。毎週くり返しは例外） ----------
create table public.study_slots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  on_date date,                                   -- この週だけ
  weekday smallint check (weekday between 0 and 6), -- 毎週（0=月）
  start_time time not null,
  end_time time not null,
  label text not null default '' check (length(label) <= 20),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  check ((on_date is null) <> (weekday is null)),
  check (start_time < end_time),
  unique (id, school_id)
);
create index study_slots_student_idx on public.study_slots (student_id, on_date);

create table public.study_slot_skips (
  slot_id uuid not null,
  on_date date not null,
  school_id uuid not null,
  primary key (slot_id, on_date),
  foreign key (slot_id, school_id) references public.study_slots (id, school_id) on delete cascade
);

-- ---------- 予定（学習のタスク） ----------
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  student_id uuid not null,
  on_date date not null,
  start_time time not null,
  duration_min int not null check (duration_min between 5 and 600),
  material_id uuid,
  unit_id uuid,
  vague public.vague_kind,                        -- 時間だけ取る予定（教材なし）
  title text check (title is null or length(trim(title)) between 1 and 80),
  status public.task_status not null default 'todo',
  quiz_version_id uuid,                           -- 付いた小テストの版。「配った記録」はこの列だけが唯一の記録
  max_score int check (max_score >= 1),
  no_quiz boolean not null default false,         -- 講師が「小テストを付けない」を選んだ
  is_retest boolean not null default false,
  score int,
  actual_min int check (actual_min between 1 and 1800),
  started_at timestamptz,
  paused_at timestamptz,
  paused_ms bigint not null default 0 check (paused_ms >= 0),
  done_at timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  foreign key (material_id, school_id) references public.materials (id, school_id) on delete restrict,
  foreign key (unit_id, material_id) references public.material_units (id, material_id) on delete restrict,
  foreign key (quiz_version_id, unit_id) references public.quiz_versions (id, unit_id) on delete restrict,
  -- 教材の予定 か 時間だけの予定 のどちらか
  check ((material_id is not null and unit_id is not null and vague is null)
      or (material_id is null and unit_id is null and vague is not null and title is not null)),
  check (vague is null or quiz_version_id is null),
  check (score is null or (max_score is not null and score between 0 and max_score)),
  check ((status = 'done') = (done_at is not null)),
  check (status = 'todo' or started_at is null),
  check (paused_at is null or started_at is not null),
  unique (id, school_id),
  unique (id, student_id)
);
create index tasks_student_date_idx on public.tasks (student_id, on_date, start_time);
create index tasks_unit_idx on public.tasks (unit_id);
-- 同じ生徒に同じ版は二度付けない（解いた・予定に入っている、のどちらも）
create unique index tasks_one_version_per_student on public.tasks (student_id, quiz_version_id) where quiz_version_id is not null;
-- 1つの範囲の「まだの予定」は1件だけ（入っている範囲を選んだら、二重にせず移す）。
-- 範囲の並べ直しで一時的に入れ替わるので、文の終わりで確かめる
alter table public.tasks add constraint tasks_one_todo_per_unit
  exclude using btree (student_id with =, unit_id with =) where (status = 'todo' and unit_id is not null)
  deferrable initially immediate;

-- 生徒のひとこと（タスクごと。講師に届く）
create table public.task_feedback (
  task_id uuid primary key,
  student_id uuid not null,
  school_id uuid not null,
  tag public.feedback_tag,
  body text not null default '' check (length(body) <= 80),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (task_id, student_id) references public.tasks (id, student_id) on delete cascade,
  check (tag is not null or length(trim(body)) > 0)
);
create index task_feedback_student_idx on public.task_feedback (student_id, created_at desc);

-- 講師の返信（生徒の「記録」に出る）
create table public.task_replies (
  task_id uuid primary key,
  student_id uuid not null,
  school_id uuid not null,
  coach_id uuid references auth.users (id) on delete set null,
  body text not null check (length(trim(body)) between 1 and 400),
  created_at timestamptz not null default now(),
  foreign key (task_id, student_id) references public.tasks (id, student_id) on delete cascade
);

-- 講師が見送った再テスト（その範囲の k 回目のあとの再テスト）
create table public.review_skips (
  student_id uuid not null,
  unit_id uuid not null,
  attempt int not null check (attempt >= 1),
  school_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (student_id, unit_id, attempt),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  foreign key (unit_id, school_id) references public.material_units (id, school_id) on delete cascade
);

-- ---------- 面談 ----------
create table public.coach_open_slots (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  coach_id uuid not null,
  on_date date,
  weekday smallint check (weekday between 0 and 6),
  start_time time not null,
  end_time time not null,
  created_at timestamptz not null default now(),
  foreign key (coach_id, school_id) references public.profiles (id, school_id) on delete cascade,
  check ((on_date is null) <> (weekday is null)),
  check (start_time < end_time)
);
create index coach_open_slots_coach_idx on public.coach_open_slots (coach_id, on_date);

create table public.booking_settings (
  coach_id uuid primary key,
  school_id uuid not null,
  length_min int not null default 30 check (length_min in (20, 30, 45, 60)),
  published boolean not null default true,
  foreign key (coach_id, school_id) references public.profiles (id, school_id) on delete cascade
);

create table public.meetings (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null,
  coach_id uuid not null,
  student_id uuid not null,
  on_date date not null,
  start_time time not null,
  length_min int not null check (length_min between 10 and 180),
  week_start date generated always as (on_date - (extract(isodow from on_date)::int - 1)) stored,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (coach_id, school_id) references public.profiles (id, school_id) on delete cascade,
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  -- その週の1回だけ
  unique (student_id, week_start),
  -- 講師の面談は重ならない
  constraint meetings_no_overlap exclude using gist (
    coach_id with =,
    tsrange(on_date + start_time, on_date + start_time + length_min * interval '1 minute') with &&
  )
);
create index meetings_student_idx on public.meetings (student_id, on_date);

-- ---------- 配る資料 ----------
create table public.resources (
  id uuid primary key default gen_random_uuid(),
  school_id uuid not null references public.schools (id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 120),
  file_path text not null,                        -- Storage: resources
  target_student_id uuid,                         -- null なら全員
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (target_student_id, school_id) references public.students (id, school_id) on delete cascade
);
create index resources_school_idx on public.resources (school_id, created_at desc);

-- ---------- AI相談（生徒本人だけが見る。講師にも運営にも見せない） ----------
create table public.chat_messages (
  id bigint generated always as identity primary key,
  school_id uuid not null,
  student_id uuid not null,
  sender public.chat_sender not null,
  body text not null default '' check (length(body) <= 4000),
  image_path text,                                -- Storage: chat-images
  mood text,
  created_at timestamptz not null default now(),
  foreign key (student_id, school_id) references public.students (id, school_id) on delete cascade,
  check (length(trim(body)) > 0 or image_path is not null)
);
create index chat_messages_student_idx on public.chat_messages (student_id, id desc);

-- ---------- AI の呼び出しと原価（円・整数） ----------
create table public.ai_calls (
  id bigint generated always as identity primary key,
  school_id uuid not null references public.schools (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  purpose text not null check (purpose in ('chat', 'toc_ocr')),
  model text not null,
  prompt_version text not null,
  input_tokens int not null default 0 check (input_tokens >= 0),
  output_tokens int not null default 0 check (output_tokens >= 0),
  cost_jpy int not null default 0 check (cost_jpy >= 0),
  error text,
  created_at timestamptz not null default now()
);
create index ai_calls_school_idx on public.ai_calls (school_id, created_at desc);
