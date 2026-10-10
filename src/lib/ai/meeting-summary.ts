import 'server-only';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from '@/lib/env';
import { claudeClient, errorKind, FALLBACK } from './claude';
import { callCost } from './pricing';
import { MEETING_SUMMARY_PROMPT_VERSION, MEETING_SUMMARY_SYSTEM } from './prompts/meeting-summary.v1';

export const MeetingSummary = z.object({
  decided: z.array(z.string()),
  homework: z.array(z.string()),
  concerns: z.array(z.string()),
  studentTodo: z.string(),
});
export type MeetingSummary = z.infer<typeof MeetingSummary>;

const tidy = (xs: string[]) => xs.map(x => x.trim().slice(0, 80)).filter(Boolean).slice(0, 6);

/** 面談の記録を「決めたこと・宿題・気になること・生徒に見せる次回までにやること」に整理する。キーが無ければ null */
export async function summarizeMeeting(body: string) {
  const client = claudeClient();
  if (!client) return { result: null, call: null };
  const model = env.coachAiModel();
  try {
    const res = await client.beta.messages.create({
      model, max_tokens: 4000,
      system: [{ type: 'text', text: MEETING_SUMMARY_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: `面談の記録：\n${body}` }],
      output_config: { effort: 'low', format: zodOutputFormat(MeetingSummary) },
      ...FALLBACK,
    }, { timeout: 60_000 });
    const call = { model: res.model, promptVersion: MEETING_SUMMARY_PROMPT_VERSION, ...callCost(res.model, res.usage, env.usdJpy()) };
    if (res.stop_reason === 'refusal') return { result: null, call: { ...call, error: 'refusal' } };
    const text = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
    let json: unknown;
    try { json = JSON.parse(text || '{}'); } catch { return { result: null, call: { ...call, error: 'parse' } }; }
    const p = MeetingSummary.safeParse(json);
    if (!p.success) return { result: null, call: { ...call, error: 'parse' } };
    return { result: { decided: tidy(p.data.decided), homework: tidy(p.data.homework), concerns: tidy(p.data.concerns), studentTodo: p.data.studentTodo.trim().slice(0, 1000) }, call };
  } catch (e) {
    return { result: null, call: { model, promptVersion: MEETING_SUMMARY_PROMPT_VERSION, inputTokens: 0, outputTokens: 0, costJpy: 0, error: errorKind(e) } };
  }
}
