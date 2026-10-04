import { createAdminClient } from '@/lib/supabase/admin';
import { localToday } from '@/lib/domain/dates';
import { cronRun } from '@/server/cron';
import { syncSeats } from '@/server/billing';

// 塾の月額の数量（在籍中の生徒の数）を Stripe に合わせる。1日1回
export const maxDuration = 120;
const run = (req: Request) => cronRun(req, 'billing', () => syncSeats(createAdminClient(), localToday('Asia/Tokyo')));
export { run as GET, run as POST };
