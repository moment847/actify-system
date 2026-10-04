// 塾ごとの LINE のチャネルシークレット・アクセストークンを DB に置くための暗号化（AES-256-GCM）。
// 鍵は環境変数 SECRETS_KEY（32バイトを base64）。DB が漏れても、鍵が無ければ読めない。
// 形：v1.<iv base64url>.<暗号文 base64url>.<タグ base64url>
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const key = (b64: string) => {
  const k = Buffer.from(b64, 'base64');
  if (k.length !== 32) throw new Error('SECRETS_KEY は 32 バイトを base64 にしたものにしてください（openssl rand -base64 32）');
  return k;
};

export function seal(plain: string, keyB64: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key(keyB64), iv);
  const body = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), body.toString('base64url'), c.getAuthTag().toString('base64url')].join('.');
}

export function open(sealed: string, keyB64: string): string {
  const [v, iv, body, tag] = sealed.split('.');
  if (v !== 'v1' || !iv || body === undefined || !tag) throw new Error('暗号の形が正しくありません');
  const d = createDecipheriv('aes-256-gcm', key(keyB64), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(body, 'base64url')), d.final()]).toString('utf8');
}
