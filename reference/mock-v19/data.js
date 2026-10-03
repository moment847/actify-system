'use strict';
/* データ：初期データの生成と、画面から読む値（すべて state から導く）

   使い分けの原則
   - 小テストの「使った／予定に付いた」は tasks.pdf だけが唯一の記録。別に used 配列を持たない
     （同じ生徒に同じ版が二度配られない、を1か所で保証するため）
   - 再テストの時期は「その範囲の採点済みの回数」と教材の間隔から毎回計算する。候補の行を保存しない
   - 1回の所要時間は教材では決めない。その生徒のその教材の実績（直近5回）から決める */

const SUBJECTS = { 英語: 'en', 数学: 'math', 国語: 'jp', 理科: 'sci', 社会: 'soc', その他: 'free' };
const TAGS = ['かんたん', 'ちょうどいい', 'むずかしい', '時間が足りない'];

function makeMaterials() {
  const M = (id, name, short, subject, type, intervals, keys, labels) =>
    ({ id, name, short, subject, kind: SUBJECTS[subject], type, intervals, keys, toc: null, nodes: labels.map((label, i) => ({ id: `${id}-${i + 1}`, label })) });
  const en = Array.from({ length: 19 }, (_, i) => `${String(i * 100 + 1).padStart(3, '0')}–${String((i + 1) * 100).padStart(3, '0')}`);
  const rd = ['Unit 01 食と文化', 'Unit 02 教育', 'Unit 03 環境と暮らし', 'Unit 04 科学と技術', 'Unit 05 社会と経済', 'Unit 06 医療と健康', 'Unit 07 言語', 'Unit 08 歴史と文化財', 'Unit 09 心理と行動', 'Unit 10 都市', 'Unit 11 技術と倫理', 'Unit 12 グローバル社会'];
  const ma = ['数と式 ①', '数と式 ②', '二次関数 ①', '二次関数 ②', '二次関数 ③', '二次関数 ④', '図形と計量 ①', '図形と計量 ②', '図形と計量 ③', 'データの分析 ①', 'データの分析 ②', '場合の数 ①', '場合の数 ②', '場合の数 ③', '確率 ①', '確率 ②', '確率 ③', '整数 ①', '整数 ②', '整数 ③'];
  const jp = ['古文単語 001–050', '古文単語 051–100', '古文単語 101–150', '古文単語 151–200', '古文単語 201–250', '用言の活用', '助動詞 ①', '助動詞 ②', '助詞', '敬語'];
  return [
    M('en', '英単語ターゲット1900', 'ターゲット1900', '英語', 'インプット', [1, 7, 30], ['ターゲット', 'target', '英単語'], en),
    M('rd', '英語長文トレーニング', '長文トレ', '英語', '演習', [], ['長文', 'reading'], rd),
    M('ma', '数学Ⅰ・A 基礎演習', '数学基礎', '数学', '演習', [], ['数学', '数ia', 'math'], ma),
    M('jp', '古文単語・文法', '古文', '国語', 'インプット', [1, 3, 7], ['古文', 'kobun'], jp),
    // 教材を使わない予定（学校の課題・模試の直しなど）。一覧には出さない
    { ...M('free', 'その他の学習', 'その他', 'その他', '演習', [], [], []), hidden: true },
  ];
}

