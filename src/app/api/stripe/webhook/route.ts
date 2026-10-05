import { env } from '@/lib/env';
import { getSubscription, type StripeSubscription } from '@/lib/integrations/stripe';
import { verifyStripeSignature } from '@/lib/integrations/signatures';
import { createAdminClient } from '@/lib/supabase/admin';
import { applySubscription } from '@/server/billing';

// Stripe の Webhook（塾の月額）。受け取るイベント：checkout.session.completed / customer.subscription.created・updated・deleted
// 同じイベントが二度届いても一度だけ処理する（billing_events の id）。署名と時刻（5分以内）を確かめる
export async function POST(req: Request) {
  const secret = env.stripeWebhookSecret();
  if (!secret) return new Response('not configured', { status: 503 });
  const raw = await req.text();
  if (!verifyStripeSignature(raw, req.headers.get('stripe-signature'), secret)) return new Response('bad signature', { status: 400 });
  const ev = JSON.parse(raw) as { id: string; type: string; data: { object: Record<string, unknown> } };
  const admin = createAdminClient();
  const { error: dup } = await admin.from('billing_events').insert({ id: ev.id, type: ev.type });
  if (dup) return dup.code === '23505' ? new Response('duplicate') : new Response('db error', { status: 500 });

  try {
    const o = ev.data.object;
    if (ev.type === 'checkout.session.completed') {
      // 塾は client_reference_id で決めるが、その塾に保存してある顧客（startCheckout が先に入れる）と一致するときだけ写す。
      // Payment Link の URL でも client_reference_id は指定できるので、第三者の決済が塾の契約に化けないように
      const schoolId = o.client_reference_id as string | null;
      const { data: cur } = schoolId ? await admin.from('school_billing').select('stripe_customer_id').eq('school_id', schoolId).maybeSingle() : { data: null };
      if (schoolId && cur?.stripe_customer_id === o.customer) {
        await admin.from('school_billing').upsert({ school_id: schoolId, stripe_customer_id: o.customer as string, stripe_subscription_id: o.subscription as string, updated_at: new Date().toISOString() }, { onConflict: 'school_id' });
      } else console.error('[stripe webhook] checkout for unknown school/customer', { schoolId, customer: o.customer });
    } else if (ev.type.startsWith('customer.subscription.')) {
      // イベントは順番どおりに届くとは限らないので、Stripe から今の状態を読み直して写す
      const sent = o as unknown as StripeSubscription;
      const key = env.stripeSecretKey();
      const s = key ? await getSubscription(key, sent.id).catch(() => sent) : sent;
      // 塾は metadata.school_id、無ければ customer から引く
      let schoolId = s.metadata?.school_id ?? null;
      if (!schoolId) schoolId = (await admin.from('school_billing').select('school_id').eq('stripe_customer_id', s.customer).maybeSingle()).data?.school_id ?? null;
      if (schoolId) await applySubscription(admin, schoolId, ev.type === 'customer.subscription.deleted' ? { ...s, status: 'canceled' } : s);
    }
    return new Response('ok');
  } catch (e) {
    // 処理に失敗したら記録を消して、Stripe の再送で処理し直す
    await admin.from('billing_events').delete().eq('id', ev.id);
    console.error('[stripe webhook]', ev.type, e instanceof Error ? e.message : e);
    return new Response('error', { status: 500 });
  }
}
