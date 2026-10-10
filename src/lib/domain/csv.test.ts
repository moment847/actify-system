import { describe, expect, it } from 'vitest';
import { decodeCsv, IMPORT_TEMPLATE, parseCsv, parseDate, previewImport, type CoachRef } from './csv';

const coaches: CoachRef[] = [
  { id: 'c1', name: '佐藤 健', email: 'sato@demo.actify.jp' },
  { id: 'c2', name: '中村 葵', email: 'nakamura@demo.actify.jp' },
  { id: 'c3', name: '鈴木 一郎', email: 'suzuki1@demo.actify.jp' },
  { id: 'c4', name: '鈴木 一郎', email: 'suzuki2@demo.actify.jp' },
];

describe('CSV の読み取り', () => {
  it('引用符の中のカンマ・改行・"" と、CRLF・空行', () => {
    expect(parseCsv('a,"b,c","d\n""e"""\r\n\r\n x , y \n')).toEqual([['a', 'b,c', 'd\n"e"'], ['x', 'y']]);
    expect(parseCsv('a,b')).toEqual([['a', 'b']]);
    expect(parseCsv('a,\n')).toEqual([['a', '']]);
  });

  it('文字コード：BOM つき UTF-8・BOM なし UTF-8・Shift_JIS（Excel）', () => {
    const utf8 = new TextEncoder().encode('名前,メール');
    expect(decodeCsv(new Uint8Array([0xef, 0xbb, 0xbf, ...utf8]))).toBe('名前,メール');
    expect(decodeCsv(utf8)).toBe('名前,メール');
    // 「名前」の Shift_JIS
    expect(decodeCsv(new Uint8Array([0x96, 0xbc, 0x91, 0x4f]))).toBe('名前');
  });

  it('日付の書き方', () => {
    expect(parseDate('2027/2/12')).toBe('2027-02-12');
    expect(parseDate('２０２７年２月１２日')).toBe('2027-02-12');
    expect(parseDate('2027-02-30')).toBeNull();
    expect(parseDate('2/12')).toBeNull();
  });
});

describe('一括登録の検査', () => {
  it('見本の CSV はそのまま通る', () => {
    const p = previewImport(IMPORT_TEMPLATE, coaches);
    expect(p.problems).toEqual([]);
    expect(p.rows).toEqual([{ line: 2, name: '山田 陽菜', email: 'hina@example.com', grade: '高3', goalSchool: '早稲田大学', goalFaculty: '商学部', examOn: '2027-02-12',
      mainCoachId: 'c1', subCoachIds: ['c2'], guardian: { name: '山田 恵子', relation: '母' } }]);
  });

  it('名前とメールの列が無ければ、行を見ずに返す', () => {
    const p = previewImport('氏名,学年\nA,高1', coaches);
    expect(p.missingHeaders).toEqual(['email']);
    expect(p.rows).toEqual([]);
  });

  it('見出しの揺れ（全角・空白・英語）と知らない列', () => {
    const p = previewImport('氏　名,E-mail,ＧＲＡＤＥ,メモ\nA,A@x.jp,高1,x', coaches);
    expect(p.rows[0]).toMatchObject({ name: 'A', email: 'a@x.jp', grade: '高1' });
    expect(p.unknownHeaders).toEqual(['メモ']);
  });

  it('行ごとの問題（ほかの行は登録できる）', () => {
    const csv = ['名前,メール,受験日,担当講師,副担当,保護者名,続柄',
      'A,a@x.jp,2027/2/30,,,,',
      ',b@x.jp,,,,,',
      'C,c@x.jp,,鈴木 一郎,,,',
      'D,d@x.jp,,suzuki2@demo.actify.jp,田中,,',
      'E,e@x.jp,,,,,母',
      'F,taken@x.jp,,,,,',
      'G,d@x.jp,,,,,',
      'H,h@x.jp,,,中村 葵、佐藤 健,,'].join('\n');
    const p = previewImport(csv, coaches, ['TAKEN@x.jp']);
    expect(p.problems).toEqual([
      { line: 2, text: '受験日「2027/2/30」が読めません（2027/2/12 の形で）' },
      { line: 3, text: '名前が空です' },
      { line: 4, text: '講師「鈴木 一郎」が2人います。メールアドレスで書いてください' },
      { line: 5, text: '副担当「田中」が見つかりません' },
      { line: 6, text: '続柄だけで保護者の名前がありません' },
      { line: 7, text: 'taken@x.jp はもう登録されています（飛ばします）' },
      { line: 8, text: 'd@x.jp がこのファイルの中で2回出ています' },
    ]);
    // 主担当が空で副担当だけなら、1人目を主担当にする
    expect(p.rows).toEqual([expect.objectContaining({ line: 9, mainCoachId: 'c2', subCoachIds: ['c1'] })]);
  });

  it('500人を超えたら、超えた分は登録しない', () => {
    const csv = '名前,メール\n' + Array.from({ length: 502 }, (_, i) => `S${i},s${i}@x.jp`).join('\n');
    const p = previewImport(csv, coaches);
    expect(p.rows).toHaveLength(500);
    expect(p.problems[0].text).toContain('500人まで');
  });
});

describe('一括登録の 2026-10 の直し', () => {
  const coaches: CoachRef[] = [{ id: 'c1', name: '佐藤 健', email: 'sato@x.jp' }, { id: 'c2', name: 'ジョン・スミス', email: 'john@x.jp' }, { id: 'c3', name: '中村 葵', email: 'naka@x.jp' }];
  it('名前に「・」が入る講師も副担当にできる。「・」で並べた2人も読める', () => {
    const p = previewImport('名前,メール,担当講師,副担当\nA,a@x.jp,佐藤 健,ジョン・スミス\nB,b@x.jp,佐藤 健,中村 葵・ジョン・スミス\n', coaches);
    expect(p.problems).toEqual([]);
    expect(p.rows[0].subCoachIds).toEqual(['c2']);
  });
  it('問題の行番号はファイルの行番号（空の行・セルの中の改行も数える）', () => {
    const p = previewImport('名前,メール\nA,a@x.jp\n\n"B\nB",bad\n\nC,\n', coaches);
    expect(p.problems.map(x => x.line)).toEqual([4, 7]);
  });
});
