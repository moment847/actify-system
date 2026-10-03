-- Actify：誰が何を見られるか（RLS）と、行の整合を保つトリガ
--
-- 見られる範囲
-- - 生徒：自分の行だけ。担当の講師の名前と面談の枠。
-- - 講師：担当の生徒だけ（coach_assignments）。
-- - 運営（塾の admin）：自分の塾の全件。
-- - AI相談（chat_messages）：生徒本人だけ。講師にも運営にも見せない（画面にもそう書いてある）。
-- - 講師メモ（coach_notes）：講師と運営だけ。生徒本人には見せない。
-- - 小テストの版（quiz_versions）：講師と運営だけ。生徒は自分の予定に付いた版を、サーバが確かめてから開く。
-- ポリシーは「1テーブル × 1コマンド × 1本」。役割を足すときは式に OR で足す。for all は使わない。

-- ---------- 判定に使う関数（private スキーマ。API からは呼べない） ----------
grant usage on schema private to authenticated, service_role;

create function private.my_school() returns uuid
language sql stable security definer set search_path = '' as $$
  select p.school_id from public.profiles p where p.id = auth.uid() and p.status <> 'withdrawn';
$$;

create function private.my_role() returns public.app_role
language sql stable security definer set search_path = '' as $$
  select p.role from public.profiles p where p.id = auth.uid() and p.status <> 'withdrawn';
$$;

create function private.is_school_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin' and p.status = 'active');
$$;

create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.role in ('coach', 'admin') and p.status = 'active');
$$;

-- 講師がこの生徒の担当か
create function private.is_coach_of(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.coach_assignments a join public.profiles c on c.id = a.coach_id
    where a.coach_id = auth.uid() and a.student_id = p_student and c.role = 'coach' and c.status = 'active');
$$;

