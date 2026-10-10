-- Actify：面談の予約（book_meeting）と取り消し（cancel_meeting）を本番に入れる手順（プロジェクト actify / bbhqujcjohpjhwghoudf）
--
-- 2026-10-10 から、この2つの関数の最新の版は supabase/migrations/20261010000000_review_fixes_3.sql にある
-- （面談は主担当と・締め切りはタイムゾーンを変えてもすり抜けられない）。
-- そのファイルの中身をまるごと Supabase の SQL Editor に貼って Run すれば、2つの関数も入る。
-- 「行を消す」文を含むため、接続ツールからは承認待ちで止まる。手で流す。
--
-- 以前ここにあった古い版は流さないこと（主担当の確認と締め切りの直しが無い）。

-- 確認：3行出れば完了
select proname from pg_proc where pronamespace in ('public'::regnamespace, 'private'::regnamespace)
  and proname in ('book_meeting', 'cancel_meeting', 'deadline_today');
