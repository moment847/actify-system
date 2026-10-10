import { describe, expect, it, vi } from 'vitest';
vi.mock('server-only', () => ({}));
const { clipReply } = await import('./actify-bot');

describe('返事の切り詰め', () => {
  it('サロゲートペアの途中で切らない', () => {
    const out = clipReply('あ'.repeat(1499) + '𠮷'.repeat(10), 1500);
    expect(out).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/);
    expect(out.startsWith('あ'.repeat(1499))).toBe(true);
  });
});
