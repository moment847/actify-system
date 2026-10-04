import { createAdminClient } from '@/lib/supabase/admin';
import { cronRun } from '@/server/cron';
import { runWeeklyReports } from '@/server/jobs/weekly-reports';

// 保護者への週の報告。日曜 20:00（日本時間）に1回。送り直しても同じ週には二度届かない
export const maxDuration = 300;
const run = (req: Request) => cronRun(req, 'weekly-reports', () => runWeeklyReports(createAdminClient()));
export { run as GET, run as POST };
