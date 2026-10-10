import 'server-only';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from '@/lib/env';
import type { PlanAdvice } from '@/lib/domain/plan-advice';
import { claudeClient, errorKind, FALLBACK } from './claude';
import { callCost } from './pricing';
import { PLAN_ADVICE_PROMPT_VERSION, PLAN_ADVICE_SYSTEM } from './prompts/plan-advice.v1';

const Advice = z.object({
  summary: z.string(),
  focus: z.array(z.object({ materialId: z.string(), change: z.enum(['more', 'less', 'keep']), reason: z.string() })),
  lighterDays: z.array(z.object({ date: z.string(), reason: z.string() })),
  notes: z.array(z.string()),
});

/** 次の週の予定の方針（教材の多め・少なめ・軽くする日・講師への注意）。日時は決めない。キーが無ければ null */
export async function adviseWeekPlan(context: string): Promise<{ result: PlanAdvice | null; call: { model: string; promptVersion: string; inputTokens: number; outputTokens: number; costJpy: number; error?: string } | null }> {
  const client = claudeClient();
  if (!client) return { result: null, call: null };
  const model = env.coachAiModel();
  try {
    const res = await client.beta.messages.create({
      model, max_tokens: 8000,
      system: [{ type: 'text', text: PLAN_ADVICE_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: context }],
      output_config: { effort: 'medium', format: zodOutputFormat(Advice) },
      ...FALLBACK,
    }, { timeout: 120_000 });
    const call = { model: res.model, promptVersion: PLAN_ADVICE_PROMPT_VERSION, ...callCost(res.model, res.usage, env.usdJpy()) };
    if (res.stop_reason === 'refusal') return { result: null, call: { ...call, error: 'refusal' } };
    const text = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
    let json: unknown;
    try { json = JSON.parse(text || '{}'); } catch { return { result: null, call: { ...call, error: 'parse' } }; }
    const p = Advice.safeParse(json);
    if (!p.success) return { result: null, call: { ...call, error: 'parse' } };
    return { result: p.data, call };
  } catch (e) {
    return { result: null, call: { model, promptVersion: PLAN_ADVICE_PROMPT_VERSION, inputTokens: 0, outputTokens: 0, costJpy: 0, error: errorKind(e) } };
  }
}
