import { createClient } from '@/lib/supabase/server';
import { loadActor } from '@/lib/data/load';
import { icsText } from '@/lib/domain/ics';

// 面談を .ics で書き出す。生徒は自分の面談、講師は自分の面談（?student= で1人に絞れる）。RLS で見える分だけ
export async function GET(request: Request) {
  const sb = await createClient();
  const actor = await loadActor(sb);
  if (!actor || actor.role === 'admin') return new Response('ログインしてください', { status: 401 });
  const studentParam = new URL(request.url).searchParams.get('student');
  let q = sb.from('meetings').select('id, student_id, coach_id, on_date, start_time, length_min').order('on_date');
  q = actor.role === 'student' ? q.eq('student_id', actor.id) : q.eq('coach_id', actor.id);
  if (studentParam && actor.role === 'coach') q = q.eq('student_id', studentParam);
  const { data: ms, error } = await q;
  if (error) return new Response('読み込めませんでした', { status: 500 });
  const ids = [...new Set((ms ?? []).flatMap(m => [m.student_id, m.coach_id]))];
  const { data: people } = await sb.from('profiles').select('id, display_name, timezone, schools(timezone)').in('id', ids.length ? ids : ['00000000-0000-0000-0000-000000000000']);
  const name = (id: string) => people?.find(p => p.id === id)?.display_name ?? '';
  // 面談の時刻は生徒のタイムゾーンの壁時計。講師の書き出しでも生徒のタイムゾーンで書く（海外の生徒の面談が講師の暦でずれないように）
  const tzOf = (id: string) => {
    const p = people?.find(x => x.id === id);
    const school = (Array.isArray(p?.schools) ? p?.schools[0] : p?.schools) as { timezone: string } | null | undefined;
    return p?.timezone || school?.timezone || actor.timeZone;
  };
  const body = icsText(actor.role === 'student' ? 'Actify 面談' : `Actify 面談（${actor.name}）`, (ms ?? []).map(m => ({
    id: m.id, date: m.on_date, time: m.start_time.slice(0, 5), len: m.length_min,
    summary: actor.role === 'student' ? `面談（${name(m.coach_id)}先生）` : `面談：${name(m.student_id)}`,
    timeZone: actor.role === 'student' ? actor.timeZone : tzOf(m.student_id),
  })), actor.timeZone);
  return new Response(body, { headers: { 'Content-Type': 'text/calendar; charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent('actify-面談.ics')}`, 'Cache-Control': 'no-store' } });
}