function seed() {
  const s = {
    v: 8, materials: makeMaterials(), pdfs: [], tasks: [], avail: [], availSkip: [], books: [], skips: [],
    // 講師の面談カレンダー：面談できる時間（毎週）と、生徒ごとの毎週の予約
    coachOpen: [], meetings: [], booking: { len: 30, published: true },
    people: [
      { id: 's1', name: '山田 陽菜', role: '生徒', grade: '高校3年', status: '在籍', goal: { school: '早稲田大学', faculty: '商学部', date: '2027-02-21' } },
      { id: 's2', name: '小林 悠真', role: '生徒', grade: '高校3年', status: '在籍', goal: { school: '慶應義塾大学', faculty: '経済学部', date: '2027-02-14' } },
      { id: 's3', name: '佐藤 美咲', role: '生徒', grade: '高校2年', status: '在籍', goal: { school: '明治大学', faculty: '文学部', date: '2028-02-10' } },
      { id: 's4', name: '高橋 蓮', role: '生徒', grade: '高校3年', status: '在籍', goal: { school: '上智大学', faculty: '外国語学部', date: '2027-02-05' } },
      { id: 'c1', name: '佐々木 雄光', role: '講師', grade: '担当 4名', status: '在籍' },
      { id: 'a1', name: 'Actify 運営', role: '運営', grade: '', status: '在籍' },
    ],
    coach: {
      s1: { message: '朝の単語が習慣になってきました。長文は少し遅れ気味なので、土曜の午前にまとめて入れています。', memo: '部活は月・水・金。定期試験の前週は面談で計画を調整する。' },
      s2: { message: 'いいペースです。数学の確率に入ったら一度面談で確認しましょう。', memo: '' },
      s3: { message: '', memo: '9/30 以降の記録が無い。LINEで様子を聞く。' },
      s4: { message: '', memo: '電車の30分を単語に固定済み。' },
    },
    resources: [
      { id: 'd1', name: 'Actify 学習の進め方', date: '2026-09-28', target: 'all', url: 'assets/study-guide.pdf' },
      { id: 'd2', name: '面談の準備シート', date: '2026-09-30', target: 's1', url: 'assets/study-guide.pdf' },
      { id: 'd3', name: '英語長文 読み方のポイント', date: '2026-10-01', target: 'all', url: 'assets/study-guide.pdf' },
    ],
    chat: {},
  };
  // 小テスト（問題と解答のPDF）。初期は共通のサンプルPDFを使う
  const Q = 'assets/sample-questions.pdf', A = 'assets/sample-answers.pdf';
  const addPdf = (nid, version, max) => s.pdfs.push({ id: `p-${nid}-${version}`, node: nid, version, max, problem: Q, answer: A, name: `${nid}_v${version}.pdf` });
  s.materials.forEach(m => m.nodes.forEach((n, i) => {
    const k = i + 1;
    // 英単語は4版、古文は前半だけ3版（後半は2版なので、再テストが重なると「使っていない版がない」が起きる）
    if (m.id === 'en') for (let v = 1; v <= (k <= 10 ? 4 : 2); v++) addPdf(n.id, v, 20);
    if (m.id === 'jp') for (let v = 1; v <= (k <= 3 ? 3 : 2); v++) addPdf(n.id, v, 20);
    if (m.id === 'rd' && k <= 10) addPdf(n.id, 1, 20);
    if (m.id === 'ma' && k <= 12) addPdf(n.id, 1, 10);
  }));
  // 勉強できる時間：生徒が週ごとに登録する（毎週くり返しではない。「先週と同じにする」で写せる）
  // 山田・小林は来週分も登録済み。佐藤・高橋はまだ（講師の計画に「未登録」が出る）
  const PAT = {
    s1: [[[0, 1, 2, 3, 4], '06:00', '06:45', '朝'], [[0, 1, 2, 3, 4], '07:20', '07:50', '電車'], [[0, 2, 4], '19:30', '22:30'], [[1, 3], '21:15', '23:00', '塾のあと'], [[5], '09:00', '12:00'], [[5], '14:00', '17:00'], [[6], '10:00', '12:00'], [[6], '19:00', '21:00']],
    s2: [[[0, 1, 2, 3, 4], '06:30', '07:15', '朝'], [[0, 1, 2, 3, 4], '21:00', '23:00'], [[5], '13:00', '18:00'], [[6], '09:00', '12:00']],
    s3: [[[0, 1, 2, 3, 4], '19:00', '21:00'], [[5], '10:00', '12:00']],
    s4: [[[0, 1, 2, 3, 4], '07:00', '07:30', '電車'], [[0, 1, 2, 3, 4], '21:00', '22:30'], [[5, 6], '14:00', '17:00']],
  };
  const until = { s1: dateAdd(weekStart(DAY), 7), s2: dateAdd(weekStart(DAY), 7), s3: weekStart(DAY), s4: weekStart(DAY) };
  for (const [sid, pats] of Object.entries(PAT)) for (let w = '2026-09-07'; w <= until[sid]; w = dateAdd(w, 7)) pats.forEach(([days, start, end, label = '']) => days.forEach(i => {
    if (sid === 's1' && w === dateAdd(weekStart(DAY), 7) && i === 3) return;           // 来週の木曜は登録していない（部活の試合）
    s.avail.push({ id: uid(), student: sid, date: dateAdd(w, i), start, end, label }); }));
  // 面談できる時間（講師が週ごとに塗る）と、予約（日付ごと。前日まで）
  const O = (w, days, start, end) => days.forEach(i => s.coachOpen.push({ id: uid(), date: dateAdd(w, i), start, end }));
  for (const w of [weekStart(DAY), dateAdd(weekStart(DAY), 7)]) { O(w, [0, 2], '19:00', '21:00'); O(w, [4], '20:00', '22:00'); O(w, [5], '13:00', '17:00'); O(w, [6], '18:00', '21:00'); }
  const MT = (student, date, time) => s.meetings.push({ id: uid(), student, date, time, len: 30 });
  MT('s2', '2026-10-03', '13:30'); MT('s3', '2026-09-28', '19:00'); MT('s4', '2026-10-03', '15:00'); MT('s1', '2026-09-26', '14:00'); MT('s2', '2026-09-26', '13:30');
  MT('s2', '2026-10-10', '13:30');
  // 担当の参考書と「いつまでに1周」
  const B = (student, material, target, start) => s.books.push({ student, material, target, start });
  B('s1', 'en', '2026-11-15', '2026-09-07'); B('s1', 'rd', '2026-11-15', '2026-09-07'); B('s1', 'ma', '2026-11-30', '2026-09-07'); B('s1', 'jp', '2026-10-31', '2026-09-07');
  B('s2', 'en', '2026-11-10', '2026-09-07'); B('s2', 'rd', '2026-12-10', '2026-09-07'); B('s2', 'ma', '2026-11-30', '2026-09-07');
  B('s3', 'en', '2027-01-31', '2026-09-14'); B('s3', 'ma', '2027-01-31', '2026-09-14'); B('s3', 'jp', '2026-12-31', '2026-09-14');
  B('s4', 'en', '2026-11-10', '2026-09-07'); B('s4', 'rd', '2026-12-15', '2026-09-07'); B('s4', 'jp', '2026-11-30', '2026-09-07');
  return s;
}

