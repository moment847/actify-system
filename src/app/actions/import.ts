'use server';
// 生徒の一括登録（CSV）。運営だけ。
// 1. 下見（previewStudentImport）：ファイルを読み、登録できる行と問題のある行を返す。何も作らない
// 2. 登録（commitStudentImport）：同じファイルをもう一度受け取り、サーバで読み直してから作る（画面から来た行は信じない）
// アカウントは招待メールを送らずに作る（Supabase のメールは1時間あたりの上限があり、100人分は送れない）。
// 生徒はログイン画面の「はじめての方・パスワードを忘れた方」から、自分のメールでパスワードを決める
import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { decodeCsv, previewImport, type CoachRef, type ImportPreview, type ImportRow } from '@/lib/domain/csv';
import { createAdminClient } from '@/lib/supabase/admin';
import { dbError, fail, ok, withActor, type Result } from '@/server/result';

const MAX_BYTES = 1024 * 1024;
type Admin = ReturnType<typeof createAdminClient>;

async function readFile(form: FormData): Promise<{ text: string; digest: string } | string> {
  const f = form.get('file');
  if (!(f instanceof File)) return 'CSV ファイルを選んでください';
  if (f.size > MAX_BYTES) return 'ファイルが大きすぎます（1MB まで）';
  const bytes = new Uint8Array(await f.arrayBuffer());
  return { text: decodeCsv(bytes), digest: createHash('sha256').update(bytes).digest('hex') };
}

/** 認証のユーザー全員のメール（大文字小文字は無視）。1,000人ずつ読む */
async function allEmails(admin: Admin): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let page = 1; ; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error(error.message);
    data.users.forEach(u => u.email && out.set(u.email.toLowerCase(), u.id));
    if (data.users.length < 1000) return out;
  }
}

async function coachesOf(admin: Admin, schoolId: string, emails: Map<string, string>): Promise<CoachRef[]> {
  const { data } = await admin.from('profiles').select('id, display_name').eq('school_id', schoolId).eq('role', 'coach').eq('status', 'active');
  const byId = new Map([...emails].map(([e, id]) => [id, e]));
  return (data ?? []).map(c => ({ id: c.id, name: c.display_name, email: byId.get(c.id) ?? '' }));
}

export async function previewStudentImport(form: FormData): Promise<Result<ImportPreview & { digest: string }>> {
  return withActor(['admin'], async ({ actor }) => {
    const f = await readFile(form);
    if (typeof f === 'string') return fail(f);
    const admin = createAdminClient();
    const emails = await allEmails(admin);
    const p = previewImport(f.text, await coachesOf(admin, actor.schoolId, emails), emails.keys());
    if (p.missingHeaders.length) return fail(`1行目に「${p.missingHeaders.map(h => (h === 'name' ? '名前' : 'メール')).join('」「')}」の列が要ります`);
    return ok(undefined, { ...p, digest: f.digest });
  });
}

export async function commitStudentImport(form: FormData): Promise<Result<{ created: number; failed: { line: number; text: string }[] }>> {
  return withActor(['admin'], async ({ actor }) => {
    const f = await readFile(form);
    if (typeof f === 'string') return fail(f);
    if (form.get('digest') !== f.digest) return fail('下見のあとでファイルが変わりました。もう一度下見してください');
    const admin = createAdminClient();
    const emails = await allEmails(admin);
    const p = previewImport(f.text, await coachesOf(admin, actor.schoolId, emails), emails.keys());
    if (!p.rows.length) return fail('登録できる行がありません');
    const failed: { line: number; text: string }[] = [];
    let created = 0;
    for (const row of p.rows) {
      const why = await createStudent(admin, actor.schoolId, row);
      if (why) failed.push({ line: row.line, text: why }); else created++;
    }
    console.info('[import]', JSON.stringify({ school: actor.schoolId, by: actor.id, created, failed: failed.length, digest: f.digest }));
    revalidatePath('/', 'layout');
    return ok(`${created}人を登録しました${failed.length ? `（${failed.length}人は登録できませんでした）` : ''}。生徒はログイン画面の「はじめての方・パスワードを忘れた方」からパスワードを決めます`, { created, failed });
  });
}

/** 1人を作る。途中で失敗したら、作った分を消して元に戻す（同じ CSV で登録し直せるように） */
async function createStudent(admin: Admin, schoolId: string, r: ImportRow): Promise<string | null> {
  const { data, error } = await admin.auth.admin.createUser({ email: r.email, email_confirm: true });
  if (error || !data.user) return error?.message?.includes('already') ? `${r.email} はもう登録されています` : 'アカウントを作れませんでした';
  const uid = data.user.id;
  const undo = async (e: { message?: string; code?: string }) => { await admin.auth.admin.deleteUser(uid); return dbError(e); };
  const { error: e1 } = await admin.from('profiles').insert({ id: uid, school_id: schoolId, role: 'student', display_name: r.name });
  if (e1) return undo(e1);
  const { error: e2 } = await admin.from('students').insert({ id: uid, school_id: schoolId, grade: r.grade, goal_school: r.goalSchool, goal_faculty: r.goalFaculty, exam_on: r.examOn });
  if (e2) { await admin.from('profiles').delete().eq('id', uid); return undo(e2); }
  await admin.from('coach_notes').insert({ student_id: uid, school_id: schoolId, memo: '' });
  const coaches = [r.mainCoachId, ...r.subCoachIds].filter((x): x is string => !!x);
  if (coaches.length) {
    const { error: e3 } = await admin.from('coach_assignments').insert(coaches.map((c, i) => ({ coach_id: c, student_id: uid, school_id: schoolId, is_main: i === 0 })));
    if (e3) { await admin.from('profiles').delete().eq('id', uid); return undo(e3); }
  }
  if (r.guardian) await admin.from('guardians').insert({ student_id: uid, school_id: schoolId, name: r.guardian.name, relation: r.guardian.relation });
  return null;
}
