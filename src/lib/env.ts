// 環境変数。必須のものは、使うときに無ければはっきり落とす（黙って空のまま動かさない）
const need = (name: string) => () => {
  const v = process.env[name];
  if (!v) throw new Error(`環境変数 ${name} が設定されていません（README の「環境変数」を参照）`);
  return v;
};
/** 正の数（整数）。壊れた値で原価が 0 円や NaN になって予算が効かなくなるのを防ぐ */
const posInt = (name: string, fallback: number) => () => {
  const raw = process.env[name];
  if (raw == null || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) throw new Error(`環境変数 ${name} は 1 以上の整数にしてください（今の値: ${raw}）`);
  return n;
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
  usdJpy: posInt('USD_JPY', 150),
  /** 1回の呼び出しの見込みの原価（円）。塾の月の予算を超えないかを、呼ぶ前にこの額で確かめる */
  aiChatEstimateJpy: posInt('AI_CHAT_ESTIMATE_JPY', 30),
  aiOcrEstimateJpy: posInt('AI_OCR_ESTIMATE_JPY', 40),
  /** 招待・パスワードのメールのリンクの戻り先（https://… 末尾の / なし） */
  siteUrl: need('NEXT_PUBLIC_SITE_URL'),
  /** 期限つきのファイルURLの有効時間（秒） */
  signedUrlSeconds: () => Number(process.env.SIGNED_URL_SECONDS || 300),

  // ---- 保護者への LINE・端末への通知・定期処理・塾の契約（未設定なら、その機能だけ止まる） ----
  /** 塾ごとの LINE のチャネルの鍵を DB に置くときの暗号の鍵（32バイトを base64。openssl rand -base64 32） */
  secretsKey: need('SECRETS_KEY'),
  /** 定期処理（/api/cron/*）を呼ぶときの合言葉。Authorization: Bearer <この値> */
  cronSecret: () => process.env.CRON_SECRET || null,
  /** Web Push の鍵（npx web-push generate-vapid-keys）。公開鍵はブラウザにも渡す */
  vapidPublicKey: () => process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY || null,
  vapidPrivateKey: () => process.env.VAPID_PRIVATE_KEY || null,
  /** Web Push の送り主の連絡先（mailto: か https:）。プッシュのサービスが問題のあるときに連絡してくる先 */
  vapidSubject: () => process.env.VAPID_SUBJECT || 'mailto:support@actify.jp',
  /** Stripe（塾が Actify に払う月額）。価格は Stripe のダッシュボードで「生徒1人あたりの月額」として作り、その ID を入れる */
  stripeSecretKey: () => process.env.STRIPE_SECRET_KEY || null,
  stripeWebhookSecret: () => process.env.STRIPE_WEBHOOK_SECRET || null,
  stripePriceId: () => process.env.STRIPE_PRICE_ID || null,
  /** 初めて契約する塾の無料期間（日）。0 なら無し */
  stripeTrialDays: () => { const n = Number(process.env.STRIPE_TRIAL_DAYS ?? 30); return Number.isInteger(n) && n >= 0 ? n : 30; },
};
