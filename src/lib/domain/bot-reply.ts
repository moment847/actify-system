// Actifyくんの「決まった文」の返事（モック v19 の botReply を移したもの）。
// AI のキーが無いとき・AI が失敗したときの返事に使う。中身はアプリのデータだけから作る。
import { byTime, md, mdw } from './dates';
import { bookProgress, booksOf, mat, nextMeeting, tasksOf, unitOf } from './plan';
import type { World } from './types';
import { TAG_LABEL } from './types';

export type BotMood = 'normal' | 'support' | 'done' | 'think' | 'sleep' | 'wink' | 'happy';
export interface BotReply { mood: BotMood; text: string }

export const BOT_NAME = 'Actifyくん';
export const BOT_TOPICS = ['今日なにからやる？', '参考書、間に合う？', '苦手なところは？', '覚え方のコツは？', 'やる気が出ない', '問題の解き方を聞きたい'];

const label = (w: World, unitId: string | null) => unitOf(w, unitId)?.unit.label ?? '';

export function ruleReply(w: World, sid: string, text: string, opts: { hasImage?: boolean; coachName?: string } = {}): BotReply {
  const q = String(text).normalize('NFKC'), coach = opts.coachName || '先生';
  const today = tasksOf(w, sid).filter(t => t.date === w.today);
  const rest = today.filter(t => t.status !== 'done').sort(byTime);
  const name = (t: (typeof rest)[number]) => t.title || `${mat(w, t.materialId)?.short ?? ''} ${label(w, t.unitId)}`.trim();
  if (opts.hasImage) return { mood: 'think', text: '写真ありがとう！\nどこまでわかって、どこで止まったか教えてくれる？「2行目の式変形がわからない」みたいに。' };
  if (/今日|なにから|何から|次|やること/.test(q)) {
    if (!rest.length) return { mood: 'done', text: (today.length ? '今日の予定はぜんぶ終わってるよ。おつかれさま！' : '今日は先生が入れた予定がないよ。') + '\n余裕があれば、点が低かった範囲を見直すのがおすすめ。「苦手なところは？」って聞いてみて。' };
    return { mood: 'support', text: `今日はあと${rest.length}つだよ。\n${rest.map(t => `・${t.time} ${name(t)}（${t.duration}分）`).join('\n')}\n\nまずは ${rest[0].time} の ${name(rest[0])} から。${rest[0].quizVersionId ? '小テストはホームの「次の予定」から開けるよ。' : ''}` };
  }
  if (/間に合|進み|進捗|ペース|終わ|参考書/.test(q)) {
    const ps = booksOf(w, sid).map(b => bookProgress(w, sid, b.materialId)), late = ps.filter(p => p.status.tone !== 'green');
    if (!ps.length) return { mood: 'think', text: 'まだ参考書が登録されていないみたい。面談で先生と決めてね。' };
    return { mood: late.length ? 'think' : 'happy', text: `参考書の進みはこんな感じ。\n${ps.map(p => `・${p.m.short}：${p.done}/${p.total}範囲（${p.status.label}）${p.finish ? ` このペースだと${md(p.finish)}に1周。目標は${md(p.b.target)}` : ''}`).join('\n')}\n\n${late.length ? `${late.map(p => p.m.short).join('・')}が少し遅れてるね。${late.map(p => `${p.m.short}は週${Math.ceil(p.needPerWeek * 10) / 10}範囲`).join('、')}のペースなら間に合うよ。勉強できる時間を少し増やせそうなら「予定」で塗っておくと、先生がそこに入れてくれるよ。` : '全部順調！この調子でいこう。'}` };
  }
  if (/苦手|伸び|点|弱|低|間違/.test(q)) {
    const cells = booksOf(w, sid).flatMap(b => bookProgress(w, sid, b.materialId).cells.filter(c => c.last != null).map(c => ({ ...c, m: mat(w, b.materialId)! })))
      .sort((a, b) => a.last! - b.last!).slice(0, 3);
    if (!cells.length) return { mood: 'think', text: 'まだ点数の記録が少ないみたい。小テストを解いたら点数を入れてね。' };
    const cm = tasksOf(w, sid).filter(t => t.unitId === cells[0].n.id && t.feedback).sort(byTime).at(-1);
    const said = cm?.feedback ? cm.feedback.body || (cm.feedback.tag ? TAG_LABEL[cm.feedback.tag] : '') : '';
    return { mood: 'think', text: `点が低めなのはここだよ。\n${cells.map(c => `・${c.m.short} ${c.n.label}：${c.last}%`).join('\n')}\n${said ? `\n${cells[0].n.label}では「${said}」って書いてたね。` : ''}\n再テストは間をあけてやると記憶に残りやすいんだ。先生が予定に入れてくれるから、その日にもう一度やってみよう。` };
  }
  if (/やる気|疲|眠|しんど|だる|つら|むり|無理/.test(q)) {
    const s = [...rest].sort((a, b) => a.duration - b.duration)[0];
    return { mood: 'sleep', text: `そういう日もあるよね。まずは5分だけやってみない？\n${s ? `いちばん短いのは「${name(s)}」（${s.duration}分）。\n` : ''}始めると、やる気はあとからついてくることが多いんだ。どうしてもしんどい日は、${coach}に一言伝えておくと計画を調整してもらえるよ。` };
  }
  if (/写真|解き方|わから|解説|問題/.test(q)) return { mood: 'think', text: '問題の写真を送ってね（入力欄の左の画像ボタン）。\nどこまでわかって、どこで止まったかも一言そえてくれると、ヒントを出しやすいよ。' };
  if (/覚え|暗記|単語|勉強法|やり方|コツ/.test(q)) return { mood: 'support', text: '暗記ものは「思い出す練習」がいちばん効くよ。\n・見て覚えるより、隠してテスト\n・1日後 → 7日後 → 30日後にもう一度\n・電車みたいな短い時間に回すと続けやすい\n\nActifyの再テストも、この間隔で先生が入れるようになってるよ。' };
  if (/先生|コーチ|面談|相談/.test(q)) {
    const nx = nextMeeting(w, sid);
    return { mood: 'support', text: `${nx ? `次の面談は${mdw(nx.date)} ${nx.time}だよ。` : '面談の予約がまだだよ。「予定」の上から前日までに選べるよ。'}\n計画を変えたいときや、ぼくじゃ答えにくい悩みは${coach}に相談してね。` };
  }
  if (/ありがと|できた|終わった/.test(q)) return { mood: 'done', text: 'やったね！その調子！' };
  if (/^(お[けっ]|ok|オッケ|了解|りょ|わかった|うん|はい|おけ)/i.test(q.trim())) return { mood: 'wink', text: 'よし、その調子！\nまた聞きたいことがあったら、いつでも呼んでね。' };
  return { mood: 'think', text: 'うーん、ごめんね。まだうまく答えられないかも。\nこんなことなら得意だよ。\n・今日なにからやる？\n・参考書、間に合う？\n・苦手なところは？\n・やる気が出ない' };
}