/* これまでの学習の記録を、勉強できる時間の中に機械的に作る（デモ用） */
const COMMENT_TEXT = {
  en: ['派生語が覚えにくい', 'affect と effect で迷った', '電車で2周できた', '後半の50語があやしい', '発音もいっしょに確認した'],
  rd: ['設問2の根拠が見つけられなかった', '時間を測ったら8分オーバー', '知らない単語が多くて止まった', '段落ごとの要約がうまくできた'],
  math: ['場合分けで手が止まった', '計算ミスが2問', '解説を読んだらわかった', '例題は解けたが練習問題が難しい'],
  jp: ['敬語の種類がまだ混ざる', '接続を覚え直したい', '品詞分解に時間がかかった', 'ほぼ覚えた'],
};
/* 先生の返信は、生徒のひとことに合わせる（同じ文をくり返さない） */
const REPLY_FOR = {
  '派生語が覚えにくい': '派生語は元の単語とセットで、例文ごと覚えよう。', 'affect と effect で迷った': 'affect は動詞、effect は名詞で覚えよう。',
  '電車で2周できた': '短い時間に回せているのがいいね。', '後半の50語があやしい': '後半だけ、明日の朝にもう一度テストしよう。', '発音もいっしょに確認した': '発音まで見られているのはえらい。',
  '設問2の根拠が見つけられなかった': '設問を先に読んでから本文へ。根拠に線を引こう。', '時間を測ったら8分オーバー': '時間は気にせず、まず根拠に線を引くところから。',
  '知らない単語が多くて止まった': '止まった単語に丸をつけておいて。次の面談で見よう。', '段落ごとの要約がうまくできた': 'その要約、面談で見せてね。',
  '場合分けで手が止まった': '次の面談で一緒に解き直そう。', '計算ミスが2問': 'どの計算で間違えたか、余白にメモしておこう。', '解説を読んだらわかった': '3日後に、解説なしでもう一度解いてみよう。',
  '例題は解けたが練習問題が難しい': '練習問題は1問だけでOK。例題と解き方を比べよう。', '敬語の種類がまだ混ざる': '尊敬・謙譲・丁寧を「誰から誰へ」で分けてみよう。',
  '接続を覚え直したい': '接続の表を1枚にまとめて、朝に見よう。', '品詞分解に時間がかかった': '最初は時間がかかって当たり前。慣れると速くなるよ。', 'ほぼ覚えた': 'この調子！',
};
const replyFor = c => REPLY_FOR[c.text] || (c.tag === 'むずかしい' || c.tag === '時間が足りない' ? '次の面談で一緒に確認しよう。' : 'この調子！');
function generateHistory() {
  const P = {
    s1: { from: '2026-09-07', seed: 11, done: .9, skill: { en: .86, rd: .74, ma: .7, jp: .66 }, pace: { en: 30, rd: 55, ma: 45, jp: 30 }, speed: { en: 1.15, rd: .75, ma: 1.1, jp: .9 }, wd: 3, we: 3, reply: .3 },
    s2: { from: '2026-09-07', seed: 22, done: .93, skill: { en: .88, rd: .82, ma: .84 }, pace: { en: 25, rd: 45, ma: 40 }, speed: { en: 1.2, rd: 1.1, ma: 1.05 }, wd: 3, we: 3, reply: .1 },
    s3: { from: '2026-09-14', seed: 33, done: .78, skill: { en: .7, ma: .58, jp: .72 }, pace: { en: 35, ma: 50, jp: 30 }, speed: { en: .9, ma: .7, jp: .9 }, wd: 2, we: 2, stop: '2026-09-29', reply: 0 },
    s4: { from: '2026-09-07', seed: 44, done: .84, skill: { en: .9, rd: .8, jp: .64 }, pace: { en: 25, rd: 50, jp: 35 }, speed: { en: 1.2, rd: .7, jp: 1 }, wd: 3, we: 3, reply: .05 },
  };
  const thisWeek = weekStart(DAY);
  for (const [sid, o] of Object.entries(P)) {
    const r = rng(o.seed), books = state.books.filter(b => b.student === sid).map(b => mat(b.material)), firstCount = {};
    for (let d = o.from; d <= dateAdd(DAY, 1); d = dateAdd(d, 1)) {
      const future = d > DAY;
      let budget = future ? 2 : dow(d) >= 5 ? o.we : o.wd;
      for (const b of availOn(sid, d)) {
        let t = toMin(b.start);
        const short = toMin(b.end) - toMin(b.start) <= 50;
        while (budget > 0) {
          // 短い枠（朝・電車）は覚える教材だけ。再テストの時期が来ていれば先にやる
          const pool = books.filter(m => !short || m.type === 'インプット');
          const due = reviewQueue(sid, d).filter(x => x.due <= d && pool.includes(x.mat) && freePdf(sid, x.node));
          let m, nid, retest = false;
          if (due.length && (short || r() < .5)) { m = due[0].mat; nid = due[0].node; retest = true; }
          else {
            // 新しい範囲は「目標日から逆算した今日までの目安 × 生徒の速さ」に追いつくまで
            const allow = x => { const bk = book(sid, x.id), span = Math.max(1, daysBetween(bk.start, bk.target));
              return (firstCount[x.id] || 0) < Math.ceil(x.nodes.length * (daysBetween(bk.start, d) + 1) / span * o.speed[x.id]) + 1; };
            const cands = pool.filter(x => nextNode(sid, x.id) && allow(x));
            if (!cands.length) break;
            m = cands.sort((a, b) => (firstCount[a.id] || 0) / a.nodes.length - (firstCount[b.id] || 0) / b.nodes.length)[0];
            nid = nextNode(sid, m.id).id; firstCount[m.id] = (firstCount[m.id] || 0) + 1;
          }
          const planned = o.pace[m.id];
          if (t + planned > toMin(b.end)) break;
          const done = !future && (d < DAY ? r() < o.done && !(o.stop && d > o.stop) : t < 12 * 60);
          if (!done && d < thisWeek) { t += planned + 10; budget--; continue; } // 古い週のやり残しは組み直された扱い
          const p = freePdf(sid, nid);
          const task = { id: uid(), student: sid, date: d, time: toTime(t), duration: planned, material: m.id, node: nid, status: done ? 'done' : 'todo', pdf: p?.id || null, max: p?.max, retest };
          if (done) {
            task.actual = Math.max(10, planned + Math.round((r() - .4) * 12));
            if (p) task.score = clamp(Math.round(p.max * (o.skill[m.id] + (r() - .5) * .3 + (retest ? .08 : 0))), 0, p.max);
            if (r() < .45) {
              const sp = task.score != null ? pct(task.score, task.max) : 75;
              const tag = task.actual > planned + 3 && r() < .5 ? '時間が足りない' : sp >= 85 ? 'かんたん' : sp >= 65 ? 'ちょうどいい' : 'むずかしい';
              task.comment = { tag, text: r() < .8 ? pick(r, COMMENT_TEXT[m.kind]) : '' };
              if (r() < o.reply) { r(); task.reply = { text: replyFor(task.comment), date: dateAdd(d, 1) > DAY ? DAY : dateAdd(d, 1) }; } // r() は v16 と同じ記録になるように乱数を1つ進める
            }
          }
          state.tasks.push(task); t += planned + 10; budget--;
        }
      }
    }
  }
  // デモ用：記録を作ったあとで目標日を少し先にする（「順調」と「遅れ」の両方が見えるように）
  book(ME, 'en').target = '2026-12-20'; book(ME, 'ma').target = '2026-12-20';
  // デモの見せ場①：今日の夜の予定（ホームの「次の予定」）を必ず用意する
  const tonight = availOn(ME, DAY).find(a => a.start >= '17:00');
  if (tonight && !state.tasks.some(t => t.student === ME && t.date === DAY && t.time >= tonight.start)) {
    let t0 = toMin(tonight.start);
    for (const mid of ['rd', 'jp']) {
      const n = nextNode(ME, mid), len = typicalDur(ME, mid); if (!n || t0 + len > toMin(tonight.end)) continue;
      const p = freePdf(ME, n.id);
      state.tasks.push({ id: uid(), student: ME, date: DAY, time: toTime(t0), duration: len, material: mid, node: n.id, status: 'todo', pdf: p?.id || null, max: p?.max, retest: false });
      t0 += len + 5;
    }
  }
  // 教材なしの予定の例（模試の直し）
  state.tasks.push({ id: uid(), student: ME, date: dateAdd(DAY, 1), time: '14:00', duration: 60, material: 'free', node: 'free:moshi', title: '模試の直し（英語）', status: 'todo', pdf: null, noQuiz: true });
  // デモの見せ場②：昨日のやり残しを1件、確実に作る
  const y = state.tasks.filter(t => t.student === ME && t.date === dateAdd(DAY, -1)).sort(byTime).at(-1);
  if (y && y.status === 'done') { y.status = 'todo'; delete y.actual; delete y.score; delete y.comment; delete y.reply; }
  state.chat[ME] = [{ from: 'bot', mood: 'happy', text: `やあ、陽菜さん！受験AIの${BOT_NAME}だよ。\n今日の予定、参考書の進み具合、苦手なところ、なんでも聞いてね。`, at: DAY }];
}

