import { createAdminClient } from '@/lib/supabase/admin';
import { extractLinkCode, replyText, type LineEvent } from '@/lib/integrations/line';
import { verifyLineSignature } from '@/lib/integrations/signatures';
import { loadLineChannel } from '@/server/line-channel';

// 塾の LINE 公式アカウントの Webhook。URL は https://<サイト>/api/line/webhook/<塾のID>（運営の「LINE の設定」画面に出る）
// - 友だち追加：合言葉の送り方を返す
// - 合言葉（8文字）：保護者とつなぎ、生徒の名前を返す
// 返事は reply なので、月の無料通数を使わない。署名が合わなければ何もしない
const HOW = '友だち追加ありがとうございます。塾から受け取った「合言葉」（8文字）をこのトークに送ってください。お子さまの学習の週の報告が毎週日曜の夜に届きます。';

export async function POST(req: Request, ctx: RouteContext<'/api/line/webhook/[school]'>) {
  const { school } = await ctx.params;
  if (!/^[0-9a-f-]{36}$/i.test(school)) return new Response('not found', { status: 404 });
  const raw = await req.text();
  const admin = createAdminClient();
  const ch = await loadLineChannel(admin, school).catch(() => null);
  if (!ch || !verifyLineSignature(raw, req.headers.get('x-line-signature'), ch.secret)) return new Response('bad signature', { status: 401 });

  let events: LineEvent[] = [];
  try { events = (JSON.parse(raw).events ?? []) as LineEvent[]; } catch { return new Response('bad request', { status: 400 }); }
  // LINE の「Webhook の検証」は events が空。200 を返せばよい
  for (const ev of events) {
    const user = ev.source?.type === 'user' ? ev.source.userId : undefined;
    if (!ev.replyToken || !user) continue;
    try {
      if (ev.type === 'follow') { await replyText(ch.token, ev.replyToken, HOW); continue; }
      if (ev.type === 'unfollow') continue;
      if (ev.type !== 'message' || ev.message?.type !== 'text') continue;
      const code = extractLinkCode(ev.message.text ?? '');
      if (!code) { await replyText(ch.token, ev.replyToken, 'このアカウントは送信専用です。ご質問は塾へ直接お問い合わせください。\n保護者の登録は、塾から受け取った合言葉（8文字）を送ってください。'); continue; }
      const { data: gid } = await admin.rpc('link_guardian_line', { p_school: school, p_code: code, p_line_user: user });
      if (!gid) { await replyText(ch.token, ev.replyToken, '合言葉が見つからないか、期限（14日）が切れています。塾に新しい合言葉をお問い合わせください。'); continue; }
      const { data: g } = await admin.from('guardians').select('student_id, students(profiles(display_name))').eq('id', gid).single();
      const st = g?.students as unknown as { profiles: { display_name: string } } | null;
      await replyText(ch.token, ev.replyToken, `${st?.profiles?.display_name ?? 'お子さま'}さんの保護者として登録しました。毎週日曜の夜に、学習の週の報告をお送りします。`);
    } catch (e) {
      console.error('[line webhook]', school, e instanceof Error ? e.message : e);
    }
  }
  return new Response('ok');
}
