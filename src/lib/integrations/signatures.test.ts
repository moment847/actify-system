import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { open, seal } from './secret-box';
import { verifyLineSignature, verifyStripeSignature } from './signatures';

describe('署名', () => {
  it('LINE', () => {
    const body = '{"events":[]}', secret = 'abc';
    const sig = createHmac('sha256', secret).update(body).digest('base64');
    expect(verifyLineSignature(body, sig, secret)).toBe(true);
    expect(verifyLineSignature(body + ' ', sig, secret)).toBe(false);
    expect(verifyLineSignature(body, null, secret)).toBe(false);
  });
  it('Stripe（時刻のずれ・複数の v1・形の崩れ）', () => {
    const body = '{"id":"evt_1"}', secret = 'whsec_x', t = 1_790_000_000;
    const v1 = createHmac('sha256', secret).update(`${t}.${body}`).digest('hex');
    const now = t * 1000;
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, now)).toBe(true);
    expect(verifyStripeSignature(body, `t=${t},v1=deadbeef,v1=${v1}`, secret, now)).toBe(true);
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, secret, now + 301_000)).toBe(false);
    expect(verifyStripeSignature(body, `v1=${v1}`, secret, now)).toBe(false);
    expect(verifyStripeSignature(body, `t=${t},v1=${v1}`, 'whsec_y', now)).toBe(false);
  });
});

describe('秘密の暗号化', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  it('戻せる・毎回違う形・改ざんは読めない・鍵の長さ', () => {
    const a = seal('token-123', key), b = seal('token-123', key);
    expect(a).not.toBe(b);
    expect(open(a, key)).toBe('token-123');
    const [v, iv, body, tag] = a.split('.');
    const flipped = body.slice(0, -1) + (body.at(-1) === 'A' ? 'B' : 'A');
    expect(() => open([v, iv, flipped, tag].join('.'), key)).toThrow();
    expect(() => seal('x', Buffer.alloc(16).toString('base64'))).toThrow(/32 バイト/);
  });
});
