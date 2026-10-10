// AI の原価（円・整数）。1Mトークンあたりのドル（Anthropic の公開価格。2026-09 時点）
const USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  'claude-fable-5-1': { input: 10, output: 50 },
  'claude-fable-5': { input: 10, output: 50 },
  'claude-mythos-5-1': { input: 10, output: 50 },
  'claude-opus-5-5': { input: 4, output: 20 },
  'claude-opus-5': { input: 5, output: 25 },
  'claude-opus-4-8': { input: 5, output: 25 },   // 拒否されたときの控え（FALLBACK）の行き先
  'claude-opus-4-7': { input: 5, output: 25 },
  'claude-opus-4-6': { input: 5, output: 25 },
  'claude-sonnet-5-5': { input: 2, output: 10 },
  'claude-sonnet-5': { input: 2, output: 10 },
  'claude-sonnet-4-6': { input: 3, output: 15 },
  'claude-haiku-5-5': { input: 0.1, output: 0.5 },   // 10万トークンまでの単価（それを超える送り方はしない）
  'claude-haiku-4-5': { input: 1, output: 5 },
};
/** 表に無いモデルは、いちばん高い単価で計算する（安い側に外すと粗利を良く見せる） */
const UNKNOWN = USD_PER_MTOK['claude-fable-5-1'];

export interface Usage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens?: number | null;
  cache_read_input_tokens?: number | null;
}

export interface ResponseUsage extends Usage {
  /** 断られて控えのモデルが書き直したときは、試した回ごとの記録が入る。上の数字は最後の回だけ */
  iterations?: ReadonlyArray<Usage & { model?: string | null; type?: string }> | null;
}

/** 1回の呼び出しの原価とトークン数。控えのモデルが動いたときは、試した回ごとにそのモデルの単価で足す（最後の回だけだと断られた回の分が抜ける） */
export function callCost(model: string, usage: ResponseUsage, usdJpy: number) {
  const its = usage.iterations?.length ? usage.iterations : null;
  if (!its) return { inputTokens: usage.input_tokens, outputTokens: usage.output_tokens, costJpy: costJpy(model, usage, usdJpy) };
  // 回ごとに円にしてから足すと切り上げが重なるので、ドルで足してから1回だけ切り上げる
  const usd = its.reduce((a, it) => a + usdOf(it.model || model, it), 0);
  return {
    inputTokens: its.reduce((a, it) => a + it.input_tokens, 0),
    outputTokens: its.reduce((a, it) => a + it.output_tokens, 0),
    costJpy: Math.ceil(usd * usdJpy),
  };
}

const priceOf = (model: string) =>
  USD_PER_MTOK[model] ?? Object.entries(USD_PER_MTOK).sort((a, b) => b[0].length - a[0].length).find(([k]) => model.startsWith(k + '-') || model === k)?.[1] ?? UNKNOWN;
function usdOf(model: string, usage: Usage) {
  const p = priceOf(model);
  const input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  return (input * p.input + usage.output_tokens * p.output) / 1_000_000;
}

/** 円に直して切り上げる（少なく見積もると粗利を良く見せる方向に外れるので、高い側に倒す）。知らないモデルはいちばん高い単価 */
export function costJpy(model: string, usage: Usage, usdJpy: number): number {
  // 先頭一致は長い名前から（'claude-opus-5' が 'claude-opus-5-5' に先に当たらないように）
  return Math.ceil(usdOf(model, usage) * usdJpy);
}
