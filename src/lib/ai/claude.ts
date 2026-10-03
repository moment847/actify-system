import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '@/lib/env';

/** Claude のクライアント。ANTHROPIC_API_KEY が無ければ null（呼ぶ側は決まった文の返事に落とす） */
export function claudeClient(): Anthropic | null {
  const key = env.anthropicApiKey();
  return key ? new Anthropic({ apiKey: key, timeout: 30_000, maxRetries: 1 }) : null;
}

/** 断られたとき（安全のための拒否）に、内容に合った別のモデルで書き直してもらう（サーバ側の控え） */
export const FALLBACK = { betas: ['server-side-fallback-2026-07-01'] as Anthropic.Beta.AnthropicBeta[], fallbacks: 'default' as const };

export function errorKind(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return 'rate_limit';
  if (e instanceof Anthropic.AuthenticationError) return 'auth';
  if (e instanceof Anthropic.BadRequestError) return 'bad_request';
  if (e instanceof Anthropic.APIConnectionTimeoutError) return 'timeout';
  if (e instanceof Anthropic.APIConnectionError) return 'connection';
  if (e instanceof Anthropic.APIError) return `http_${e.status ?? 'unknown'}`;
  return 'failed';
}
