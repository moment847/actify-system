import { requireRole } from '@/server/guard';
import { studentHomeView } from '@/server/views';
import { dur } from '@/lib/domain/dates';
import { SignOut } from '../signout-button';

// 確認用の仮の画面（バックエンドがつながっているかを見る）。モック v19 の画面の移植は次の段階
export default async function StudentHome() {
  const { sb, actor } = await requireRole('student');
  const v = await studentHomeView(sb, actor);
  return (
    <main>
      <h1>こんにちは、{v.name}さん</h1>
      <p className="muted">今日の勉強 {dur(v.studiedToday)}（{v.todayDone}/{v.todayCount}件 完了）{v.goal?.daysLeft != null && ` · ${v.goal.school}まで${v.goal.daysLeft}日`}</p>
      <h2>次の予定</h2>
      <p>{v.hero ? `${v.hero.time} ${v.hero.title}（${dur(v.hero.duration)}）${v.hero.hasQuiz ? ` · 小テスト ${v.hero.max}点` : ''}` : '今日の予定はありません'}</p>
      <h2>参考書の進み</h2>
      <table><tbody>{v.books.map(b => <tr key={b.material.id}><td>{b.material.short}</td><td>{b.done}/{b.total}範囲</td><td>今日の目安 {b.expected}</td><td>{b.status.label}</td></tr>)}</tbody></table>
      <h2>やり残し</h2>
      <p>{v.missed.length ? v.missed.map(t => `${t.date} ${t.title}`).join('、') : 'ありません'}</p>
      <SignOut />
    </main>
  );
}
