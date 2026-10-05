import 'server-only';
// Stripe（塾が Actify に払う月額）。SDK は入れず REST を直接呼ぶ（使うのは 5 つの API だけ）。
// 価格は「生徒1人あたりの月額」で Stripe 側に作り、数量（seats）を在籍中の生徒の数にする。
const API = 'https://api.stripe.com/v1';

export class StripeError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

/** Stripe の API はフォームの形（a[b][0]=c）で送る */
export function form(obj: Record<string, unknown>, prefix = ''): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (typeof x === 'object' ? out.push(...form(x as Record<string, unknown>, `${key}[${i}]`)) : out.push(`${encodeURIComponent(`${key}[${i}]`)}=${encodeURIComponent(String(x))}`)));
    else if (typeof v === 'object') out.push(...form(v as Record<string, unknown>, key));
    else out.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(v))}`);
  }
  return out;
}

async function call<T>(key: string, method: 'GET' | 'POST', path: string, body?: Record<string, unknown>, idempotencyKey?: string): Promise<T> {
  const res = await fetch(API + path, {
    method,
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { 'Content-Type': 'application/x-www-form-urlencoded' } : {}),
      ...(idempotencyKey ? { 'Idempotency-Key': idempotencyKey } : {}),
    },
    body: body ? form(body).join('&') : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const j = await res.json().catch(() => null);
  if (!res.ok) throw new StripeError(res.status, j?.error?.message ?? `Stripe ${res.status}`);
  return j as T;
}

export interface StripeSubscription {
  id: string; customer: string; status: string;
  /** 作られた時刻（秒）。古い契約の知らせが遅れて届いたときに見分ける */
  created?: number;
  trial_end: number | null; cancel_at_period_end: boolean;
  /** 古い API 版はここ、2025-03-31 以降は items の中にある */
  current_period_end?: number;
  metadata?: Record<string, string>;
  items: { data: { id: string; quantity?: number; current_period_end?: number; price?: { id: string } }[] };
}
export const periodEnd = (s: StripeSubscription) => s.current_period_end ?? s.items.data[0]?.current_period_end ?? null;

export const createCustomer = (key: string, p: { name: string; email?: string; schoolId: string }) =>
  call<{ id: string }>(key, 'POST', '/customers', { name: p.name, email: p.email, metadata: { school_id: p.schoolId } }, `cus:${p.schoolId}`);

export const createCheckout = (key: string, p: { customer: string; price: string; seats: number; schoolId: string; trialDays: number; successUrl: string; cancelUrl: string }) =>
  call<{ id: string; url: string }>(key, 'POST', '/checkout/sessions', {
    mode: 'subscription', customer: p.customer, client_reference_id: p.schoolId,
    line_items: [{ price: p.price, quantity: Math.max(1, p.seats) }],
    subscription_data: { metadata: { school_id: p.schoolId }, ...(p.trialDays > 0 ? { trial_period_days: p.trialDays } : {}) },
    success_url: p.successUrl, cancel_url: p.cancelUrl,
    locale: 'ja',
  });

export const createPortal = (key: string, p: { customer: string; returnUrl: string }) =>
  call<{ url: string }>(key, 'POST', '/billing_portal/sessions', { customer: p.customer, return_url: p.returnUrl });

export const getSubscription = (key: string, id: string) => call<StripeSubscription>(key, 'GET', `/subscriptions/${encodeURIComponent(id)}`);

/** 生きている契約の状態（解約・期限切れ以外）。この状態の契約があるうちは、新しい契約を作らない */
export const LIVE_STATUSES = ['trialing', 'active', 'past_due', 'unpaid', 'incomplete', 'paused'] as const;
export const isLive = (status: string) => (LIVE_STATUSES as readonly string[]).includes(status);

/** その顧客の契約を Stripe から一覧で読む（新しい順）。二重契約を防ぐために、支払いページを作る前に確かめる */
export const listSubscriptions = (key: string, customer: string) =>
  call<{ data: StripeSubscription[] }>(key, 'GET', `/subscriptions?customer=${encodeURIComponent(customer)}&status=all&limit=20`).then(r => r.data);

/** 生徒の数を合わせる。日割りは Stripe の既定（次の請求で精算） */
export const setSeats = (key: string, itemId: string, seats: number, idempotencyKey: string) =>
  call<unknown>(key, 'POST', `/subscription_items/${encodeURIComponent(itemId)}`, { quantity: Math.max(1, seats) }, idempotencyKey);
