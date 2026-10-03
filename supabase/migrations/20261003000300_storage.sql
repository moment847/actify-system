-- Actify：ファイル置き場（Supabase Storage）
--
-- どの置き場も非公開。パスは「塾のID/…」で始める（チャットの写真は「塾のID/生徒のID/…」）。
-- 生徒が小テストのPDF・配られた資料を開くときは、サーバがその生徒の予定・資料かを確かめてから
-- 期限つきのURL（署名付きURL）を作る。生徒が置き場を直接のぞいて、先の小テストの解答を見ることはできない。

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types) values
  ('quiz-pdfs', 'quiz-pdfs', false, 20971520, array['application/pdf']),
  ('resources', 'resources', false, 20971520, null),
  ('toc-images', 'toc-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic']),
  ('chat-images', 'chat-images', false, 10485760, array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do nothing;

create policy "actify objects select" on storage.objects for select to authenticated
  using (
    ((bucket_id in ('quiz-pdfs', 'resources', 'toc-images'))
      and (storage.foldername(name))[1] = (select private.my_school())::text
      and (select private.is_staff()))
    or (bucket_id = 'chat-images'
      and (storage.foldername(name))[1] = (select private.my_school())::text
      and (storage.foldername(name))[2] = (select auth.uid())::text)
  );

create policy "actify objects insert" on storage.objects for insert to authenticated
  with check (
    ((bucket_id in ('quiz-pdfs', 'resources'))
      and (storage.foldername(name))[1] = (select private.my_school())::text
      and (select private.is_staff()))
    or (bucket_id = 'toc-images'
      and (storage.foldername(name))[1] = (select private.my_school())::text
      and (select private.is_school_admin()))
    or (bucket_id = 'chat-images'
      and (storage.foldername(name))[1] = (select private.my_school())::text
      and (storage.foldername(name))[2] = (select auth.uid())::text
      and (select private.my_role()) = 'student')
  );

create policy "actify objects delete" on storage.objects for delete to authenticated
  using (
    (bucket_id in ('quiz-pdfs', 'resources', 'toc-images'))
    and (storage.foldername(name))[1] = (select private.my_school())::text
    and (select private.is_staff())
  );
