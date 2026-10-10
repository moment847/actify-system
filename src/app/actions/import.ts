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
/**
 * 1回の登録で使ってよい時間。関数は時間で切られる（Vercel の既定 60〜300 秒）。切られると作りかけの人が残るので、
 * 手前で止めて「続きがあります」と返す。同じファイルでもう一度「登録」を押すと、登録済みの人を飛ばして続きから作る
 */
const COMMIT_BUDGET_MS = 45_000;
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

/** 「もう登録されています」と言ってよいのは自分の塾の人だけ（ほかの塾に居るかどうかは教えない） */
async function schoolEmails(admin: Admin, schoolId: string, emails: Map<string, string>): Promise<string[]> {
  // PostgREST は1回に1,000行まで。1,000人を超える塾で、登録済みの人を「登録できません」にしていた
  const ids = new Set<string>();
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('profiles').select('id').eq('school_id', schoolId).order('id').range(from, from + 999);
    if (error) throw new Error(error.message);
    (data ?? []).forEach(p => ids.add(p.id));
    if (!data || data.length < 1000) break;
  }
  return [...emails].filter(([, id]) => ids.has(id)).map(([e]) => e);
}

export async function previewStudentImport(form: FormData): Promise<Result<ImportPreview & { digest: string }>> {
  return withActor(['admin'], async ({ actor }) => {
    const f = await readFile(form);
    if (typeof f === 'string') return fail(f);
    const admin = createAdminClient();
    const emails = await allEmails(admin);
    const p = previewImport(f.text, await coachesOf(admin, actor.schoolId, emails), await schoolEmails(admin, actor.schoolId, emails));
    if (p.missingHeaders.length) return fail(`1行目に「${p.missingHeaders.map(h => (h === 'name' ? '名前' : 'メール')).join('」「')}」の列が要ります`);
    return ok(undefined, { ...p, digest: f.digest });
  });
}

export async function commitStudentImport(form: FormData): Promise<Result<{ created: number; failed: { line: number; text: string }[]; remaining: number }>> {
  return withActor(['admin'], async ({ actor }) => {
    const f = await readFile(form);
    if (typeof f === 'string') return fail(f);
    if (form.get('digest') !== f.digest) return fail('下見のあとでファイルが変わりました。もう一度下見してください');
    const admin = createAdminClient();
    const emails = await allEmails(admin);
    const p = previewImport(f.text, await coachesOf(admin, actor.schoolId, emails), await schoolEmails(admin, actor.schoolId, emails));
    if (!p.rows.length) return fail('登録できる行がありません');
    // 下見のあとで問題になった行（講師が退会した・その間に登録された など）も、黙って飛ばさずに返す
    // 「もう登録されています（飛ばします）」は前の回に登録した人（続きから登録するとき）なので数えない
    const failed: { line: number; text: string }[] = p.problems.filter(x => !x.text.endsWith('（飛ばします）')).map(x => ({ line: x.line, text: x.text }));
    let created = 0, remaining = 0;
    const started = Date.now();
    for (const [i, row] of p.rows.entries()) {
      if (Date.now() - started > COMMIT_BUDGET_MS) { remaining = p.rows.length - i; break; }
      const why = await createStudent(admin, actor.schoolId, row, emails);
      if (why) failed.push({ line: row.line, text: why }); else created++;
    }
    failed.sort((a, b) => a.line - b.line);
    console.info('[import]', JSON.stringify({ school: actor.schoolId, by: actor.id, created, failed: failed.length, digest: f.digest }));
    revalidatePath('/', 'layout');
    const more = remaining ? `。まだ${remaining}人残っています。同じファイルでもう一度「登録」を押すと続きから登録します` : '';
    return ok(`${created}人を登録しました${failed.length ? `（${failed.length}行は登録しませんでした）` : ''}${more}。生徒はログイン画面の「はじめての方・パスワードを忘れた方」からパスワードを決めます`, { created, failed, remaining });
  });
}

/** 1人を作る。途中で失敗したら、作った分を消して元に戻す（同じ CSV で登録し直せるように） */
async function createStudent(admin: Admin, schoolId: string, r: ImportRow, emails: Map<string, string>): Promise<string | null> {
  let { data, error } = await admin.auth.admin.createUser({ email: r.email, email_confirm: true });
  // 前の登録が途中で切られて、認証のユーザーだけが残っている（プロフィールがどの塾にも無い・10分以上前）なら、消して作り直す。
  // 以前はこの人を二度と登録できず、運営からも見えなかった
  const orphan = emails.get(r.email.toLowerCase());
  if ((error || !data.user) && orphan) {
    const [{ data: prof }, { data: u }] = await Promise.all([
      admin.from('profiles').select('id').eq('id', orphan).maybeSingle(),
      admin.auth.admin.getUserById(orphan),
    ]);
    if (!prof && u.user && Date.now() - Date.parse(u.user.created_at) > 10 * 60_000) {
      await admin.auth.admin.deleteUser(orphan);
      ({ data, error } = await admin.auth.admin.createUser({ email: r.email, email_confirm: true }));
    }
  }
  // ほかの塾に同じメールがあるときもここで落ちる。理由は言わない（ほかの塾の登録の有無を教えない）
  if (error || !data.user) return `${r.email} は登録できませんでした（別のメールアドレスで登録するか、Actify の運営にお問い合わせください）`;
  const uid = data.user.id;
  const undo = async (e: { message?: string; code?: string }) => { await admin.auth.admin.deleteUser(uid); return dbError(e); };
  const { error: e1 } = await admin.from('profiles').insert({ id: uid, school_id: schoolId, role: 'student', display_name: r.name });
  if (e1) return undo(e1);
  const undoAll = async (e: { message?: string; code?: string }) => { await admin.from('profiles').delete().eq('id', uid); return undo(e); };
  const { error: e2 } = await admin.from('students').insert({ id: uid, school_id: schoolId, grade: r.grade, goal_school: r.goalSchool, goal_faculty: r.goalFaculty, exam_on: r.examOn });
  if (e2) return undoAll(e2);
  // 講師のメモ・担当・保護者のどれかが入らなければ、その人ごと作り直せるように消す（半端な生徒を残さない）
  const { error: e4 } = await admin.from('coach_notes').insert({ student_id: uid, school_id: schoolId, memo: '' });
  if (e4) return undoAll(e4);
  const coaches = [r.mainCoachId, ...r.subCoachIds].filter((x): x is string => !!x);
  if (coaches.length) {
    const { error: e3 } = await admin.from('coach_assignments').insert(coaches.map((c, i) => ({ coach_id: c, student_id: uid, school_id: schoolId, is_main: i === 0 })));
    if (e3) return undoAll(e3);
  }
  if (r.guardian) {
    const { error: e5 } = await admin.from('guardians').insert({ student_id: uid, school_id: schoolId, name: r.guardian.name, relation: r.guardian.relation });
    if (e5) return undoAll(e5);
  }
  return null;
}
