-- ローカル検証用：Supabase が用意している auth スキーマ・ロールの最小の代わり。
-- 本番と supabase start では使わない（Supabase 側に本物がある）。scripts/db/verify.sh からだけ使う。

create role anon nologin;
create role authenticated nologin;
create role service_role nologin bypassrls;

create schema auth;
create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

-- seed.sql が本番の Supabase にも流せるよう、使う列は本物と同じ名前で持つ
create table auth.users (
  instance_id uuid,
  id uuid primary key,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb,
  raw_user_meta_data jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now(),
  confirmation_token text,
  recovery_token text,
  email_change text,
  email_change_token_new text
);

create table auth.identities (
  id uuid primary key default gen_random_uuid(),
  provider_id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  identity_data jsonb not null,
  provider text not null,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- Supabase の auth.uid() と同じ。テストでは request.jwt.claim.sub を入れて、ログインした扱いにする
create function auth.uid() returns uuid language sql stable as $$
  select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
