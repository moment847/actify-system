import { describe, expect, it } from 'vitest';
import { pathIn, safeNext } from './paths';

const A = '11111111-1111-4111-8111-111111111111/';
describe('ファイルのパス', () => {
  it('自分の塾のフォルダの中だけ通す', () => {
    expect(pathIn(A + 'quiz/a.pdf', A)).toBe(true);
    expect(pathIn('22222222-2222-4222-8222-222222222222/quiz/a.pdf', A)).toBe(false);
    expect(pathIn(A, A)).toBe(false);
    expect(pathIn(A + '../22222222-2222-4222-8222-222222222222/a.pdf', A)).toBe(false);
    expect(pathIn(A + './a.pdf', A)).toBe(false);
    expect(pathIn(A + 'a\\..\\b.pdf', A)).toBe(false);
    expect(pathIn(null, A)).toBe(false);
    expect(pathIn(A + 'a.pdf', A.slice(0, -1))).toBe(false); // 接頭辞は「/」で終わる形だけ
  });
});

describe('ログイン後の転送先', () => {
  const o = 'https://actify.example';
  it('同じオリジンのパスは通す', () => {
    expect(safeNext('/coach?week=1', o)).toBe('/coach?week=1');
    expect(safeNext('/account/password', o)).toBe('/account/password');
  });
  it('外部サイトへは飛ばさない（//・/\\・スキーム付き・javascript:）', () => {
    for (const bad of ['//evil.example', '/\\evil.example', '/\\/evil.example', 'https://evil.example/x', 'javascript:alert(1)', '\\\\evil.example'])
      expect(safeNext(bad, o), bad).toBe('/');
  });
  it('正規化で // になる形も外へは飛ばさない', () => {
    for (const bad of ['/.//evil.example', '/..//evil.example', '/x/..//evil.example', '/%2e//evil.example', '/./\\evil.example'])
      expect(safeNext(bad, o), bad).toBe('/');
    expect(safeNext('/a/../coach', o)).toBe('/coach');
  });
  it('空なら既定へ', () => expect(safeNext(null, o)).toBe('/'));
});
