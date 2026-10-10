import 'server-only';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { z } from 'zod';
import { env } from '@/lib/env';
import { claudeClient, errorKind, FALLBACK } from './claude';
import { callCost } from './pricing';
import { TOC_OCR_INSTRUCTION, TOC_OCR_PROMPT_VERSION } from './prompts/toc-ocr.v1';

export const TocResult = z.object({
  name: z.string(),
  subject: z.enum(['english', 'math', 'japanese', 'science', 'social', 'other']),
  kind: z.enum(['input', 'practice']),
  lines: z.array(z.string()),
});
export type TocResult = z.infer<typeof TocResult>;

/** 目次の写真を読み取る。キーが無ければ null（画面では手で入れてもらう） */
export async function readToc(image: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; base64: string }) {
  const client = claudeClient();
  if (!client) return { result: null, call: null };
  const model = env.ocrModel();
  try {
    const res = await client.beta.messages.create({
      model, max_tokens: 8000,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: image.mediaType, data: image.base64 } },
        { type: 'text', text: TOC_OCR_INSTRUCTION },
      ] }],
      output_config: { effort: 'medium', format: zodOutputFormat(TocResult) },
      ...FALLBACK,
    }, { timeout: 120_000 });   // 長い目次は考える分も含めて30秒を超える（会話の30秒とは別にする）
    const call = { model: res.model, promptVersion: TOC_OCR_PROMPT_VERSION, ...callCost(res.model, res.usage, env.usdJpy()) };
    if (res.stop_reason === 'refusal') return { result: null, call: { ...call, error: 'refusal' } };
    const text = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('');
    // JSON が途中で切れていても（max_tokens に当たった）、原価は実際のトークン数で残す（0 円にしない）
    let json: unknown;
    try { json = JSON.parse(text || '{}'); } catch { return { result: null, call: { ...call, error: 'parse' } }; }
    const parsed = TocResult.safeParse(json);
    if (!parsed.success) return { result: null, call: { ...call, error: 'parse' } };
    const lines = parsed.data.lines.map(s => s.trim()).filter(Boolean).slice(0, 500);
    return { result: { ...parsed.data, name: parsed.data.name.trim(), lines }, call };
  } catch (e) {
    return { result: null, call: { model, promptVersion: TOC_OCR_PROMPT_VERSION, inputTokens: 0, outputTokens: 0, costJpy: 0, error: errorKind(e) } };
  }
}
