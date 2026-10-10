import { describe, expect, it } from 'vitest';
import { callCost, costJpy } from './pricing';

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
  it('控えのモデルが書き直したときは、断られた回も含めて回ごとのモデルの単価で足す', () => {
    const usage = { input_tokens: 1_000_000, output_tokens: 0, iterations: [
      { type: 'message', model: 'claude-opus-5-5', input_tokens: 1_000_000, output_tokens: 100_000 },
      { type: 'fallback_message', model: 'claude-opus-4-8', input_tokens: 1_000_000, output_tokens: 0 },
    ] };
    // 4×1 + 20×0.1 + 5×1 = 11 ドル（最後の回だけなら 5 ドル）
    expect(callCost('claude-opus-4-8', usage, 150)).toEqual({ inputTokens: 2_000_000, outputTokens: 100_000, costJpy: 1650 });
    expect(callCost('claude-opus-5-5', u, 150).costJpy).toBe(600);   // 記録が無ければ今までどおり
  });
  it('Haiku 5.5 は表にある（知らないモデル扱いで100倍に見積もらない）', () => {
    expect(costJpy('claude-haiku-5-5', u, 150)).toBe(15);
  });
});
