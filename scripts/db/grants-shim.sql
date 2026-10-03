-- ローカル検証用: Supabaseが public スキーマに設定しているデフォルト権限の再現。
--
-- 重要: このファイルは「マイグレーションの前」に流すこと。
-- Supabaseは ALTER DEFAULT PRIVILEGES を使っており、権限はオブジェクト生成時に付く。
-- 以前はマイグレーションの後にブランケットの GRANT を流していたため、
-- マイグレーション内の明示的な REVOKE が検証環境でだけ打ち消されていた
-- (security definer 関数の権限漏れを取り逃がした原因)。

grant usage on schema public to anon, authenticated, service_role;

alter default privileges in schema public
  grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public
  grant all on functions to anon, authenticated, service_role;
