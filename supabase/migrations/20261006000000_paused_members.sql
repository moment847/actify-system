-- 休会中（paused）の人はアプリを使えない（2026-10-05）
--
-- なぜ：Actify の月額は「在籍中（active）の生徒の数」で請求する。休会中の生徒がそのまま使えると、
-- 塾が生徒を「休会」にしたまま使わせて支払いを減らせる。休会＝サービスを受けない、で請求と使える範囲をそろえる。
-- 退会と同じく、my_school / my_role が空になるので、本人の行も見えなくなる（講師・運営はもともと active だけ）。
-- 休会中の生徒の予定・記録は消えない。在籍に戻せばそのまま見える。

create or replace function private.my_school() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.school_id from public.profiles p where p.id = auth.uid() and p.status = 'active';
$$;

create or replace function private.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.status = 'active';
$$;

-- 本人の行だけを見るポリシー（user_id = auth.uid()）は役割を見ないので、通知・端末の登録は休会中でも読める。
-- 中身は本人のものなので問題ない（予定・記録・AI相談・成績は役割の判定を通るので見えない）