/* ---------- 読み出し ---------- */
const mat = id => state.materials.find(m => m.id === id);
const node = id => {
  if (String(id).startsWith('free:')) { const t = state.tasks.find(x => x.node === id); return { id, label: t?.title || 'その他の学習', m: mat('free'), index: 0, free: true }; }
  for (const m of state.materials) { const n = m.nodes.find(n => n.id === id); if (n) return { ...n, m, index: m.nodes.indexOf(n) }; } return { id, label: '（削除された範囲）', m: state.materials[0], index: 0 }; };
const person = id => state.people.find(p => p.id === id);
const students = () => state.people.filter(p => p.role === '生徒' && p.status !== '退会');
const first = name => name.split(' ')[1] || name;
const byTime = (a, b) => (a.date + a.time).localeCompare(b.date + b.time);
const tasksOf = sid => state.tasks.filter(t => t.student === sid);
const isMissed = t => t.status !== 'done' && t.date < DAY;
const booksOf = sid => state.books.filter(b => b.student === sid && mat(b.material));
const book = (sid, mid) => state.books.find(b => b.student === sid && b.material === mid);

/* 勉強できる時間 */
const availOn = (sid, d) => state.avail.filter(a => a.student === sid && (a.repeat ? a.weekday === dow(d) && !state.availSkip.some(x => x.id === a.id && x.date === d) : a.date === d))
  .sort((a, b) => a.start.localeCompare(b.start));
