// 動いているかの確認（ログイン不要）。設定の有無だけを返し、値は返さない
export function GET() {
  return Response.json({
    ok: true,
    supabase: !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceRole: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
    ai: !!process.env.ANTHROPIC_API_KEY,
  });
}
