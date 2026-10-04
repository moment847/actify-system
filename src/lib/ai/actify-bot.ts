import 'server-only';
import type Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';
import { ruleReply, studentContext, type BotReply } from '@/lib/domain/bot-reply';
import type { World } from '@/lib/domain/types';
import { claudeClient, errorKind, FALLBACK } from './claude';
import { costJpy } from './pricing';
import { ACTIFY_CHAT_PROMPT_VERSION, ACTIFY_CHAT_SYSTEM, contextMessage } from './prompts/actify-chat.v1';

export interface ChatTurn { sender: 'student' | 'bot'; body: string }
export interface BotResult {
  reply: BotReply;
  /** AI を呼んだときだけ。ai_calls に残す */
  call?: { model: string; promptVersion: string; inputTokens: number; outputTokens: number; costJpy: number; error?: string };
}

const MAX_HISTORY = 20;
/** 保存して画面に出す返事の長さの上限（文字）。DB の上限 4,000 より短くし、超えたら文の切れ目で切る */
export const MAX_REPLY_CHARS = 1500;

export function clipReply(text: string, max = MAX_REPLY_CHARS): string {
  const t = text.trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max);
  const at = Math.max(cut.lastIndexOf('\n'), cut.lastIndexOf('。'));
  return (at > max * 0.6 ? cut.slice(0, at + 1) : cut).trimEnd() + '\n（長くなったので、ここまでにするね）';
}

/** Actifyくんの返事。キーが無い・失敗・拒否のときは、アプリのデータから作る決まった文の返事にする */
export async function botReply(args: {
  world: World; studentId: string; info: { name: string; goal?: string; examOn?: string | null; coachName?: string };
  history: ChatTurn[]; text: string; image?: { mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif'; base64: string };
  /** false なら AI を呼ばない（上限に達したとき） */
  useAi?: boolean;
}): Promise<BotResult> {
  const fallback = () => ruleReply(args.world, args.studentId, args.text, { hasImage: !!args.image, coachName: args.info.coachName });
  const client = args.useAi === false ? null : claudeClient();
  if (!client) return { reply: fallback() };

  const model = env.chatModel();
  // 履歴：最初は生徒の発言から（あいさつなど、先頭の Actifyくんの発言は落とす）
  const hist = args.history.slice(-MAX_HISTORY);
  while (hist.length && hist[0].sender === 'bot') hist.shift();
  const messages: Anthropic.Beta.BetaMessageParam[] = hist.map(h => ({ role: h.sender === 'student' ? 'user' : 'assistant', content: h.body || '（写真）' }));
  const content: Anthropic.Beta.BetaContentBlockParam[] = [{ type: 'text', text: contextMessage(studentContext(args.world, args.studentId, args.info)) }];
  if (args.image) content.push({ type: 'image', source: { type: 'base64', media_type: args.image.mediaType, data: args.image.base64 } });
  content.push({ type: 'text', text: args.text || '（写真を送りました）' });
  messages.push({ role: 'user', content });

  try {
    const res = await client.beta.messages.create({
      model, max_tokens: 4000,   // 考える分も含む上限（文字数ではない）。返事は8行までと指示し、保存の前に clipReply で文字数を切る
      system: [{ type: 'text', text: ACTIFY_CHAT_SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages,
      output_config: { effort: 'low' },   // 雑談と相談：深く考えるより早く返す
      ...FALLBACK,
    });
    const call = { model: res.model, promptVersion: ACTIFY_CHAT_PROMPT_VERSION, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens, costJpy: costJpy(res.model, res.usage, env.usdJpy()) };
    if (res.stop_reason === 'refusal') return { reply: fallback(), call: { ...call, error: `refusal:${res.stop_details?.category ?? 'unknown'}` } };
    const text = res.content.flatMap(b => (b.type === 'text' ? [b.text] : [])).join('').trim();
    if (!text) return { reply: fallback(), call: { ...call, error: 'empty' } };
    return { reply: { mood: 'support', text: clipReply(text) }, call };
  } catch (e) {
    return { reply: fallback(), call: { model, promptVersion: ACTIFY_CHAT_PROMPT_VERSION, inputTokens: 0, outputTokens: 0, costJpy: 0, error: errorKind(e) } };
  }
}