/* その週の勉強できる時間が登録されているか。先週の登録を写す（講師も生徒も使う） */
const availRegistered = (sid, start) => weekDays(start).some(d => availOn(sid, d).length);
function copyAvailFromLastWeek(sid, start) {
  const prev = dateAdd(start, -7), out = [];
  weekDays(prev).forEach((d, i) => availOn(sid, d).forEach(a => { const nd = dateAdd(start, i);
    if (availOn(sid, nd).some(x => x.start === a.start && x.end === a.end)) return;
    const n = { id: uid(), student: sid, date: nd, start: a.start, end: a.end, label: a.label || '' }; state.avail.push(n); out.push(n); }));
  return out;
}
const availMinutes = (sid, start) => weekDays(start).reduce((s, d) => s + availOn(sid, d).reduce((x, a) => x + toMin(a.end) - toMin(a.start), 0), 0);
const inAvail = t => availOn(t.student, t.date).some(a => toMin(a.start) <= toMin(t.time) && toMin(a.end) >= toMin(t.time) + t.duration);

/* 小テスト（版） */
const pdfOf = t => state.pdfs.find(p => p.id === t.pdf);
const pdfsOf = nid => state.pdfs.filter(p => p.node === nid).sort((a, b) => a.version - b.version);
const needsPdf = nid => pdfsOf(nid).length > 0 || node(nid).m.type === 'インプット';
/* その生徒にまだ一度も付いていない版。付いている＝解いた（done）か予定に入っている（todo） */
const freePdf = (sid, nid, except) => pdfsOf(nid).find(p => !state.tasks.some(t => t.id !== except && t.student === sid && t.pdf === p.id));
const pdfUse = (sid, pid) => { const ts = state.tasks.filter(t => t.student === sid && t.pdf === pid); return ts.some(t => t.status === 'done') ? 'done' : ts.length ? 'planned' : null; };
const pdfMissing = t => t.status !== 'done' && !t.pdf && !t.noQuiz && !String(t.node).startsWith('free:') && needsPdf(t.node);
const visibleMats = () => state.materials.filter(m => !m.hidden);
function autoAttach() { let n = 0; state.tasks.filter(pdfMissing).forEach(t => { const f = freePdf(t.student, t.node, t.id); if (f) { t.pdf = f.id; t.max = f.max; n++; } }); return n; }

/* 参考書の進み */
const firstDone = (sid, nid) => tasksOf(sid).filter(t => t.node === nid && t.status === 'done').map(t => t.date).sort()[0];
const nextNode = (sid, mid) => mat(mid).nodes.find(n => !state.tasks.some(t => t.student === sid && t.node === n.id));
function bookProgress(sid, mid) {
  const m = mat(mid), b = book(sid, mid) || { target: dateAdd(DAY, 90), start: DAY };
  const total = m.nodes.length;
  const cells = m.nodes.map(n => {
    const ts = tasksOf(sid).filter(t => t.node === n.id).sort(byTime), done = ts.filter(t => t.status === 'done'), sc = done.filter(t => t.score != null).at(-1);
    return { n, done: done.length > 0, planned: ts.some(t => t.status !== 'done'), last: sc ? pct(sc.score, sc.max) : null, tries: done.length, first: done[0]?.date };
  });
  const done = cells.filter(c => c.done).length, rem = total - done;
  const recent = cells.filter(c => c.first && daysBetween(c.first, DAY) < 21).length;
  const perWeek = recent / 3;
  const weeksLeft = Math.max(daysBetween(DAY, b.target) / 7, .5);
  const finish = rem === 0 ? null : perWeek > 0 ? dateAdd(DAY, Math.ceil(rem / perWeek * 7)) : null;
  const late = rem === 0 ? -1 : finish ? daysBetween(b.target, finish) : 999;
  const status = rem === 0 ? { label: '1周完了', tone: 'green' } : late <= 0 ? { label: '順調', tone: 'green' } : late <= 14 ? { label: 'やや遅れ', tone: 'amber' } : { label: '遅れ', tone: 'red' };
  const span = Math.max(1, daysBetween(b.start, b.target));
  const expected = clamp(Math.round(total * daysBetween(b.start, DAY) / span), 0, total);
  const scored = cells.filter(c => c.last != null);
  return { m, b, total, done, rem, cells, perWeek, needPerWeek: rem / weeksLeft, finish, late, status, expected,
    avg: scored.length ? Math.round(scored.reduce((a, c) => a + c.last, 0) / scored.length) : null };
}

/* 1回の時間：その生徒のその教材の実績（直近5回の平均）。実績が無ければ教材の種類で仮置き */
function typicalDur(sid, mid) {
  const ts = tasksOf(sid).filter(t => t.material === mid && t.status === 'done' && t.actual).sort(byTime).slice(-5);
  if (!ts.length) return mat(mid).type === 'インプット' ? 30 : 45;
  return Math.max(15, Math.round(ts.reduce((a, t) => a + t.actual, 0) / ts.length / 5) * 5);
}

