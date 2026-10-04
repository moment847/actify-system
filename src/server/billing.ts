import 'server-only';
// 塾の月額（Actify の利用料）。請求する数＝在籍中（active）の生徒の数。休会中・退会の生徒は数えない
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { getSubscription, periodEnd, setSeats, type StripeSubscription } from '@/lib/integrations/stripe';

export async function countSeats(admin: SupabaseClient, schoolId: string): Promise<number> {
  const { count } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('role', 'student').eq('status', 'active');
  return count ?? 0;
}

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

/** Stripe の契約の状態を school_billing に写す（Webhook と、seats を合わせたあとで使う） */
export async function applySubscription(admin: SupabaseClient, schoolId: string, s: StripeSubscription) {
  const { error } = await admin.from('school_billing').upsert({
    school_id: schoolId, stripe_customer_id: s.customer, stripe_subscription_id: s.id, status: s.status,
    seats: s.items.data[0]?.quantity ?? 0, current_period_end: iso(periodEnd(s)), trial_end: iso(s.trial_end),
    cancel_at_period_end: s.cancel_at_period_end, updated_at: new Date().toISOString(),
  }, { onConflict: 'school_id' });
  if (error) throw new Error(error.message);
}

/** 毎日：在籍中の生徒の数を Stripe の数量に合わせる（増えた・減った分は Stripe が日割りで次の請求に足し引きする） */
export async function syncSeats(admin: SupabaseClient, today: string) {
  const key = env.stripeSecretKey();
  if (!key) return { checked: 0, changed: 0 };
  const { data: rows } = await admin.from('school_billing').select('school_id, stripe_subscription_id, seats')
    .not('stripe_subscription_id', 'is', null).in('status', ['trialing', 'active', 'past_due']);
  let changed = 0;
  for (const r of rows ?? []) {
    const seats = Math.max(1, await countSeats(admin, r.school_id));
    const sub = await getSubscription(key, r.stripe_subscription_id!);
    const item = sub.items.data[0];
    if (item && item.quantity !== seats) {
      await setSeats(key, item.id, seats, `seats:${r.school_id}:${today}:${seats}`);
      changed++;
    }
    await applySubscription(admin, r.school_id, { ...sub, items: { data: item ? [{ ...item, quantity: seats }] : [] } });
  }
  return { checked: rows?.length ?? 0, changed };
}
