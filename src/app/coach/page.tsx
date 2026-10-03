import { requireRole } from '@/server/guard';
import { coachHomeView } from '@/server/views';
import { SignOut } from '../signout-button';

// 確認用の仮の画面。モック v19 の「生徒」画面の移植は次の段階
export default async function CoachHome() {
  const { sb, actor } = await requireRole('coach');
  const v = await coachHomeView(sb, actor);
  return (
    <main>
      <h1>担当の生徒 {v.cards.length}人</h1>
      <table><tbody>{v.cards.map(c => (
        <tr key={c.id}><td>{c.name}</td><td>{c.goalSchool}まで{c.daysLeft}日</td><td>今週 {c.thisWeek.done}/{c.thisWeek.due}件</td>
          <td>{c.alerts.length ? c.alerts.map(a => a.text).join('・') : '気になる点はありません'}</td></tr>))}</tbody></table>
      <SignOut />
    </main>
  );
}
