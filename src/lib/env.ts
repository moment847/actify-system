// 環境変数。必須のものは、使うときに無ければはっきり落とす（黙って空のまま動かさない）
const need = (name: string) => () => {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません（README の「環境変数」を参照）`);
  return v;
};

export const env = {
  supabaseUrl: need('NEXT_PUBLIC_SUPABASE_URL'),
  supabaseAnonKey: need('NEXT_PUBLIC_SUPABASE_ANON_KEY'),
  supabaseServiceRoleKey: need('SUPABASE_SERVICE_ROLE_KEY'),
  /** Actifyくんの返事と目次の読み取り。未設定なら決まった文の返事に落とす（読み取りは使えない） */
  anthropicApiKey: () => process.env.ANTHROPIC_API_KEY || null,
  chatModel: () => process.env.ACTIFY_CHAT_MODEL || 'claude-opus-5-5',
  ocrModel: () => process.env.ACTIFY_OCR_MODEL || 'claude-opus-5-5',
  /** AI の原価を円にするときの為替（1ドル何円か）。整数 */
  usdJpy: () => Number(process.env.USD_JPY || 150),
  /** 1回の呼び出しの見込みの原価（円）。塾の月の予算を超えないかを、呼ぶ前にこの額で確かめる */
  aiChatEstimateJpy: () => Number(process.env.AI_CHAT_ESTIMATE_JPY || 10),
  aiOcrEstimateJpy: () => Number(process.env.AI_OCR_ESTIMATE_JPY || 40),
  /** 招待・パスワードのメールのリンクの戻り先（https://… 末尾の / なし） */
  siteUrl: need('NEXT_PUBLIC_SITE_URL'),
  /** 期限つきのファイルURLの有効時間（秒） */
  signedUrlSeconds: () => Number(process.env.SIGNED_URL_SECONDS || 300),
};
