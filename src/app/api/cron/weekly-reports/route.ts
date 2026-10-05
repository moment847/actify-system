import { createAdminClient } from '@/lib/supabase/admin';
import { cronRun } from '@/server/cron';
import { runWeeklyReports } from '@/server/jobs/weekly-reports';

// 保護者への週の報告。日曜 20:00〜22:50（日本時間）に10分ごと。1回は時間の予算で手前で止め、続きを次の回が送る。同じ週には二度届かない
export const maxDuration = 300;
const run = (req: Request) => cronRun(req, 'weekly-reports', () => runWeeklyReports(createAdminClient()));
export { run as GET, run as POST };
