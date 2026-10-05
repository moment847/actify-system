-- 点検で見つけた穴（2026-10-05）
-- 1. 保護者の行を別の生徒に付け替えられた（A の保護者の LINE に B の週の報告が届く）。生徒の付け替えは止める（消して作り直す）
-- 2. 成績の行も別の生徒に移せた。同じく止める
-- 3. 通知の url の検査がタブ・改行を通していた（'/\t/evil' はブラウザが '//evil' と読む）。空白類と \ を禁じる

create or replace function private.guard_guardian() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.line_user_id is not null or new.linked_at is not null then
      raise exception 'LINE のつながりは、保護者が合言葉を送ったときにだけ入ります' using errcode = '42501';
    end if;
    new.link_code := private.new_link_code(); new.link_code_expires_at := now() + interval '14 days';
    return new;
  end if;
  if new.student_id is distinct from old.student_id then
    raise exception '保護者を別の生徒に移すことはできません（削除して、その生徒に追加してください）' using errcode = '42501';
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

create function private.guard_exam_result() returns trigger
language plpgsql set search_path = '' as $$
begin
  if current_user in ('authenticated', 'anon') and new.student_id is distinct from old.student_id then
    raise exception '成績を別の生徒に移すことはできません' using errcode = '42501';
  end if;
  return new;
end $$;
create trigger guard_exam_result before update on public.exam_results for each row execute function private.guard_exam_result();

alter table public.notifications drop constraint notifications_url_check;
alter table public.notifications add constraint notifications_url_check check (url = '/' or (url ~ '^/[^/\\]' and url !~ '[\s\\]'));
