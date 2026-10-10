import 'server-only';
import { maybeCharged } from '@/lib/ai/claude';
import { createAdminClient } from '@/lib/supabase/admin';

export type AiBlock = 'busy' | 'daily_limit' | 'budget' | 'unknown';
const REASONS: Record<string, AiBlock> = { AI_BUSY: 'busy', AI_DAILY_LIMIT: 'daily_limit', AI_BUDGET: 'budget' };

/**
 * AI を呼ぶ前に枠を取る（同時に1件・1人1日の回数・塾の月の予算。DB の ai_reserve が順番に確かめる）。
 * 取れたら id を返す。呼び終わったら必ず settle で実際の原価を書く
 */
export async function reserveAi(schoolId: string, userId: string, purpose: 'chat' | 'toc_ocr' | 'note_summary' | 'plan_advice', estimateJpy: number): Promise<{ id: number } | { blocked: AiBlock }> {
  const { data, error } = await createAdminClient().rpc('ai_reserve', { p_school: schoolId, p_user: userId, p_purpose: purpose, p_estimate_jpy: estimateJpy });
  if (error) return { blocked: REASONS[error.message] ?? 'unknown' };
  return { id: Number(data) };
}

/**
 * 呼び終わったら実際の原価を書く。時間切れ・途中で切れた・5xx のように「返事は無いが請求されたかもしれない」失敗は、
 * 0 円にせず予約したときの見込み額（estimateJpy）のまま残す（少なく見せる方向に外さない）
 */
export async function settleAi(id: number, call: { model: string; promptVersion: string; inputTokens: number; outputTokens: number; costJpy: number; error?: string | null } | null, estimateJpy = 0) {
  const cost = call && call.costJpy === 0 && maybeCharged(call.error) ? estimateJpy : call?.costJpy ?? 0;
  const { error } = await createAdminClient().rpc('ai_settle', {
    p_id: id, p_model: call?.model ?? '', p_prompt_version: call?.promptVersion ?? '', p_input_tokens: call?.inputTokens ?? 0,
    p_output_tokens: call?.outputTokens ?? 0, p_cost_jpy: cost, p_error: call ? call.error ?? null : 'not_called',
  });
  if (error) console.error('[ai] settle failed', { id, message: error.message });
}
