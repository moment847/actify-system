import { describe, expect, it } from 'vitest';
import { costJpy } from './pricing';

const u = { input_tokens: 1_000_000, output_tokens: 0 };
describe('AI の原価', () => {
  it('表のモデル・日付つきの名前・知らないモデルはいちばん高い単価', () => {
    expect(costJpy('claude-opus-5-5', u, 150)).toBe(600);
    expect(costJpy('claude-opus-5', u, 150)).toBe(750);            // 'claude-opus-5-5' に先に当たらない
    expect(costJpy('claude-opus-5-5-20260601', u, 150)).toBe(600);
    expect(costJpy('claude-opus-4-8', u, 150)).toBe(750);          // 拒否のときの控え
    expect(costJpy('claude-something-new', u, 150)).toBe(1500);    // 不明 → Fable 5.1 の単価
  });
  it('円は切り上げ、キャッシュの書き込みは 1.25 倍', () => {
    expect(costJpy('claude-opus-5-5', { input_tokens: 1, output_tokens: 1 }, 150)).toBe(1);
    expect(costJpy('claude-opus-5-5', { input_tokens: 0, output_tokens: 0, cache_creation_input_tokens: 1_000_000 }, 150)).toBe(750);
  });
});
