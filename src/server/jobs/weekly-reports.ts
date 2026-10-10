import 'server-only';
// 保護者への週の報告（日曜の夜に定期処理から）。
// - 送るのは：LINE がつながっていて、週の報告を「送る」にしている保護者。生徒が在籍中のときだけ
// - 同じ保護者・同じ週には一度だけ（weekly_reports の (保護者, 週) が一意。LINE 側も Retry-Key で一度だけ届く）
// - 送れなかった週は 'failed' で残し、次の実行で送り直す（月の上限に達したときは、その塾のその週は止める）
// - 送るのは生徒のタイムゾーンで日曜 20:00〜22:59（inReportWindow）。定期処理は世界中の日曜の夜を覆うように、
//   UTC の日曜 6:00〜月曜 11:50 に10分ごとに呼ばれる（vercel.json）。1回の実行は時間の予算（WEEKLY_RUN_BUDGET_MS）で手前で止める
// - 1人の保護者の報告が作れなくても（データの不具合など）、その人を 'failed' で残してほかの保護者に送る
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadWorld, type Actor } from '@/lib/data/load';
import { localToday } from '@/lib/domain/dates';
import { buildWeeklyReport, inReportWindow, reportWeek } from '@/lib/domain/weekly-report';
import { isMonthlyLimit, pushText, retryKeyFor } from '@/lib/integrations/line';
import { loadLineChannel } from '@/server/line-channel';

type ProfileBits = { display_name: string; status: string; timezone: string | null };
type GuardianRow = { id: string; student_id: string; line_user_id: string | null; students: { profiles: ProfileBits | ProfileBits[] } | { profiles: ProfileBits | ProfileBits[] }[] };

export interface WeeklyReportRun { schools: number; sent: number; failed: number; skipped: number; already: number; timedOut: boolean }

/**
 * 1回の実行で使ってよい時間。Vercel の関数は Pro でも 300 秒で切られ、途中で切られると残りの保護者にその週の報告が届かない。
 * 手前で止めて、次の実行（10分後。vercel.json）が続きを送る。送った保護者は weekly_reports に残るので二度は送らない
 */
export const WEEKLY_RUN_BUDGET_MS = 240_000;

export async function runWeeklyReports(admin: SupabaseClient, now = new Date(), budgetMs = WEEKLY_RUN_BUDGET_MS): Promise<WeeklyReportRun> {
  const out: WeeklyReportRun = { schools: 0, sent: 0, failed: 0, skipped: 0, already: 0, timedOut: false };
  const started = Date.now();
  const overBudget = () => Date.now() - started > budgetMs;
  const { data: channels } = await admin.from('school_line_channels').select('school_id');
  for (const { school_id: schoolId } of channels ?? []) {
    if (overBudget()) { out.timedOut = true; break; }
    out.schools++;
    const [{ data: school }, ch] = await Promise.all([
      admin.from('schools').select('name, timezone').eq('id', schoolId).single(),
      loadLineChannel(admin, schoolId).catch(e => { console.error('[weekly] channel', schoolId, e.message); return null; }),
    ]);
    if (!school || !ch) continue;
    // PostgREST は1回に1,000行まで。保護者が1,000人を超える塾で、残りの人に届かなかった
    const gs: GuardianRow[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await admin.from('guardians')
        .select('id, student_id, line_user_id, students!inner(profiles!inner(display_name, status, timezone))')
        .eq('school_id', schoolId).eq('weekly_report', true).not('line_user_id', 'is', null).order('id').range(from, from + 999);
      if (error) throw new Error(error.message);
      gs.push(...((data ?? []) as unknown as GuardianRow[]));
      if (!data || data.length < 1000) break;
    }
    let stop = false;
    const week0 = reportWeek(localToday(school.timezone || 'Asia/Tokyo', now));
    for (const g of gs) {
      if (overBudget()) { out.timedOut = true; break; }
      const st = (Array.isArray(g.students) ? g.students[0] : g.students) as unknown as { profiles: { display_name: string; status: string; timezone: string | null } | { display_name: string; status: string; timezone: string | null }[] };
      const p = Array.isArray(st.profiles) ? st.profiles[0] : st.profiles;
      const timeZone = p.timezone || school.timezone || 'Asia/Tokyo';
      if (!inReportWindow(timeZone, now)) continue;
      const today = localToday(timeZone, now);
      const week = reportWeek(today);
      const { data: prev } = await admin.from('weekly_reports').select('status').eq('guardian_id', g.id).eq('week_start', week).maybeSingle();
      if (prev && prev.status !== 'failed') { out.already++; continue; }
      const record = (status: 'sent' | 'failed' | 'skipped', body: string, error: string | null = null) =>
        admin.from('weekly_reports').upsert({ school_id: schoolId, guardian_id: g.id, student_id: g.student_id, week_start: week, body, status, error }, { onConflict: 'guardian_id,week_start' });
      if (p.status !== 'active') { await record('skipped', '', p.status === 'paused' ? '休会中' : '退会'); out.skipped++; continue; }
      if (stop) { await record('failed', '', 'LINE の月の上限に達しました'); out.failed++; continue; }

      let text = '';
      try {
        const actor: Actor = { id: g.student_id, schoolId, schoolName: school.name, role: 'admin', name: '', timeZone, today };
        const world = await loadWorld(admin, actor, [g.student_id]);
        text = buildWeeklyReport(world, g.student_id, { studentName: p.display_name, schoolName: school.name, week }).text;
        await pushText(ch.token, g.line_user_id!, text, retryKeyFor(`weekly:${g.id}:${week}`));
        await record('sent', text);
        out.sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isMonthlyLimit(e)) stop = true;
        await record('failed', text, msg.slice(0, 300));
        out.failed++;
        console.error('[weekly] guardian failed', { guardian: g.id, message: msg.slice(0, 200) });
      }
    }
    // 塾の運営に、この週の「送った数・送れなかった数」を知らせる。何回かに分けて送るので、数は表（weekly_reports）から数え直して書き換える
    const [{ count: sent }, { count: failed }] = await Promise.all([
      admin.from('weekly_reports').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('week_start', week0).eq('status', 'sent'),
      admin.from('weekly_reports').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('week_start', week0).eq('status', 'failed'),
    ]);
    if (sent || failed) {
      const { data: admins } = await admin.from('profiles').select('id').eq('school_id', schoolId).eq('role', 'admin').eq('status', 'active');
      if (admins?.length) await admin.from('notifications').upsert(admins.map(a => ({
        school_id: schoolId, user_id: a.id, kind: 'report_sent',
        title: failed ? `週の報告：${failed}件送れませんでした` : `週の報告を${sent}件送りました`,
        body: failed ? `送れた${sent ?? 0}件・送れなかった${failed}件。保護者の画面で理由を確かめられます` : '保護者の画面で送った文面を確かめられます',
        url: '/admin', dedupe_key: `report:${week0}`,
      })), { onConflict: 'user_id,dedupe_key' });
    }
  }
  return out;
}