/* 再テストの候補（インプット教材だけ）。採点済みの回数 k に応じて間隔を選ぶ */
function reviewQueue(sid, asOf) {
  const out = [];
  for (const m of state.materials) {
    if (m.type !== 'インプット' || !m.intervals.length) continue;
    for (const n of m.nodes) {
      const ts = state.tasks.filter(t => t.student === sid && t.node === n.id && (!asOf || t.date <= asOf));
      if (!ts.length || ts.some(t => t.status !== 'done')) continue;
      // 段階は「やった回数」で進める（小テストが無くて点数が付かなかった回も1回と数える）
      const done = ts.sort(byTime), scored = done.filter(t => t.score != null);
      if (!scored.length) continue;
      const k = done.length, last = done.at(-1), ls = scored.at(-1), lp = pct(ls.score, ls.max);
      if (k > m.intervals.length && lp >= 60) continue; // 間隔を一通り終えて6割取れたら定着
      const interval = m.intervals[Math.min(k - 1, m.intervals.length - 1)];
      const key = `rv:${sid}:${n.id}:${k}`;
      if (state.skips.includes(key)) continue;
      out.push({ key, kind: 'review', node: n.id, mat: m, due: dateAdd(last.date, interval), last, lp, interval, k });
    }
  }
  return out.sort((a, b) => a.due.localeCompare(b.due));
}

function weekStats(sid, start = weekStart(DAY)) {
  const end = dateAdd(start, 6), ts = tasksOf(sid).filter(t => t.date >= start && t.date <= end);
  const due = ts.filter(t => t.date <= DAY || t.status === 'done'), done = due.filter(t => t.status === 'done');
  const perDay = weekDays(start).map(d => done.filter(t => t.date === d).reduce((s, t) => s + (t.actual || 0), 0));
  const bySubject = {}; done.forEach(t => { const s = mat(t.material)?.subject || '他'; bySubject[s] = (bySubject[s] || 0) + (t.actual || 0); });
  return { start, end, ts, due, done, rate: pct(done.length, due.length), minutes: perDay.reduce((a, b) => a + b, 0), perDay, bySubject, missed: ts.filter(isMissed),
    planned: ts.reduce((a, t) => a + t.duration, 0), avail: availMinutes(sid, start) };
}
const lastRecord = sid => tasksOf(sid).filter(t => t.status === 'done').map(t => t.date).sort().at(-1) || null;
/* 小テストが足りない所：予定に付けられない／2週間以内の再テストに使える版がない */
function shortages(sid) {
  const out = [];
  tasksOf(sid).filter(pdfMissing).forEach(t => out.push({ sid, node: t.node, why: `${mdw(t.date)}の予定` }));
  reviewQueue(sid).filter(r => r.due <= dateAdd(DAY, 14) && !freePdf(sid, r.node) && !out.some(x => x.node === r.node)).forEach(r => out.push({ sid, node: r.node, why: `再テスト（${r.due <= DAY ? '時期が来ています' : md(r.due) + '頃'}）` }));
  return out;
}
/* ---------- 面談（講師のカレンダー） ----------
   講師が「面談できる時間」を週ごとに塗って公開 → 生徒はその週の1回を予約する（前日まで）。毎週の固定ではない */
const meetingOn = (sid, date) => state.meetings.find(m => m.student === sid && m.date === date) || null;
const meetingInWeek = (sid, start) => state.meetings.filter(m => m.student === sid && m.date >= start && m.date <= dateAdd(start, 6)).sort((a, b) => a.date.localeCompare(b.date))[0] || null;
function nextMeeting(sid, from = DAY) { return state.meetings.filter(m => m.student === sid && m.date >= from).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time))[0] || null; }
const lastMeeting = sid => state.meetings.filter(m => m.student === sid && m.date < DAY).sort((a, b) => b.date.localeCompare(a.date))[0] || null;
const canBook = date => date > DAY;   // 前日まで（当日は予約できない）
const coachOpenOn = d => state.coachOpen.filter(o => o.repeat ? o.weekday === dow(d) : o.date === d).sort((a, b) => a.start.localeCompare(b.start));
/* その週に予約できる時間。講師の面談できる時間のうち、ほかの生徒が取っていない所。
   生徒の勉強できる時間と重なる所・先週と同じ時間・週末 を上に */
function meetingSlots(sid, start) {
  const len = state.booking.len, out = [], last = lastMeeting(sid);
  weekDays(start).filter(canBook).forEach(d => coachOpenOn(d).forEach(o => {
    for (let s = toMin(o.start); s + len <= toMin(o.end); s += 30) {
      if (state.meetings.some(m => m.student !== sid && m.date === d && toMin(m.time) < s + len && toMin(m.time) + m.len > s)) continue;
      const fit = availOn(sid, d).some(a => toMin(a.start) <= s && toMin(a.end) >= s + len), same = last && dow(last.date) === dow(d) && last.time === toTime(s);
      out.push({ date: d, time: toTime(s), fit, same, score: (fit ? 100 : 0) + (same ? 60 : 0) + [0, 0, 0, 0, 10, 20, 15][dow(d)] - s / 600 });
    }
  }));
  return out.sort((a, b) => b.score - a.score);
}
function bookMeeting(sid, date, time) {
  const w = weekStart(date);
  state.meetings = state.meetings.filter(m => !(m.student === sid && m.date >= w && m.date <= dateAdd(w, 6) && m.date >= DAY));
  const m = { id: uid(), student: sid, date, time, len: state.booking.len };
  state.meetings.push(m); return m;
}
const meetLabel = m => `${mdw(m.date)} ${range(m.time, toTime(toMin(m.time) + m.len))}`;
/* 講師の面談できる時間：週ごと。先週の分を写す */
const coachOpenRegistered = start => weekDays(start).some(d => coachOpenOn(d).length);
function copyCoachOpenFromLastWeek(start) {
  const prev = dateAdd(start, -7), out = [];
  weekDays(prev).forEach((d, i) => coachOpenOn(d).forEach(o => { const nd = dateAdd(start, i);
    if (coachOpenOn(nd).some(x => x.start === o.start && x.end === o.end)) return;
    const n = { id: uid(), date: nd, start: o.start, end: o.end }; state.coachOpen.push(n); out.push(n); }));
  return out;
}

