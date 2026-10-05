import { createAdminClient } from '@/lib/supabase/admin';
import { localToday } from '@/lib/domain/dates';
import { cronRun } from '@/server/cron';
import { syncSeats } from '@/server/billing';

// 塾の月額の数量（在籍中の生徒の数）を Stripe に合わせる。1日1回。
// あわせて、途中で関数が切られて宙に浮いた AI の予約（pending）を閉じる（原価は見込み額のまま＝高い側に残す）
export const maxDuration = 120;
const run = (req: Request) => cronRun(req, 'billing', async () => {
  const admin = createAdminClient();
  const abandoned = await admin.from('ai_calls').update({ status: 'done', error: 'abandoned' }, { count: 'exact' })
    .eq('status', 'pending').lt('created_at', new Date(Date.now() - 10 * 60_000).toISOString());
  return { ...(await syncSeats(admin, localToday('Asia/Tokyo'))), abandonedAiCalls: abandoned.count ?? 0 };
});
export { run as GET, run as POST };