/** AI に渡す「この生徒の今の状況」。アプリのデータだけで作る（AI に推測させない） */
export function studentContext(w: World, sid: string, info: { name: string; goal?: string; examOn?: string | null; coachName?: string; todos?: { onDate: string; todo: string }[] }) {
  const today = tasksOf(w, sid).filter(t => t.date === w.today).sort(byTime);
  const lines: string[] = [];
  lines.push(`今日：${mdw(w.today)}`);
  lines.push(`生徒：${info.name}${info.goal ? `（第一志望 ${info.goal}${info.examOn ? `・入試 ${md(info.examOn)}` : ''}）` : ''}`);
  if (info.coachName) lines.push(`担当の講師：${info.coachName}`);
  lines.push('今日の予定：' + (today.length ? '' : 'なし'));
  today.forEach(t => lines.push(`- ${t.time} ${t.title || `${mat(w, t.materialId)?.name ?? ''} ${label(w, t.unitId)}`}（${t.duration}分）${t.status === 'done' ? ` 完了${t.score != null ? ` ${t.score}/${t.max}点` : ''}` : ''}${t.retest ? ' 再テスト' : ''}`));
  const missed = tasksOf(w, sid).filter(t => t.status !== 'done' && t.date < w.today).sort(byTime);
  if (missed.length) lines.push(`やり残し：${missed.map(t => `${md(t.date)} ${t.title || `${mat(w, t.materialId)?.short ?? ''} ${label(w, t.unitId)}`}`).join('、')}`);
  lines.push('参考書の進み：');
  booksOf(w, sid).forEach(b => { const p = bookProgress(w, sid, b.materialId);
    lines.push(`- ${p.m.name}：${p.done}/${p.total}範囲・${p.status.label}・今日の目安${p.expected}範囲・目標${md(p.b.target)}に1周${p.finish ? `・このペースだと${md(p.finish)}` : ''}${p.avg != null ? `・平均${p.avg}%` : ''}`); });
  const weak = booksOf(w, sid).flatMap(b => bookProgress(w, sid, b.materialId).cells.filter(c => c.last != null && c.last < 70).map(c => `${mat(w, b.materialId)!.short} ${c.n.label} ${c.last}%`)).slice(0, 6);
  if (weak.length) lines.push(`点が低め（70%未満）：${weak.join('、')}`);
  const nx = nextMeeting(w, sid);
  lines.push(`次の面談：${nx ? `${mdw(nx.date)} ${nx.time}` : 'まだ予約していない'}`);
  // 面談で先生と決めた「次回までにやること」（講師が生徒に共有した欄だけ。議事録の本文は渡さない）
  if (info.todos?.length) {
    lines.push('先生と決めた次回までにやること：');
    info.todos.forEach(t => lines.push(`- ${md(t.onDate)}の面談：${t.todo.replace(/\s*\n\s*/g, '／').slice(0, 300)}`));
  }
  return lines.join('\n');
}
