import { requireRole } from '@/server/guard';
import { adminAccountsView, adminMaterialsView } from '@/server/views';
import { SignOut } from '../signout-button';

// 確認用の仮の画面。モック v19 の「教材」「アカウント」画面の移植は次の段階
export default async function AdminHome() {
  const { sb, actor } = await requireRole('admin');
  const [mats, people] = await Promise.all([adminMaterialsView(sb), adminAccountsView(sb)]);
  return (
    <main>
      <h1>{actor.schoolName}</h1>
      <h2>登録済みの教材 {mats.length}冊</h2>
      <table><tbody>{mats.map(m => <tr key={m.id}><td>{m.name}</td><td>{m.kind === 'input' ? 'インプット' : '演習'}</td><td>{m.units.length}範囲</td><td>小テスト {m.covered}/{m.units.length}範囲</td><td>{m.students}人</td></tr>)}</tbody></table>
      <h2>アカウント {people.length}人</h2>
      <table><tbody>{people.map(p => <tr key={p.id}><td>{p.name}</td><td>{({ student: '生徒', coach: '講師', admin: '運営' } as const)[p.role as 'student']}</td><td>{p.grade}</td><td>{p.status === 'active' ? '在籍' : p.status === 'paused' ? '休会' : '退会'}</td></tr>)}</tbody></table>
      <SignOut />
    </main>
  );
}