/* ---------- 時間だけ取る予定（教材なし） ---------- */
const VAGUE = [
  { k: 'buffer', label: '予備時間', dur: 30, note: 'やり残しが出たらここで' },
  { k: 'mock', label: '模試の復習', dur: 90 },
  { k: 'school', label: '学校の課題', dur: 60 },
  { k: 'weak', label: '苦手の復習', dur: 45 },
];
const vagueOf = t => VAGUE.find(v => v.k === t.vague);

/* ---------- 範囲の順番をそろえる ----------
   まだやっていない1周目の予定は、入れた順ではなく「日付の早い順に範囲の番号が若い」ように並べ直す
   （先に土曜を入れて、あとで月曜に足しても、月曜が前の範囲になる。やり残しを後ろへ動かしたときも同じ）。小テストの版は付け直す */
function resequence(sid) {
  const changes = [];
  for (const m of state.materials) {
    if (m.id === 'free') continue;
    const plan = tasksOf(sid).filter(t => t.material === m.id && t.status !== 'done' && !t.retest).sort(byTime);
    if (plan.length < 2) continue;
    const idx = id => m.nodes.findIndex(n => n.id === id), nodes = plan.map(t => t.node).sort((a, b) => idx(a) - idx(b));
    const moved = plan.filter((t, i) => t.node !== nodes[i]);
    if (!moved.length) continue;
    moved.forEach(t => { changes.push({ t, from: t.node }); t.node = nodes[plan.indexOf(t)]; if (!t.noQuiz) t.pdf = null; });
    moved.forEach(t => { if (t.noQuiz) return; const p = freePdf(sid, t.node, t.id); t.pdf = p?.id || null; if (p) t.max = p.max; });
  }
  return changes;
}
const commentsOf = (sid, mid) => tasksOf(sid).filter(t => t.comment && (!mid || t.material === mid)).sort(byTime).reverse();

/* ---------- 計画の案 ----------
   表示中の週の「明日以降の空き時間」に、次の順で自動で置き場所を探す
   1. 再テスト（時期が来たもの） 2. やり残し 3. 各参考書の次の範囲（目標日から逆算した今週の必要数だけ） */
function freeGaps(sid, date, extra = {}) {
  const mt = meetingOn(sid, date);
  const occ = [...tasksOf(sid).filter(t => t.date === date).map(t => [toMin(t.time), toMin(t.time) + t.duration]), ...(mt ? [[toMin(mt.time), toMin(mt.time) + mt.len]] : []), ...(extra[date] || [])].sort((a, b) => a[0] - b[0]);
  const out = [];
  for (const a of availOn(sid, date)) {
    let s = toMin(a.start); const e = toMin(a.end);
    for (const [os, oe] of occ) { if (oe <= s || os >= e) continue; if (os > s) out.push([s, os]); s = Math.max(s, oe); }
    if (e - s >= 15) out.push([s, e]);
  }
  return out.filter(g => g[1] - g[0] >= 15);
}
function suggestions(sid, start, dismissed = new Set()) {
  const days = weekDays(start).filter(d => d > DAY);
  if (!days.length) return [];
  const end = dateAdd(start, 6), queue = [];
  reviewQueue(sid).filter(r => r.due <= end && !dismissed.has(r.key)).forEach(r => queue.push({ ...r, why: `再テストの時期（前回${r.lp}%・${r.interval}日あけて${r.k + 1}回目）`, earliest: r.due, dur: typicalDur(sid, r.mat.id) }));
  tasksOf(sid).filter(isMissed).forEach(t => { const key = 'mv:' + t.id; if (!dismissed.has(key)) queue.push({ key, kind: 'move', task: t, node: t.node, mat: mat(t.material), why: `やり残し（${mdw(t.date)}にできなかった分）`, earliest: DAY, dur: t.duration }); });
  const lanes = booksOf(sid).map(b => {
    const p = bookProgress(sid, b.material), weekly = Math.ceil(p.rem / Math.max(daysBetween(start, b.target) / 7, .5));
    const already = tasksOf(sid).filter(t => t.material === b.material && !t.retest && t.date >= start && t.date <= end).length;
    const need = clamp(weekly - already, 0, 4), list = [];
    for (const n of p.m.nodes) { if (list.length >= need) break; if (state.tasks.some(t => t.student === sid && t.node === n.id)) continue; const key = 'nx:' + sid + ':' + n.id; if (!dismissed.has(key)) list.push({ key, kind: 'next', node: n.id, mat: p.m, why: `目標${md(b.target)}に間に合うよう今週あと${need}範囲`, earliest: DAY, dur: typicalDur(sid, p.m.id) }); }
    return list;
  });
  for (let i = 0; lanes.some(l => l[i]); i++) lanes.forEach(l => l[i] && queue.push(l[i]));
  const extra = {}, load = {}, out = [];
  for (const q of queue) {
    const cands = days.filter(d => d >= q.earliest);
    // 次の範囲は日をばらす（案の少ない日から）。再テストとやり残しは早い日から
    const order = q.kind === 'next' ? [...cands].sort((a, b) => (load[a] || 0) - (load[b] || 0) || a.localeCompare(b)) : cands;
    for (const d of order) {
      const g = freeGaps(sid, d, extra).find(([s, e]) => e - s >= q.dur);
      if (!g) continue;
      const s = Math.ceil(g[0] / 5) * 5;
      (extra[d] ||= []).push([s, s + q.dur]); load[d] = (load[d] || 0) + 1;
      out.push({ ...q, date: d, time: toTime(s) }); break;
    }
  }
  return out;
}

