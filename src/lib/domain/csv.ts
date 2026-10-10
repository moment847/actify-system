// 生徒の一括登録の CSV。Excel で保存した CSV は Shift_JIS（「CSV（コンマ区切り）」）か UTF-8（BOM つき）のどちらか。
// 読むだけで、作るのはサーバ（src/app/actions/import.ts）。1行ずつ検査し、問題のある行は理由つきで返す（ほかの行は登録できる）。

/** バイト列を文字にする。BOM か正しい UTF-8 なら UTF-8、そうでなければ Shift_JIS（Excel の既定） */
export function decodeCsv(bytes: Uint8Array): string {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) return new TextDecoder('utf-8').decode(bytes.subarray(3));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('shift_jis').decode(bytes);
  }
}

/** RFC 4180 の CSV（"" で囲んだ中のカンマ・改行、"" のエスケープ）。空の行は捨てる */
export function parseCsv(text: string): string[][] {
  return parseCsvLines(text).map(r => r.cells);
}

/** 行ごとに、ファイルの何行目から始まるか（空の行・セルの中の改行も数える）。問題の行番号を Excel の行番号とそろえる */
export function parseCsvLines(text: string): { cells: string[]; line: number }[] {
  const rows: { cells: string[]; line: number }[] = [];
  let row: string[] = [], cell = '', quoted = false, line = 1, start = 1;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else quoted = false; }
      else { if (c === '\n' || (c === '\r' && s[i + 1] !== '\n')) line++; cell += c; }
    } else if (c === '"' && cell === '') quoted = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); rows.push({ cells: row, line: start }); row = []; cell = ''; line++; start = line;
    } else cell += c;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push({ cells: row, line: start }); }
  return rows.map(r => ({ cells: r.cells.map(x => x.trim()), line: r.line })).filter(r => r.cells.some(x => x !== ''));
}

export type ImportField = 'name' | 'email' | 'grade' | 'goalSchool' | 'goalFaculty' | 'examOn' | 'mainCoach' | 'subCoaches' | 'guardianName' | 'guardianRelation';

/** 見出しの言い方の揺れ（全角・空白は消してから比べる） */
const HEADERS: Record<ImportField, string[]> = {
  name: ['名前', '氏名', '生徒名', '生徒氏名', 'name'],
  email: ['メール', 'メールアドレス', 'mail', 'email', 'e-mail'],
  grade: ['学年', 'grade'],
  goalSchool: ['志望校', '第一志望', '志望大学'],
  goalFaculty: ['学部', '志望学部'],
  examOn: ['受験日', '試験日', '本番'],
  mainCoach: ['担当', '担当講師', '主担当', 'メイン担当'],
  subCoaches: ['副担当', 'サブ担当', '副担当講師'],
  guardianName: ['保護者', '保護者名', '保護者氏名'],
  guardianRelation: ['続柄', '保護者の続柄'],
};
const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, '').toLowerCase();

export interface CoachRef { id: string; name: string; email: string }
export interface ImportRow {
  line: number;
  name: string; email: string; grade: string; goalSchool: string; goalFaculty: string; examOn: string | null;
  mainCoachId: string | null; subCoachIds: string[];
  guardian: { name: string; relation: string } | null;
}
export interface ImportProblem { line: number; text: string }
export interface ImportPreview { rows: ImportRow[]; problems: ImportProblem[]; missingHeaders: ImportField[]; unknownHeaders: string[] }

export const MAX_IMPORT_ROWS = 500;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** 「2027/2/12」「2027-02-12」「2027年2月12日」→ 2027-02-12。実在しない日は null */
export function parseDate(s: string): string | null {
  const m = s.normalize('NFKC').match(/^(\d{4})\s*[/\-.年]\s*(\d{1,2})\s*[/\-.月]\s*(\d{1,2})\s*日?$/);
  if (!m) return null;
  const iso = `${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`;
  const d = new Date(iso + 'T12:00:00Z');
  return !isNaN(+d) && d.toISOString().slice(0, 10) === iso ? iso : null;
}

/** 講師は名前かメールで指定する。同じ名前の講師が2人いれば、メールで書いてもらう */
function findCoach(s: string, coaches: CoachRef[]): CoachRef | 'ambiguous' | null {
  const k = norm(s);
  const byMail = coaches.find(c => norm(c.email) === k);
  if (byMail) return byMail;
  const byName = coaches.filter(c => norm(c.name) === k);
  return byName.length === 1 ? byName[0] : byName.length > 1 ? 'ambiguous' : null;
}

/** 「中村 葵・ジョン・スミス」：つながる部分をできるだけ長く取って講師に当てる（ジョン・スミス を1人として読む） */
function splitDots(s: string, coaches: CoachRef[]): string[] {
  const parts = s.split('・').map(x => x.trim()).filter(Boolean), out: string[] = [];
  for (let i = 0; i < parts.length;) {
    let j = parts.length;
    for (; j > i + 1; j--) if (findCoach(parts.slice(i, j).join('・'), coaches)) break;
    out.push(parts.slice(i, j).join('・')); i = j;
  }
  return out;
}

/**
 * CSV を検査して、登録できる行と問題のある行に分ける。
 * - 必須は「名前」「メール」。ほかの列は無くてもよい
 * - 同じファイルの中で同じメールが2回出たら、2回目を問題にする
 * - すでに使われているメール（existingEmails）は「登録済み」として飛ばす（上書きしない）
 */