-- 生徒の予定・記録を書き換えられるか（担当の講師か、同じ塾の運営）
create function private.can_manage_student(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select private.is_coach_of(p_student)
      or (private.is_school_admin() and exists (select 1 from public.students s where s.id = p_student and s.school_id = private.my_school()));
$$;

-- 生徒の予定・記録を見られるか（本人・担当の講師・同じ塾の運営）
create function private.can_view_student(p_student uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (p_student = auth.uid() and private.my_role() = 'student') or private.can_manage_student(p_student);
$$;

-- 生徒から見て、この講師が担当か
create function private.is_my_coach(p_coach uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.coach_assignments a where a.student_id = auth.uid() and a.coach_id = p_coach);
$$;

-- その人の「今日」：本人のタイムゾーン（無ければ塾のタイムゾーン）の暦日
create function private.local_today(p_user uuid) returns date
language sql stable security definer set search_path = '' as $$
  select (now() at time zone coalesce(p.timezone, s.timezone))::date
  from public.profiles p join public.schools s on s.id = p.school_id where p.id = p_user;
$$;

-- ---------- school_id は親から入れる（クライアントが送った値は使わない） ----------
create function private.fill_school_from_student() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select s.school_id into new.school_id from public.students s where s.id = new.student_id;
  if new.school_id is null then raise exception 'student not found' using errcode = '23503'; end if;
  return new;
end $$;

create function private.fill_school_from_material() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select m.school_id into new.school_id from public.materials m where m.id = new.material_id;
  if new.school_id is null then raise exception 'material not found' using errcode = '23503'; end if;
  return new;
end $$;

create function private.fill_school_from_unit() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select u.school_id into new.school_id from public.material_units u where u.id = new.unit_id;
  if new.school_id is null then raise exception 'unit not found' using errcode = '23503'; end if;
  return new;
end $$;

create function private.fill_school_from_slot() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select s.school_id into new.school_id from public.study_slots s where s.id = new.slot_id;
  if new.school_id is null then raise exception 'slot not found' using errcode = '23503'; end if;
  return new;
end $$;

create function private.fill_school_from_coach() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select p.school_id into new.school_id from public.profiles p where p.id = new.coach_id;
  if new.school_id is null then raise exception 'coach not found' using errcode = '23503'; end if;
  return new;
end $$;

-- タスクの子（ひとこと・返信）は、タスクから生徒と塾を入れる
create function private.fill_from_task() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  select t.student_id, t.school_id into new.student_id, new.school_id from public.tasks t where t.id = new.task_id;
  if new.school_id is null then raise exception 'task not found' using errcode = '23503'; end if;
  return new;
end $$;

-- 利用者が作る行（教材・資料）は、作った人の塾に入れる。service_role（auth.uid() が無い）は送った値のまま
create function private.fill_school_from_me() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is not null then
    new.school_id := private.my_school();
    if new.school_id is null then raise exception 'no school' using errcode = '42501'; end if;
  end if;
  return new;
end $$;

create trigger fill_school before insert or update of student_id on public.coach_notes for each row execute function private.fill_school_from_student();
create trigger fill_school before insert or update of student_id on public.coach_assignments for each row execute function private.fill_school_from_student();
create trigger fill_school before insert or update of school_id on public.materials for each row execute function private.fill_school_from_me();
create trigger fill_school before insert or update of material_id on public.material_units for each row execute function private.fill_school_from_material();
create trigger fill_school before insert or update of unit_id on public.quiz_versions for each row execute function private.fill_school_from_unit();
create trigger fill_school before insert or update of student_id on public.student_books for each row execute function private.fill_school_from_student();
create trigger fill_school before insert or update of student_id on public.study_slots for each row execute function private.fill_school_from_student();
create trigger fill_school before insert or update of slot_id on public.study_slot_skips for each row execute function private.fill_school_from_slot();
create trigger fill_school before insert or update of student_id on public.tasks for each row execute function private.fill_school_from_student();
create trigger fill_school before insert or update of task_id on public.task_feedback for each row execute function private.fill_from_task();
create trigger fill_school before insert or update of task_id on public.task_replies for each row execute function private.fill_from_task();
create trigger fill_school before insert or update of student_id on public.review_skips for each row execute function private.fill_school_from_student();
create trigger fill_school before insert or update of coach_id on public.coach_open_slots for each row execute function private.fill_school_from_coach();
create trigger fill_school before insert or update of coach_id on public.booking_settings for each row execute function private.fill_school_from_coach();
create trigger fill_school before insert or update of student_id on public.meetings for each row execute function private.fill_school_from_student();
create trigger fill_school before insert or update of school_id on public.resources for each row execute function private.fill_school_from_me();
create trigger fill_school before insert or update of student_id on public.chat_messages for each row execute function private.fill_school_from_student();

-- ---------- 役割の整合 ----------
-- students の行は役割が「生徒」の人だけ。担当の講師は役割が「講師」の人だけ
create function private.check_roles() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'students' then
    if not exists (select 1 from public.profiles p where p.id = new.id and p.role = 'student') then
      raise exception '生徒ではない人に生徒の情報は付けられません' using errcode = '23514';
    end if;
  elsif tg_table_name = 'coach_assignments' then
    if not exists (select 1 from public.profiles p where p.id = new.coach_id and p.role = 'coach') then
      raise exception '担当にできるのは講師だけです' using errcode = '23514';
    end if;
  elsif tg_table_name in ('coach_open_slots', 'booking_settings') then
    if not exists (select 1 from public.profiles p where p.id = new.coach_id and p.role = 'coach') then
      raise exception '面談の枠を持てるのは講師だけです' using errcode = '23514';
    end if;
  elsif tg_table_name = 'meetings' then
    if not exists (select 1 from public.coach_assignments a where a.coach_id = new.coach_id and a.student_id = new.student_id) then
      raise exception '面談は担当の講師とだけ入れられます' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;
create trigger check_roles before insert or update on public.students for each row execute function private.check_roles();
create trigger check_roles before insert or update on public.coach_assignments for each row execute function private.check_roles();
create trigger check_roles before insert or update on public.coach_open_slots for each row execute function private.check_roles();
create trigger check_roles before insert or update on public.booking_settings for each row execute function private.check_roles();
create trigger check_roles before insert or update on public.meetings for each row execute function private.check_roles();

-- 役割・状態・塾は本人では変えられない。運営は同じ塾のほかの人だけ変えられる（自分を外して締め出されないように）
create function private.guard_profile() returns trigger
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
  if new.role is distinct from old.role and (
       (old.role = 'student' and exists (select 1 from public.students s where s.id = old.id))
    or (old.role = 'coach' and exists (select 1 from public.coach_assignments a where a.coach_id = old.id))) then
    raise exception '担当や記録がある人の役割は変えられません。新しいアカウントを作ってください' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger guard_profile before update on public.profiles for each row execute function private.guard_profile();

-- 退会にした講師は担当から外す（モック：「退会にすると、講師の担当一覧から外れます」）
create function private.on_profile_withdrawn() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'withdrawn' and old.status <> 'withdrawn' then
    delete from public.coach_assignments where coach_id = new.id or student_id = new.id;
  end if;
  return new;
end $$;
create trigger on_withdrawn after update of status on public.profiles for each row execute function private.on_profile_withdrawn();

create function private.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
create trigger touch before update on public.tasks for each row execute function private.touch_updated_at();
create trigger touch before update on public.task_feedback for each row execute function private.touch_updated_at();
create trigger touch before update on public.coach_notes for each row execute function private.touch_updated_at();

revoke all on all functions in schema private from public, anon;
grant execute on all functions in schema private to authenticated, service_role;

-- ---------- RLS ----------
alter table public.schools enable row level security;
alter table public.profiles enable row level security;
alter table public.students enable row level security;
alter table public.coach_notes enable row level security;
alter table public.coach_assignments enable row level security;
alter table public.materials enable row level security;
alter table public.material_units enable row level security;
alter table public.quiz_versions enable row level security;
alter table public.student_books enable row level security;
alter table public.study_slots enable row level security;
alter table public.study_slot_skips enable row level security;
alter table public.tasks enable row level security;
alter table public.task_feedback enable row level security;
alter table public.task_replies enable row level security;
alter table public.review_skips enable row level security;
alter table public.coach_open_slots enable row level security;
alter table public.booking_settings enable row level security;
alter table public.meetings enable row level security;
alter table public.resources enable row level security;
alter table public.chat_messages enable row level security;
alter table public.ai_calls enable row level security;

-- 未ログイン（anon）には何も見せない
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;

-- schools
create policy "schools select" on public.schools for select to authenticated
  using (id = (select private.my_school()));
create policy "schools update" on public.schools for update to authenticated
  using (id = (select private.my_school()) and (select private.is_school_admin()))
  with check (id = (select private.my_school()));

-- profiles：本人／運営は同じ塾の全員／講師は同じ塾の講師・運営と担当の生徒／生徒は担当の講師
create policy "profiles select" on public.profiles for select to authenticated
  using (
    id = (select auth.uid())
    or (school_id = (select private.my_school()) and (
         (select private.is_school_admin())
      or ((select private.my_role()) = 'coach' and (role in ('coach', 'admin') or private.is_coach_of(id)))
      or ((select private.my_role()) = 'student' and private.is_my_coach(id))))
  );
create policy "profiles update" on public.profiles for update to authenticated
  using (id = (select auth.uid()) or ((select private.is_school_admin()) and school_id = (select private.my_school())))
  with check (school_id = (select private.my_school()));

-- students
create policy "students select" on public.students for select to authenticated
  using (private.can_view_student(id));
create policy "students update" on public.students for update to authenticated
  using (private.can_manage_student(id)) with check (private.can_manage_student(id));

-- coach_notes（生徒本人は入らない）
create policy "coach_notes select" on public.coach_notes for select to authenticated using (private.can_manage_student(student_id));
create policy "coach_notes insert" on public.coach_notes for insert to authenticated with check (private.can_manage_student(student_id));
create policy "coach_notes update" on public.coach_notes for update to authenticated using (private.can_manage_student(student_id)) with check (private.can_manage_student(student_id));
create policy "coach_notes delete" on public.coach_notes for delete to authenticated using (private.can_manage_student(student_id));

-- coach_assignments
create policy "coach_assignments select" on public.coach_assignments for select to authenticated
  using (coach_id = (select auth.uid()) or student_id = (select auth.uid())
      or ((select private.is_school_admin()) and school_id = (select private.my_school())));
create policy "coach_assignments insert" on public.coach_assignments for insert to authenticated
  with check ((select private.is_school_admin()) and school_id = (select private.my_school()));
create policy "coach_assignments delete" on public.coach_assignments for delete to authenticated
  using ((select private.is_school_admin()) and school_id = (select private.my_school()));

-- materials / material_units：同じ塾なら見られる。登録と変更は運営
create policy "materials select" on public.materials for select to authenticated using (school_id = (select private.my_school()));
create policy "materials insert" on public.materials for insert to authenticated with check ((select private.is_school_admin()) and school_id = (select private.my_school()));
create policy "materials update" on public.materials for update to authenticated
  using ((select private.is_school_admin()) and school_id = (select private.my_school())) with check (school_id = (select private.my_school()));
create policy "materials delete" on public.materials for delete to authenticated using ((select private.is_school_admin()) and school_id = (select private.my_school()));

create policy "material_units select" on public.material_units for select to authenticated using (school_id = (select private.my_school()));
create policy "material_units insert" on public.material_units for insert to authenticated with check ((select private.is_school_admin()) and school_id = (select private.my_school()));
create policy "material_units update" on public.material_units for update to authenticated
  using ((select private.is_school_admin()) and school_id = (select private.my_school())) with check (school_id = (select private.my_school()));
create policy "material_units delete" on public.material_units for delete to authenticated using ((select private.is_school_admin()) and school_id = (select private.my_school()));

-- quiz_versions：講師と運営（小テストの登録は講師の画面）
create policy "quiz_versions select" on public.quiz_versions for select to authenticated using ((select private.is_staff()) and school_id = (select private.my_school()));
create policy "quiz_versions insert" on public.quiz_versions for insert to authenticated with check ((select private.is_staff()) and school_id = (select private.my_school()));
create policy "quiz_versions update" on public.quiz_versions for update to authenticated
  using ((select private.is_staff()) and school_id = (select private.my_school())) with check (school_id = (select private.my_school()));
create policy "quiz_versions delete" on public.quiz_versions for delete to authenticated using ((select private.is_staff()) and school_id = (select private.my_school()));

-- student_books：目標日は面談で決める（生徒は見るだけ）
create policy "student_books select" on public.student_books for select to authenticated using (private.can_view_student(student_id));
create policy "student_books insert" on public.student_books for insert to authenticated with check (private.can_manage_student(student_id));
create policy "student_books update" on public.student_books for update to authenticated using (private.can_manage_student(student_id)) with check (private.can_manage_student(student_id));
create policy "student_books delete" on public.student_books for delete to authenticated using (private.can_manage_student(student_id));

-- study_slots：生徒本人も講師も書ける（講師は「勉強できる時間を直す」）
create policy "study_slots select" on public.study_slots for select to authenticated using (private.can_view_student(student_id));
create policy "study_slots insert" on public.study_slots for insert to authenticated with check (private.can_view_student(student_id));
create policy "study_slots update" on public.study_slots for update to authenticated using (private.can_view_student(student_id)) with check (private.can_view_student(student_id));
create policy "study_slots delete" on public.study_slots for delete to authenticated using (private.can_view_student(student_id));

create policy "study_slot_skips select" on public.study_slot_skips for select to authenticated
  using (exists (select 1 from public.study_slots s where s.id = slot_id and private.can_view_student(s.student_id)));
create policy "study_slot_skips insert" on public.study_slot_skips for insert to authenticated
  with check (exists (select 1 from public.study_slots s where s.id = slot_id and private.can_view_student(s.student_id)));
create policy "study_slot_skips delete" on public.study_slot_skips for delete to authenticated
  using (exists (select 1 from public.study_slots s where s.id = slot_id and private.can_view_student(s.student_id)));

-- tasks：生徒は見るだけ（始める・完了などは関数から）。講師と運営が入れて直す
create policy "tasks select" on public.tasks for select to authenticated using (private.can_view_student(student_id));
create policy "tasks insert" on public.tasks for insert to authenticated with check (private.can_manage_student(student_id));
create policy "tasks update" on public.tasks for update to authenticated using (private.can_manage_student(student_id)) with check (private.can_manage_student(student_id));
create policy "tasks delete" on public.tasks for delete to authenticated using (private.can_manage_student(student_id));

-- task_feedback：生徒本人の声。講師は見るだけ
create policy "task_feedback select" on public.task_feedback for select to authenticated using (private.can_view_student(student_id));
create policy "task_feedback insert" on public.task_feedback for insert to authenticated
  with check (student_id = (select auth.uid()) and (select private.my_role()) = 'student');
create policy "task_feedback update" on public.task_feedback for update to authenticated
  using (student_id = (select auth.uid())) with check (student_id = (select auth.uid()));
create policy "task_feedback delete" on public.task_feedback for delete to authenticated using (student_id = (select auth.uid()));

-- task_replies：講師の返信。生徒は見るだけ
create policy "task_replies select" on public.task_replies for select to authenticated using (private.can_view_student(student_id));
create policy "task_replies insert" on public.task_replies for insert to authenticated with check (private.can_manage_student(student_id));
create policy "task_replies update" on public.task_replies for update to authenticated using (private.can_manage_student(student_id)) with check (private.can_manage_student(student_id));
create policy "task_replies delete" on public.task_replies for delete to authenticated using (private.can_manage_student(student_id));

-- review_skips
create policy "review_skips select" on public.review_skips for select to authenticated using (private.can_view_student(student_id));
create policy "review_skips insert" on public.review_skips for insert to authenticated with check (private.can_manage_student(student_id));
create policy "review_skips delete" on public.review_skips for delete to authenticated using (private.can_manage_student(student_id));

-- coach_open_slots / booking_settings：講師本人と運営が書く。担当の生徒は見られる（予約のため）
create policy "coach_open_slots select" on public.coach_open_slots for select to authenticated
  using (coach_id = (select auth.uid()) or private.is_my_coach(coach_id)
      or ((select private.is_school_admin()) and school_id = (select private.my_school())));
create policy "coach_open_slots insert" on public.coach_open_slots for insert to authenticated
  with check (coach_id = (select auth.uid()) or ((select private.is_school_admin()) and school_id = (select private.my_school())));
create policy "coach_open_slots update" on public.coach_open_slots for update to authenticated
  using (coach_id = (select auth.uid()) or ((select private.is_school_admin()) and school_id = (select private.my_school())))
  with check (coach_id = (select auth.uid()) or ((select private.is_school_admin()) and school_id = (select private.my_school())));
create policy "coach_open_slots delete" on public.coach_open_slots for delete to authenticated
  using (coach_id = (select auth.uid()) or ((select private.is_school_admin()) and school_id = (select private.my_school())));

create policy "booking_settings select" on public.booking_settings for select to authenticated
  using (coach_id = (select auth.uid()) or private.is_my_coach(coach_id)
      or ((select private.is_school_admin()) and school_id = (select private.my_school())));
create policy "booking_settings insert" on public.booking_settings for insert to authenticated
  with check (coach_id = (select auth.uid()) or ((select private.is_school_admin()) and school_id = (select private.my_school())));
create policy "booking_settings update" on public.booking_settings for update to authenticated
  using (coach_id = (select auth.uid()) or ((select private.is_school_admin()) and school_id = (select private.my_school())))
  with check (coach_id = (select auth.uid()) or ((select private.is_school_admin()) and school_id = (select private.my_school())));

-- meetings：生徒は見るだけ（予約・取り消しは締め切りを確かめる関数から）。講師と運営は直接書ける
create policy "meetings select" on public.meetings for select to authenticated
  using (student_id = (select auth.uid()) or coach_id = (select auth.uid()) or private.can_manage_student(student_id));
create policy "meetings insert" on public.meetings for insert to authenticated
  with check (private.can_manage_student(student_id) and (coach_id = (select auth.uid()) or (select private.is_school_admin())));
create policy "meetings update" on public.meetings for update to authenticated
  using (private.can_manage_student(student_id))
  with check (private.can_manage_student(student_id) and (coach_id = (select auth.uid()) or (select private.is_school_admin())));
create policy "meetings delete" on public.meetings for delete to authenticated using (private.can_manage_student(student_id));

-- resources：全員向けか自分向け。配るのは講師と運営
create policy "resources select" on public.resources for select to authenticated
  using (school_id = (select private.my_school())
     and ((select private.is_staff()) or target_student_id is null or target_student_id = (select auth.uid())));
create policy "resources insert" on public.resources for insert to authenticated with check ((select private.is_staff()) and school_id = (select private.my_school()));
create policy "resources update" on public.resources for update to authenticated
  using ((select private.is_staff()) and school_id = (select private.my_school())) with check (school_id = (select private.my_school()));
create policy "resources delete" on public.resources for delete to authenticated using ((select private.is_staff()) and school_id = (select private.my_school()));

-- chat_messages：生徒本人だけ。Actifyくんの返事はサーバ（service_role）が書く
create policy "chat_messages select" on public.chat_messages for select to authenticated using (student_id = (select auth.uid()));
create policy "chat_messages insert" on public.chat_messages for insert to authenticated
  with check (student_id = (select auth.uid()) and sender = 'student' and (select private.my_role()) = 'student');

-- ai_calls：運営が原価を見る。書くのはサーバだけ
create policy "ai_calls select" on public.ai_calls for select to authenticated
  using ((select private.is_school_admin()) and school_id = (select private.my_school()));