/* ---------- PDFのファイル名から 教材・範囲・問題/解答 を判定 ----------
   例：ターゲット1900_201-300_問題.pdf → 英単語ターゲット1900 / 201–300 / 問題 */
const norm = s => String(s).normalize('NFKC').toLowerCase().replace(/[\s_\-–〜~・()（）［］\[\]「」]/g, '');
const nums = s => (String(s).normalize('NFKC').match(/\d+/g) || []).map(Number);
function matchPdfName(name) {
  const base = name.replace(/\.pdf$/i, ''), n = norm(base);
  const role = /解答|答え|こたえ|answer|ans|kaitou|kaito/i.test(base) ? 'answer' : 'problem';
  let best = null, bestScore = 0;
  for (const m of visibleMats()) {
    const keys = [m.name, m.short, ...(m.keys || [])].map(norm).filter(k => k.length >= 2);
    const sc = keys.filter(k => n.includes(k)).reduce((a, k) => a + k.length, 0);
    if (sc > bestScore) { best = m; bestScore = sc; }
  }
  if (!best) return { role, material: null, node: null, sure: false };
  const fileNums = nums(base.replace(/第?\d+版|ver\.?\s*\d+|v\d+/gi, ''));
  let nodeHit = null, nodeScore = 0;
  for (const nd of best.nodes) {
    const ln = nums(nd.label), text = norm(nd.label.replace(/\d+/g, '').normalize('NFKC').replace(/\d+/g, ''));
    let sc = 0;
    if (ln.length && ln.every(x => fileNums.includes(x))) sc += 10 + ln.length;
    if (text.length >= 2 && n.includes(text)) sc += 5;
    if (!ln.length && sc < 5) sc = 0;
    if (ln.length && sc < 10) sc = 0;
    if (sc > nodeScore) { nodeHit = nd; nodeScore = sc; }
  }
  let sure = !!nodeHit;
  const rest = fileNums.filter(x => !nums(best.name).includes(x));
  if (!nodeHit && rest.length === 1 && best.nodes[rest[0] - 1]) { nodeHit = best.nodes[rest[0] - 1]; sure = false; } // 「第3回」のような番号だけなら順番で推測
  return { role, material: best.id, node: nodeHit?.id || null, sure };
}

/* 目次画像の読み取り（モック）。同梱のサンプル画像だけ中身を返す */
const TOC_SAMPLES = {
  'toc-sample-1.jpg': { name: '英熟語ベーシック1000', subject: '英語', type: 'インプット', lines: ['Part 1 基本動詞の熟語 001–100', 'Part 1 基本動詞の熟語 101–200', 'Part 2 前置詞の熟語 201–300', 'Part 2 前置詞の熟語 301–400', 'Part 3 会話・口語表現 401–500', 'Part 3 会話・口語表現 501–600', 'Part 4 長文頻出の熟語 601–700', 'Part 4 長文頻出の熟語 701–800', 'Part 5 入試難関の熟語 801–900', 'Part 5 入試難関の熟語 901–1000'] },
  'toc-sample-2.jpg': { name: '日本史 一問一答', subject: '社会', type: 'インプット', lines: ['第1章 原始・古代① 001–150', '第2章 古代②（奈良・平安） 151–320', '第3章 中世①（鎌倉） 321–470', '第4章 中世②（室町・戦国） 471–640', '第5章 近世①（安土桃山・江戸前期） 641–800', '第6章 近世②（江戸後期） 801–960', '第7章 近代①（幕末・明治） 961–1150', '第8章 近代②（大正・昭和戦前） 1151–1320', '第9章 現代（戦後） 1321–1480'] },
};

/* ---------- 保存 ---------- */
let state;
function freshState() { state = seed(); generateHistory(); state.people.filter(p => p.role === '生徒').forEach(p => resequence(p.id)); autoAttach(); }
try { state = JSON.parse(localStorage.getItem(STORAGE)); } catch { state = null; }
if (!state || state.v !== 8) freshState();
function save() {
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); return true; }
  catch { toast('ブラウザの保存容量がいっぱいです。大きいファイルはこのページを閉じるまで有効です。'); return false; }
}
const snapshot = () => JSON.stringify(state);
