@AGENTS.md

# Actify — 作るときの決まり

サービスの中身は `reference/Actify-サービス全体レポート.md`、画面と動きの正解は `reference/mock-v19/`。先に読むこと。

- 技術：Next.js（App Router・Server Actions）＋ Supabase（Postgres / Auth / Storage / RLS）＋ Anthropic SDK。
- 複数の塾に売る。すべての行に school_id。親子の school_id は複合外部キーでそろえる。school_id はトリガが親から入れる（クライアントの値を使わない）。
- RLS は1テーブル × 1コマンド × 1本（for all を使わない）。役割を足すときは式に OR で足す。`pnpm db:verify` の T24 が縛る。
- security definer 関数は private スキーマに置く。public に置く関数（RPC）は anon から revoke する。
- 計算は `src/lib/domain/` に置き、モックと同じ答えかをテストで確かめる（`parity.test.ts`・`db-parity.test.ts`）。決まりを変えたら `pnpm mock:fixture` の正解データは作り直さない（モックが正解）。モック自体を直したときだけ作り直す。
- 範囲の順番と小テストの版は DB のトリガが必ずそろえる（どこから予定を入れても同じ）。アプリ側の計算は通知の文と見通しのためだけ。
- AI は `src/lib/ai/` 経由だけで呼ぶ。プロンプトは `prompts/` に版つき。呼ぶたびに model・prompt_version・原価（円・整数、切り上げ）を ai_calls に残す。キーが無いときは決まった文の返事に落とす。
- 金額は整数（円）。
- 言葉はネットで普通に使われる言い方にする。造語を作らない。
