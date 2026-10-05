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

/** 円に直して切り上げる（少なく見積もると粗利を良く見せる方向に外れるので、高い側に倒す）。知らないモデルはいちばん高い単価 */
export function costJpy(model: string, usage: Usage, usdJpy: number): number {
  // 先頭一致は長い名前から（'claude-opus-5' が 'claude-opus-5-5' に先に当たらないように）
  const p = USD_PER_MTOK[model] ?? Object.entries(USD_PER_MTOK).sort((a, b) => b[0].length - a[0].length).find(([k]) => model.startsWith(k + '-') || model === k)?.[1] ?? UNKNOWN;
  const input = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) * 1.25 + (usage.cache_read_input_tokens ?? 0) * 0.1;
  const usd = (input * p.input + usage.output_tokens * p.output) / 1_000_000;
  return Math.ceil(usd * usdJpy);
}