export function previewImport(text: string, coaches: CoachRef[], existingEmails: Iterable<string> = []): ImportPreview {
  const lined = parseCsvLines(text), table = lined.map(r => r.cells);
  const head = table[0] ?? [];
  const col: Partial<Record<ImportField, number>> = {}, unknownHeaders: string[] = [];
  head.forEach((h, i) => {
    const f = (Object.keys(HEADERS) as ImportField[]).find(k => HEADERS[k].some(x => norm(x) === norm(h)));
    if (f && col[f] === undefined) col[f] = i; else if (h) unknownHeaders.push(h);
  });
  const missingHeaders = (['name', 'email'] as ImportField[]).filter(f => col[f] === undefined);
  const rows: ImportRow[] = [], problems: ImportProblem[] = [];
  if (missingHeaders.length) return { rows, problems, missingHeaders, unknownHeaders };

  const existing = new Set([...existingEmails].map(e => e.toLowerCase()));
  const seen = new Set<string>();
  const body = table.slice(1);
  if (body.length > MAX_IMPORT_ROWS) problems.push({ line: lined[MAX_IMPORT_ROWS + 1].line, text: `1回に登録できるのは${MAX_IMPORT_ROWS}人までです。${MAX_IMPORT_ROWS + 1}人目からは登録しません` });
  body.slice(0, MAX_IMPORT_ROWS).forEach((r, i) => {
    const line = lined[i + 1].line; // ファイルの行番号（空の行・セルの中の改行も数える）
    const get = (f: ImportField) => (col[f] === undefined ? '' : (r[col[f]!] ?? '').normalize('NFKC').trim());
    const why: string[] = [];
    const name = get('name').replace(/\s+/g, ' ');
    const email = get('email').toLowerCase();
    if (!name) why.push('名前が空です');
    else if (name.length > 60) why.push('名前が長すぎます（60文字まで）');
    if (!EMAIL.test(email)) why.push('メールアドレスの形が正しくありません');
    else if (existing.has(email)) { problems.push({ line, text: `${email} はもう登録されています（飛ばします）` }); return; }
    else if (seen.has(email)) why.push(`${email} がこのファイルの中で2回出ています`);
    const examRaw = get('examOn');
    const examOn = examRaw ? parseDate(examRaw) : null;
    if (examRaw && !examOn) why.push(`受験日「${examRaw}」が読めません（2027/2/12 の形で）`);
    const grade = get('grade'), goalSchool = get('goalSchool'), goalFaculty = get('goalFaculty');
    if (grade.length > 30) why.push('学年が長すぎます');
    if (goalSchool.length > 80 || goalFaculty.length > 80) why.push('志望校・学部が長すぎます');

    let mainCoachId: string | null = null;
    const mainRaw = get('mainCoach');
    if (mainRaw) {
      const c = findCoach(mainRaw, coaches);
      if (c === 'ambiguous') why.push(`講師「${mainRaw}」が2人います。メールアドレスで書いてください`);
      else if (!c) why.push(`講師「${mainRaw}」が見つかりません`);
      else mainCoachId = c.id;
    }
    const subCoachIds: string[] = [];
    // 「ジョン・スミス」のように名前に「・」が入るので、まず欄まるごと → 区切り（、,;／/）→ それでも見つからなければ「・」でも分ける
    const subRaw = get('subCoaches');
    const pieces = !subRaw ? [] : findCoach(subRaw, coaches) ? [subRaw]
      : subRaw.split(/[、,;／/]/).map(x => x.trim()).filter(Boolean).flatMap(p => (findCoach(p, coaches) || !p.includes('・') ? [p] : splitDots(p, coaches)));
    for (const s of pieces) {
      const c = findCoach(s, coaches);
      if (c === 'ambiguous') why.push(`講師「${s}」が2人います。メールアドレスで書いてください`);
      else if (!c) why.push(`副担当「${s}」が見つかりません`);
      else if (c.id !== mainCoachId && !subCoachIds.includes(c.id)) subCoachIds.push(c.id);
    }
    if (!mainCoachId && subCoachIds.length) { mainCoachId = subCoachIds.shift()!; }

    const gName = get('guardianName').replace(/\s+/g, ' '), gRel = get('guardianRelation');
    if (gName.length > 60) why.push('保護者の名前が長すぎます');
    if (gRel.length > 20) why.push('続柄が長すぎます');
    if (!gName && gRel) why.push('続柄だけで保護者の名前がありません');

    if (EMAIL.test(email)) seen.add(email);
    if (why.length) { problems.push({ line, text: why.join('・') }); return; }
    rows.push({ line, name, email, grade, goalSchool, goalFaculty, examOn, mainCoachId, subCoachIds, guardian: gName ? { name: gName, relation: gRel } : null });
  });
  return { rows, problems, missingHeaders, unknownHeaders };
}

/** 画面の「見本の CSV をダウンロード」。Excel で開けるよう BOM つき UTF-8 */
export const IMPORT_TEMPLATE = '﻿名前,メール,学年,志望校,学部,受験日,担当講師,副担当,保護者名,続柄\r\n山田 陽菜,hina@example.com,高3,早稲田大学,商学部,2027/2/12,佐藤 健,中村 葵,山田 恵子,母\r\n';
