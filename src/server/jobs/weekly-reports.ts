import 'server-only';
// 保護者への週の報告（日曜の夜に定期処理から）。
// - 送るのは：LINE がつながっていて、週の報告を「送る」にしている保護者。生徒が在籍中のときだけ
// - 同じ保護者・同じ週には一度だけ（weekly_reports の (保護者, 週) が一意。LINE 側も Retry-Key で一度だけ届く）
// - 送れなかった週は 'failed' で残し、次の実行で送り直す（月の上限に達したときは、その塾のその週は止める）
import type { SupabaseClient } from '@supabase/supabase-js';
import { loadWorld, type Actor } from '@/lib/data/load';
import { localToday } from '@/lib/domain/dates';
import { buildWeeklyReport, reportWeek } from '@/lib/domain/weekly-report';
import { isMonthlyLimit, pushText, retryKeyFor } from '@/lib/integrations/line';
import { loadLineChannel } from '@/server/line-channel';

export interface WeeklyReportRun { schools: number; sent: number; failed: number; skipped: number; already: number }

export async function runWeeklyReports(admin: SupabaseClient, now = new Date()): Promise<WeeklyReportRun> {
  const out: WeeklyReportRun = { schools: 0, sent: 0, failed: 0, skipped: 0, already: 0 };
  const { data: channels } = await admin.from('school_line_channels').select('school_id');
  for (const { school_id: schoolId } of channels ?? []) {
    out.schools++;
    const [{ data: school }, ch] = await Promise.all([
      admin.from('schools').select('name, timezone').eq('id', schoolId).single(),
      loadLineChannel(admin, schoolId).catch(e => { console.error('[weekly] channel', schoolId, e.message); return null; }),
    ]);
    if (!school || !ch) continue;
    const { data: gs } = await admin.from('guardians')
      .select('id, student_id, line_user_id, students!inner(profiles!inner(display_name, status, timezone))')
      .eq('school_id', schoolId).eq('weekly_report', true).not('line_user_id', 'is', null);
    let stop = false;
    const before = { sent: out.sent, failed: out.failed };
    for (const g of gs ?? []) {
      const st = (Array.isArray(g.students) ? g.students[0] : g.students) as unknown as { profiles: { display_name: string; status: string; timezone: string | null } | { display_name: string; status: string; timezone: string | null }[] };
      const p = Array.isArray(st.profiles) ? st.profiles[0] : st.profiles;
      const timeZone = p.timezone || school.timezone || 'Asia/Tokyo';
      const today = localToday(timeZone, now);
      const week = reportWeek(today);
      const { data: prev } = await admin.from('weekly_reports').select('status').eq('guardian_id', g.id).eq('week_start', week).maybeSingle();
      if (prev && prev.status !== 'failed') { out.already++; continue; }
      const record = (status: 'sent' | 'failed' | 'skipped', body: string, error: string | null = null) =>
        admin.from('weekly_reports').upsert({ school_id: schoolId, guardian_id: g.id, student_id: g.student_id, week_start: week, body, status, error }, { onConflict: 'guardian_id,week_start' });
      if (p.status !== 'active') { await record('skipped', '', p.status === 'paused' ? '休会中' : '退会'); out.skipped++; continue; }
      if (stop) { await record('failed', '', 'LINE の月の上限に達しました'); out.failed++; continue; }

      const actor: Actor = { id: g.student_id, schoolId, schoolName: school.name, role: 'admin', name: '', timeZone, today };
      const world = await loadWorld(admin, actor, [g.student_id]);
      const report = buildWeeklyReport(world, g.student_id, { studentName: p.display_name, schoolName: school.name, week });
      try {
        await pushText(ch.token, g.line_user_id!, report.text, retryKeyFor(`weekly:${g.id}:${week}`));
        await record('sent', report.text);
        out.sent++;
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (isMonthlyLimit(e)) stop = true;
        await record('failed', report.text, msg.slice(0, 300));
        out.failed++;
      }
    }
    // 塾の運営に、送った数と送れなかった数を知らせる（同じ週に1回）
    const sent = out.sent - before.sent, failed = out.failed - before.failed;
    if (sent || failed) {
      const week = reportWeek(localToday(school.timezone || 'Asia/Tokyo', now));
      const { data: admins } = await admin.from('profiles').select('id').eq('school_id', schoolId).eq('role', 'admin').eq('status', 'active');
      if (admins?.length) await admin.from('notifications').upsert(admins.map(a => ({
        school_id: schoolId, user_id: a.id, kind: 'report_sent',
        title: failed ? `週の報告：${failed}件送れませんでした` : `週の報告を${sent}件送りました`,
        body: failed ? `送れた${sent}件・送れなかった${failed}件。保護者の画面で理由を確かめられます` : '保護者の画面で送った文面を確かめられます',
        url: '/admin', dedupe_key: `report:${week}`,
      })), { onConflict: 'user_id,dedupe_key', ignoreDuplicates: true });
    }
  }
  return out;
}
