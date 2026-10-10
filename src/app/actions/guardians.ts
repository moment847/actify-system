'use server';
// 保護者（LINE の週の報告）。担当の講師と運営が扱う（生徒本人には見せない）
import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { loadStudents, loadWorld } from '@/lib/data/load';
import { weekStart } from '@/lib/domain/dates';
import { buildWeeklyReport } from '@/lib/domain/weekly-report';
import { changed, dbError, fail, ok, withActor, zId, type Result } from '@/server/result';

const done = () => revalidatePath('/', 'layout');
const Name = z.string().trim().min(1, '名前を入れてください').max(60);
const Relation = z.string().trim().max(20);

export interface GuardianRow {
  id: string; name: string; relation: string; linked: boolean; linkedAt: string | null;
  /** つながる前だけ出す（つながったあとは使い捨てで無効） */
  code: string | null; codeExpires: string | null; weeklyReport: boolean;
  last: { week: string; status: 'sent' | 'failed' | 'skipped'; error: string | null } | null;
}

/** 生徒の保護者の一覧と、塾の LINE の友だち追加の ID */
export async function guardiansOf(studentId: string): Promise<Result<{ guardians: GuardianRow[]; lineBasicId: string | null; lineReady: boolean }>> {
  return withActor(['coach', 'admin'], async ({ sb, actor }) => {
    const sid = zId.parse(studentId);
    const [{ data: gs, error }, { data: school }, { data: reps }, { data: line }] = await Promise.all([
      sb.from('guardians').select('id, name, relation, line_user_id, linked_at, link_code, link_code_expires_at, weekly_report').eq('student_id', sid).order('created_at'),
      sb.from('schools').select('line_basic_id').eq('id', actor.schoolId).single(),
      sb.from('weekly_reports').select('guardian_id, week_start, status, error').eq('student_id', sid).order('week_start', { ascending: false }).limit(50),
      sb.rpc('line_ready'),
    ]);
    if (error) return fail(dbError(error));
    const guardians = (gs ?? []).map(g => {
      const r = reps?.find(x => x.guardian_id === g.id);
      return { id: g.id, name: g.name, relation: g.relation, linked: !!g.line_user_id, linkedAt: g.linked_at,
        code: g.line_user_id ? null : g.link_code, codeExpires: g.line_user_id ? null : g.link_code_expires_at, weeklyReport: g.weekly_report,
        last: r ? { week: r.week_start, status: r.status, error: r.error } : null };
    });
    return ok(undefined, { guardians, lineBasicId: school?.line_basic_id ?? null, lineReady: line === true });
  });
}

export async function addGuardian(input: { studentId: string; name: string; relation?: string }): Promise<Result<{ id: string; code: string }>> {
  return withActor(['coach', 'admin'], async ({ sb }) => {
    const v = z.object({ studentId: zId, name: Name, relation: Relation.optional() }).parse(input);
    const { data, error } = await sb.from('guardians').insert({ student_id: v.studentId, name: v.name, relation: v.relation ?? '' }).select('id, link_code').single();
    if (error) return fail(dbError(error));
    done();
    return ok('保護者を追加しました。合言葉を保護者に渡してください（14日間有効）', { id: data.id, code: data.link_code });
  });
}

export async function updateGuardian(input: { id: string; name?: string; relation?: string; weeklyReport?: boolean }): Promise<Result> {
  return withActor(['coach', 'admin'], async ({ sb }) => {
    const v = z.object({ id: zId, name: Name.optional(), relation: Relation.optional(), weeklyReport: z.boolean().optional() }).parse(input);
    const patch: Record<string, unknown> = {};
    if (v.name !== undefined) patch.name = v.name;
    if (v.relation !== undefined) patch.relation = v.relation;
    if (v.weeklyReport !== undefined) patch.weekly_report = v.weeklyReport;
    const bad = changed(await sb.from('guardians').update(patch, { count: 'exact' }).eq('id', v.id), '保護者が見つかりません');
    if (bad) return fail(bad);
    done();
    return ok(v.weeklyReport === false ? '週の報告を止めました' : v.weeklyReport ? '週の報告を送るようにしました' : '保存しました');
  });
}

/** 合言葉を作り直す（なくした・期限が切れた）。前の合言葉は使えなくなる */
export async function renewLinkCode(id: string): Promise<Result<{ code: string }>> {
  return withActor(['coach', 'admin'], async ({ sb }) => {
    const { data, error } = await sb.rpc('renew_link_code', { p_guardian: zId.parse(id) });
    if (error) return fail(dbError(error));
    done();
    return ok('新しい合言葉を作りました（14日間有効）', { code: data as string });
  });
}

/** LINE とのつながりを外す（保護者が LINE を変えた・別の人がつないだ）。合言葉を作り直して、もう一度つなげる */
export async function unlinkGuardian(id: string): Promise<Result> {
  return withActor(['coach', 'admin'], async ({ sb }) => {
    const gid = zId.parse(id);
    const bad = changed(await sb.from('guardians').update({ line_user_id: null, linked_at: null }, { count: 'exact' }).eq('id', gid), '保護者が見つかりません');
    if (bad) return fail(bad);
    const { error } = await sb.rpc('renew_link_code', { p_guardian: gid });
    done();
    // 外したあとで合言葉を作り直せなかったら、そう言う（以前は使えない古い合言葉が画面に残った）
    if (error) return fail(`LINE とのつながりは外しましたが、新しい合言葉を作れませんでした（${dbError(error)}）。「合言葉を作り直す」を押してください`);
    return ok('LINE とのつながりを外しました。もう一度つなぐには、新しい合言葉を渡してください');
  });
}

export async function removeGuardian(id: string): Promise<Result> {
  return withActor(['coach', 'admin'], async ({ sb }) => {
    const r = await sb.from('guardians').delete({ count: 'exact' }).eq('id', zId.parse(id));
    const bad = changed(r, '保護者が見つかりません');
    if (bad) return fail(bad);
    done();
    return ok('保護者を削除しました（LINE の友だちは保護者の側で解除されるまで残ります）');
  });
}

/** 次の日曜に届く週の報告の文面（送らずに見るだけ） */
export async function previewWeeklyReport(studentId: string): Promise<Result<{ text: string; week: string }>> {
  return withActor(['coach', 'admin'], async ({ sb, actor }) => {
    const sid = zId.parse(studentId);
    const [st] = (await loadStudents(sb, actor)).filter(s => s.id === sid);
    if (!st) return fail('生徒が見つかりません');
    const { data: p } = await sb.from('profiles').select('timezone').eq('id', sid).single();
    const tz = p?.timezone || actor.timeZone;
    const me = { ...actor, timeZone: tz };
    const w = await loadWorld(sb, me, [sid]);
    // 次の日曜の夜に送る週＝今日を含む週（今日までの分で作る）
    const week = weekStart(w.today);
    return ok(undefined, { text: buildWeeklyReport(w, sid, { studentName: st.name, schoolName: actor.schoolName, week }).text, week });
  });
}
