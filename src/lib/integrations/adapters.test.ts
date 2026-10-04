import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
import { extractLinkCode, retryKeyFor } from './line';
import { form } from './stripe';

describe('LINE', () => {
  it('Retry-Key は同じ種から同じ UUID（v4 の形）', () => {
    const a = retryKeyFor('weekly:g1:2026-09-28');
    expect(a).toBe(retryKeyFor('weekly:g1:2026-09-28'));
    expect(a).not.toBe(retryKeyFor('weekly:g1:2026-10-05'));
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('合言葉の取り出し（空白・ハイフン・小文字・全角）', () => {
    expect(extractLinkCode('ab7k-q2xz')).toBe('AB7KQ2XZ');
    expect(extractLinkCode('ＡＢ７Ｋ　Ｑ２ＸＺ')).toBe('AB7KQ2XZ');
    expect(extractLinkCode('こんにちは')).toBeNull();
    expect(extractLinkCode('AB7KQ2X0')).toBeNull(); // 0 と O・1 と I は使わない
  });
});

describe('Stripe のフォームの形', () => {
  it('入れ子と配列', () => {
    expect(form({ mode: 'subscription', line_items: [{ price: 'price_1', quantity: 3 }], subscription_data: { metadata: { school_id: 's' } }, skip: undefined }))
      .toEqual(['mode=subscription', 'line_items%5B0%5D%5Bprice%5D=price_1', 'line_items%5B0%5D%5Bquantity%5D=3', 'subscription_data%5Bmetadata%5D%5Bschool_id%5D=s']);
  });
});
