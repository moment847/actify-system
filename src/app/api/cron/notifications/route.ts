import { createAdminClient } from '@/lib/supabase/admin';
import { cronRun } from '@/server/cron';
import { runPushNotifications } from '@/server/jobs/push-notifications';

// 時刻で決まる通知を作り、端末に送る。5分ごと（予定の15分前の通知のため）
export const maxDuration = 60;
const run = (req: Request) => cronRun(req, 'notifications', () => runPushNotifications(createAdminClient()));
export { run as GET, run as POST };
