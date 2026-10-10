import 'server-only';
// 塾の月額（Actify の利用料）。請求する数＝在籍中（active）の生徒の数。休会中・退会の生徒は数えない
import type { SupabaseClient } from '@supabase/supabase-js';
import { env } from '@/lib/env';
import { getSubscription, isLive, listSubscriptions, periodEnd, setSeats, type StripeSubscription } from '@/lib/integrations/stripe';

export async function countSeats(admin: SupabaseClient, schoolId: string): Promise<number> {
  const { count, error } = await admin.from('profiles').select('id', { count: 'exact', head: true }).eq('school_id', schoolId).eq('role', 'student').eq('status', 'active');
  // 数えられなかったのに 0 人として扱うと、300人の塾の数量を1人に下げてしまう（Stripe は差額を返金する）。失敗は失敗として止める
  if (error || count == null) throw new Error(`countSeats: ${error?.message ?? 'no count'}`);
  return count;
}

const iso = (sec: number | null | undefined) => (sec ? new Date(sec * 1000).toISOString() : null);

/**
 * Stripe の契約の状態を school_billing に写す（Webhook と、seats を合わせたあとで使う）。
 * 塾にはいつも1つの契約だけを結びつける。別の契約の知らせが届いたときは：
 * - それが終わった契約（解約・期限切れ）なら無視する（古い契約の「解約」が遅れて届いて、新しい契約を解約に見せないため）
 * - それが生きている契約なら写す（二重契約。ログに残す）
 * 写したら true、無視したら false
 */
export async function applySubscription(admin: SupabaseClient, schoolId: string, s: StripeSubscription): Promise<boolean> {
  const { data: cur } = await admin.from('school_billing').select('stripe_subscription_id, status').eq('school_id', schoolId).maybeSingle();
  if (cur?.stripe_subscription_id && cur.stripe_subscription_id !== s.id) {
    if (!isLive(s.status)) { console.warn('[billing] ignore ended subscription', { schoolId, incoming: s.id, current: cur.stripe_subscription_id }); return false; }
    // 生きている契約が2つ（二重契約）。startCheckout が防いでいるので、ここに来るのは Stripe のダッシュボードで手で作ったとき。
    // 届いた方を写し、運営が気づけるように大きくログに残す（どちらを解約するかは人が決める）
    if (isLive(cur.status)) console.error('[billing] TWO LIVE SUBSCRIPTIONS for one school — cancel one in Stripe', { schoolId, incoming: s.id, current: cur.stripe_subscription_id });
  }
  const { error } = await admin.from('school_billing').upsert({
    school_id: schoolId, stripe_customer_id: s.customer, stripe_subscription_id: s.id, status: s.status,
    seats: s.items.data[0]?.quantity ?? 0, current_period_end: iso(periodEnd(s)), trial_end: iso(s.trial_end),
    cancel_at_period_end: s.cancel_at_period_end, updated_at: new Date().toISOString(),
  }, { onConflict: 'school_id' });
  if (error) throw new Error(error.message);
  return true;
}

/** その顧客に生きている契約があるか（Stripe に聞く）。あれば DB にも写して返す */
export async function findLiveSubscription(admin: SupabaseClient, key: string, schoolId: string, customer: string): Promise<StripeSubscription | null> {
  const live = (await listSubscriptions(key, customer)).filter(s => isLive(s.status)).sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0] ?? null;
  if (live) await applySubscription(admin, schoolId, live);
  return live;
}

/**
 * 毎日：在籍中の生徒の数を Stripe の数量に合わせる（増えた・減った分は Stripe が日割りで次の請求に足し引きする）。
 * 1つの塾で失敗しても、ほかの塾は続ける（失敗した塾はログに残し、翌日また合わせる）
 */
export async function syncSeats(admin: SupabaseClient, today: string) {
  const key = env.stripeSecretKey();
  if (!key) return { checked: 0, changed: 0, failed: 0 };
  const { data: rows } = await admin.from('school_billing').select('school_id, stripe_subscription_id, seats')
    .not('stripe_subscription_id', 'is', null).in('status', ['trialing', 'active', 'past_due']);
  let changed = 0, failed = 0;
  for (const r of rows ?? []) {
    try {
      const seats = Math.max(1, await countSeats(admin, r.school_id));
      const sub = await getSubscription(key, r.stripe_subscription_id!);
      const item = sub.items.data[0];
      if (item && isLive(sub.status) && item.quantity !== seats) {
        await setSeats(key, item.id, seats, `seats:${r.school_id}:${today}:${seats}`);
        changed++;
      }
      await applySubscription(admin, r.school_id, { ...sub, items: { data: item ? [{ ...item, quantity: isLive(sub.status) ? seats : item.quantity }] : [] } });
    } catch (e) {
      failed++;
      console.error('[billing] sync failed', { school: r.school_id, message: e instanceof Error ? e.message : String(e) });
    }
  }
  return { checked: rows?.length ?? 0, changed, failed };
}
