'use strict';
/* 受験AI Actifyくん：体はポーズごとの画像、顔（目と口）はSVGで描く
   - ポーズ画像は「顔の画面を消した体」。どのポーズも顔の画面が同じ位置・同じ幅になるようにそろえてある
     （600×600 の中で画面の中心が (300,235)、幅 200px。傾きだけポーズごとに違う）
   - 表情は faceParts() に足すだけで増やせる（画像は増えない） */
/* 体の絵は 800×800。顔の画面（バイザー）の中心 cx,cy・幅 vw・傾き deg は、元の絵の目の位置から測った値
   （高画質にした絵から目と口だけを消し、同じ場所に SVG の目と口を重ねる。まばたき・視線・口パクのため） */
const BOT_W = 800;
const BOT_POSES = {
  stand: { src: 'assets/body-stand.webp', cx: 416.1, cy: 343.3, vw: 333.1, deg: -7.0 },
  smile: { src: 'assets/body-smile.webp', cx: 416.9, cy: 394.1, vw: 282.5, deg: -10.4 },
  cheer: { src: 'assets/body-cheer.webp', cx: 405.1, cy: 335.8, vw: 372.1, deg: 0.5 },
  think: { src: 'assets/body-think.webp', cx: 420.4, cy: 351.2, vw: 261.9, deg: -15.5 },
  point: { src: 'assets/body-point.webp', cx: 418.2, cy: 335.0, vw: 278.7, deg: -17.7 },
};
// 表情 → 体。眠るときは立ったまま（目を閉じて、こっくりこっくり）
const MOOD_POSE = { normal: 'stand', guide: 'smile', happy: 'cheer', wink: 'point', think: 'think', worried: 'stand', surprise: 'stand', sleep: 'stand' };
const MOOD_MAP = { support: 'guide', done: 'happy', face: 'normal', hero: 'wink' };
const CYAN = '#6fe6ff';

// 表情ごとの目と口。座標は顔の画面を 100×72 とみなしたもの（目の幅・高さ・間隔は元の絵と同じ比率）
function faceParts(mood) {
  const eye = (cx, cy = 34, h = 20) => `<rect x="${cx - 5}" y="${cy - h / 2}" width="10" height="${h}" rx="5"/>`;
  const smile = '<path d="M43.5 50 Q50 58 56.5 50 Q50 53.5 43.5 50Z"/>';
  const arcUp = cx => `<path class="ln" d="M${cx - 8} 38 Q${cx} 25 ${cx + 8} 38"/>`;
  const arcDown = cx => `<path class="ln" d="M${cx - 8} 33 Q${cx} 41 ${cx + 8} 33"/>`;
  switch (mood) {
    case 'happy': return { eyes: arcUp(31) + arcUp(69), mouth: '<path d="M40 47 Q50 62 60 47 Q50 52 40 47Z"/>', blink: false };
    case 'wink': return { eyes: eye(31) + '<path class="ln" d="M63 27 L74 34 L63 41"/>', mouth: smile, blink: false };
    case 'think': return { eyes: eye(33, 31) + eye(71, 31), mouth: '<path class="ln" d="M44 53 Q47.5 50.5 51 53 Q54.5 55.5 57 52"/>', blink: true, look: [3, -2] };
    case 'worried': return { eyes: eye(31, 36, 16) + eye(69, 36, 16) + '<path class="ln" d="M22 22 L37 18"/><path class="ln" d="M63 18 L78 22"/>', mouth: '<path class="ln" d="M44 57 Q50 51 56 57"/>', blink: true };
    case 'sleep': return { eyes: arcDown(31) + arcDown(69), mouth: '<ellipse cx="50" cy="52" rx="2.6" ry="2"/>', blink: false };
    case 'surprise': return { eyes: '<circle cx="31" cy="33" r="8"/><circle cx="69" cy="33" r="8"/>', mouth: '<ellipse cx="50" cy="54" rx="4" ry="5"/>', blink: false };
    default: return { eyes: eye(31) + eye(69), mouth: smile, blink: true };
  }
}
function faceSvg(mood, pose) {
  const f = faceParts(mood), p = BOT_POSES[pose], h = p.vw * .72, pc = v => (v / BOT_W * 100).toFixed(3) + '%';
  return `<svg class="bot-face" viewBox="0 0 100 72" style="left:${pc(p.cx - p.vw / 2)};top:${pc(p.cy - h / 2)};width:${pc(p.vw)};height:${pc(h)};transform:rotate(${p.deg}deg)" aria-hidden="true">
    <defs><filter id="botGlow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="1.8" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter></defs>
    <g class="look" style="transform:translate(calc(var(--lx,0px) + ${f.look?.[0] || 0}px),calc(var(--ly,0px) + ${f.look?.[1] || 0}px))">
      <g class="eyes ${f.blink ? 'blinks' : ''}" fill="${CYAN}" stroke="${CYAN}" filter="url(#botGlow)">${f.eyes}</g>
    </g>
    <g class="mouth" fill="${CYAN}" stroke="${CYAN}" filter="url(#botGlow)"><g class="m-rest">${f.mouth}</g><g class="m-talk"><ellipse cx="50" cy="52" rx="5" ry="4.2"/></g></g>
  </svg>`;
}
/* 頭だけの丸いアイコン：体の絵を2倍にして、顔の画面がアイコンの真ん中に来るように動かす */
const headStyle = pose => { const p = BOT_POSES[pose], z = 800 / p.vw;   // 顔（目の間隔から測った幅）がアイコンの幅いっぱいになる倍率
  return `width:${(z * 100).toFixed(1)}%;height:${(z * 100).toFixed(1)}%;left:${(50 - z * p.cx / 8).toFixed(2)}%;top:${(56 - z * p.cy / 8).toFixed(2)}%`; };
/* head=true で頭だけの丸いアイコン（チャット・通知・右下のボタン） */
function botHtml({ mood = 'normal', cls = '', head = false, talking = false } = {}) {
  mood = MOOD_MAP[mood] || mood;
  const pose = MOOD_POSE[mood] || 'stand';
  return `<span class="bot ${head ? 'head' : ''} ${cls} mood-${mood} ${talking ? 'talking' : ''}" data-bot data-mood="${mood}"><span class="bot-inner" ${head ? `style="${headStyle(pose)}"` : ''}><img class="pose" src="${asset(BOT_POSES[pose].src)}" alt="${BOT_NAME}">${faceSvg(mood, pose)}</span></span>`;
}
function setBotMood(el, mood, { talking } = {}) {
  if (!el) return;
  mood = MOOD_MAP[mood] || mood;
  if (el.dataset.mood !== mood) {
    const pose = MOOD_POSE[mood] || 'stand', img = el.querySelector('img.pose');
    const src = asset(BOT_POSES[pose].src);
    if (img.getAttribute('src') !== src) { img.setAttribute('src', src); el.classList.remove('swap'); void el.offsetWidth; el.classList.add('swap'); }
    el.querySelector('.bot-face').outerHTML = faceSvg(mood, pose);
    if (el.classList.contains('head')) el.querySelector('.bot-inner').setAttribute('style', headStyle(pose));
    el.dataset.mood = mood; el.className = el.className.replace(/mood-\w+/, 'mood-' + mood);
  }
  if (talking !== undefined) el.classList.toggle('talking', talking);
}
function botJump(el) { if (!el) return; el.classList.remove('jump'); void el.offsetWidth; el.classList.add('jump'); }

/* 目がカーソル（タップした所）を追う */
let lookRaf = 0, lookPt = null;
function lookAt(x, y) {
  lookPt = [x, y]; if (lookRaf) return;
  lookRaf = requestAnimationFrame(() => {
    lookRaf = 0;
    document.querySelectorAll('[data-bot]:not(.mood-sleep)').forEach(b => {
      const r = b.getBoundingClientRect(), cx = r.left + r.width / 2, cy = r.top + r.height * .45;
      const dx = lookPt[0] - cx, dy = lookPt[1] - cy, d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 260);
      b.style.setProperty('--lx', (dx / d * 4.5 * k).toFixed(2) + 'px'); b.style.setProperty('--ly', (dy / d * 3.5 * k).toFixed(2) + 'px');
    });
  });
}
document.addEventListener('pointermove', e => lookAt(e.clientX, e.clientY), { passive: true });
document.addEventListener('pointerdown', e => lookAt(e.clientX, e.clientY), { passive: true });

/* ---------- 画面にいる Actifyくん（生徒の画面だけ） ----------
   - ふだんは立って、まばたき・見回し・息。移動は両足そろえてぴょんぴょん跳ねる（脚を別々に動かさない）
   - ときどき喜ぶ・指さす・考える・立ったままうとうと眠る。まれにマントで飛ぶ
   - つまんで動かせる（離すと落ちて着地する）。押すと相談の小窓が開く
   - 30秒さわらないと眠る。動かすと起きる
   - 画面ごとに一言話す（ホームは次の予定など） */
function homeLines() {
  const me = person(ME), name = first(me.name), today = tasksOf(ME).filter(t => t.date === DAY).sort(byTime);
  const next = heroTask(), missed = tasksOf(ME).filter(isMissed);
  const late = booksOf(ME).map(b => bookProgress(ME, b.material)).filter(p => p.status.tone === 'red');
  const lines = [];
  if (next) lines.push({ mood: 'guide', text: `${name}さん、次は${mat(next.material).short} ${node(next.node).label}だね。${next.time}からだよ！` });
  else if (today.length) lines.push({ mood: 'happy', text: `今日の予定はぜんぶできたね。おつかれさま！` });
  else lines.push({ mood: 'normal', text: `${name}さん、今日は先生が入れた予定はないみたい。` });
  if (missed.length) lines.push({ mood: 'worried', text: `${md(missed[0].date)}の${mat(missed[0].material).short}が残ってるよ。先にやっちゃう？` });
  if (late.length) lines.push({ mood: 'think', text: `${late[0].m.short}が少し遅れ気味かも。週${Math.ceil(late[0].needPerWeek * 10) / 10}範囲なら間に合うよ。` });
  const done = today.filter(t => t.status === 'done').length;
  if (done) lines.push({ mood: 'wink', text: `今日はもう${done}つ終わってるよ。いい調子！` });
  return lines;
}
function pageLine(page) {
  if (page === 'home') { const l = homeLines()[0]; return l && { ...l, pose: l.mood === 'happy' ? 'cheer' : l.mood === 'worried' ? 'worried' : 'announce' }; }
  if (page === 'schedule') return { mood: 'guide', pose: 'point', text: '空いている時間をなぞってね。先生がそこに入れてくれるよ。' };
  if (page === 'records') { const late = booksOf(ME).map(b => bookProgress(ME, b.material)).find(p => p.status.tone !== 'green');
    return late ? { mood: 'think', pose: 'fired', text: `${late.m.short}は目安より少し遅れてるね。いっしょに追いつこう。` } : { mood: 'happy', pose: 'cheer', text: '参考書、ぜんぶ順調だよ！' }; }
  if (page === 'resources') return { mood: 'wink', pose: 'gift', text: '先生からの資料はここに届くよ。' };
  return null;
}
/* ひとこと豆知識（手持ちぶさたなとき）。勉強法の一般的な話だけ */
const TIPS = [
  { pose: 'point', text: '覚えたあとに寝ると、記憶が残りやすいんだって。夜の単語はおすすめ！' },
  { pose: 'announce', text: '見て覚えるより、隠してテストするほうが残るよ。' },
  { pose: 'ponder', text: '間違えた問題だけ、翌日にもう一度。それだけで差がつくよ。' },
  { pose: 'thumbs', text: '5分だけやってみると、意外と続くよ。' },
  { pose: 'point2', text: '1日後・1週間後・1か月後。間をあけて復習しよう。' },
  { pose: 'tablet', text: '電車の15分は単語にぴったり。' },
  { pose: 'pencil', text: 'わからない所は「どこまでわかったか」をメモしておくと、質問しやすいよ。' },
  { pose: 'smile', text: '終わったら「完了」を押してね。ぼくが喜ぶ。' },
  { pose: 'magnifier', text: '長文は、まず設問を読んでから本文。探しながら読むと速いよ。' },
  { pose: 'idea', text: '数学は、解けなかった問題の「最初の一手」だけノートに書いておくといいよ。' },
  { pose: 'point', text: '勉強の前にスマホを別の部屋に。それだけで集中が変わるんだって。' },
  { pose: 'wink', text: '休けいは25分やって5分。タイマーを使うとだらだらしないよ。' },
  { pose: 'talk', text: '単語は声に出すと覚えやすいよ。口と耳も使おう。' },
  { pose: 'megaphone', text: '寝る前の30分は暗記もの、朝は頭を使うもの。時間帯で使い分けよう。' },
  { pose: 'laptop2', text: '模試は点数より「なぜ落としたか」。直しをした分だけ伸びるよ。' },
  { pose: 'tablet2', text: '予定どおりにいかない日があっても大丈夫。先生が組み直してくれるよ。' },
  { pose: 'bag', text: '参考書は1冊を何周もするほうが、何冊もかじるより力がつくよ。' },
  { pose: 'flag', text: '目標は「1周」より「何日までに何範囲」。小さく決めると進むよ。' },
  { pose: 'idea', text: '人に説明できたら、本当にわかってる証拠。ぼくに説明してみて！' },
  { pose: 'think', text: '古文は単語と助動詞で7割読めるようになるよ。' },
  { pose: 'point', text: '苦手なところは、1日おきに少しずつ。まとめてやるより残るよ。' },
];
/* ひとりごと（ふと、つぶやく） */
const MUTTERS = [
  'ふんふん♪', 'きょうもいい天気…かな？', 'おなかすいたなあ', 'あ、いま何時だろ', 'ぼく、マントがじまんなんだ', 'ちょっと歩こうかな',
  'なでてくれてもいいんだよ？', 'そろそろ勉強の時間かな', 'ねむくなってきた…', 'がんばってる人、見てるとうれしくなる', 'ふう。ひと休み',
  '単語って、おぼえるとうれしいよね', '明日はなにをしようかな', 'ちょっとだけ…ぼーっとする', 'さっきの問題、気になるなあ', 'きみの味方だよ',
];
/* 時間帯のあいさつ（実際の時計で） */
function greetLine() {
  const h = new Date().getHours();
  if (h < 5) return { pose: 'sleep', text: 'こんな時間まで…むりしないでね。' };
  if (h < 10) return { pose: pick(Math.random, ['wave', 'hello']), text: 'おはよう！ 朝の勉強は頭に入りやすいよ。' };
  if (h < 14) return { pose: 'smile', text: 'こんにちは！ 午後もいっしょにがんばろう。' };
  if (h < 18) return { pose: pick(Math.random, ['cheer', 'raise']), text: 'おつかれさま！ 学校のあとも一歩ずつね。' };
  if (h < 22) return { pose: 'fired', text: '夜の時間、集中できてる？ 応援してるよ。' };
  return { pose: 'drowsy', text: 'そろそろ寝る時間。今日の分、おつかれさま。' };
}
/* いまの状況で変わる気持ち（やり残し・遅れ・全部できた）。ふだんの行動に混ぜる */
function feelLines() {
  const today = tasksOf(ME).filter(t => t.date === DAY), rest = today.filter(t => t.status !== 'done'), missed = tasksOf(ME).filter(isMissed);
  const late = booksOf(ME).map(b => bookProgress(ME, b.material)).filter(p => p.status.tone === 'red'), out = [];
  if (missed.length) out.push({ pose: pick(Math.random, ['worried', 'confused']), anim: 'sway', text: pick(Math.random, [`${md(missed[0].date)}の${mat(missed[0].material).short}、まだ残ってるね…`, 'やり残し、ちょっと気になるなあ', '先にやり残しをやっちゃう？ 5分でいいよ']) });
  if (late.length) out.push({ pose: 'fired', anim: 'bounce', text: pick(Math.random, [`${late[0].m.short}、いっしょに追いつこう！`, '遅れは取り戻せるよ。今日から少しずつね']) });
  if (today.length && !rest.length) out.push({ pose: pick(Math.random, ['party', 'hooray']), anim: 'bounce', text: pick(Math.random, ['今日の予定、ぜんぶ終わってる！ すごい！', 'やりきったね！ ゆっくり休もう']) });
  else if (rest.length) out.push({ pose: 'point', anim: 'sway', text: `今日はあと${rest.length}つ。次は${rest[0].time}の${mat(rest[0].material).short}だよ` });
  const days = daysBetween(DAY, person(ME).goal.date); out.push({ pose: 'flag', anim: 'sway', text: `${person(ME).goal.school}まで、あと${days}日。一歩ずつ進んでるよ！` });
  const done = today.filter(t => t.status === 'done').length; if (done >= 2) out.push({ pose: pick(Math.random, ['heart', 'hugheart']), anim: 'sway', text: `今日はもう${done}つ終わってるんだね。えらい！` });
  return out;
}

/* ---------- 画面にいる Actifyくん（生徒の画面だけ） ----------
   見た目は2通り：
   - ふだん（立つ・見回す・うとうと）は「顔をSVGで描く立ち絵」。まばたき・目がカーソルを追う・話すと口が動く
   - 動き・表情のポーズは、いただいた絵（assets/sp/）。高画質にした3枚から：歩き20コマ、表情・ポーズ32枚、追加のポーズ40枚（のんびり歩き4コマを含む）
   さわり方で反応が変わる：
   - なでる（頭の上でカーソルを左右に動かす／スマホは頭を指で左右にこする）→ 目を細める → ハート → 照れる
   - 押す：1回目は相談の小窓。続けて押すと「？」→ 困る → 怒る → 背中を向けてすねる（すねている間に押すと泣く）
     → なでると機嫌が直る
   - つまんで動かす → びっくり（両手でほっぺ）。振り回すと目を回して、下ろすと「？」でふらふら */
const SP = ['cheer', 'yay', 'stand', 'surprise', 'angry', 'sad', 'cry', 'puzzled', 'wink', 'love', 'calm', 'shock', 'worried', 'shy', 'fired', 'sing', 'run', 'walk', 'back', 'jump', 'point', 'think', 'tablet', 'laptop', 'smile', 'sleep', 'heart', 'gift', 'party', 'announce', 'talk', 'wave',
  'stand2', 'hooray', 'skip', 'wink2', 'happy', 'laugh', 'wonder', 'confused', 'sob', 'angry2', 'whistle', 'startled', 'tablet2', 'ponder', 'idea', 'point2', 'laptop2', 'sleep2', 'dance', 'blush',
  'hugheart', 'raise', 'thumbs', 'shy2', 'shocked', 'hello', 'drowsy', 'back2', 'bag', 'pencil', 'magnifier', 'flag', 'megaphone', 'present', 'sitmusic', 'lieflat'];
const STROLL_FRAMES = ['stroll0', 'stroll1', 'stroll2', 'stroll3'];   // のんびり歩き（4コマ）
const SLEEPS = ['sleep', 'sleep2', 'lieflat'];
const spSrc = n => asset(`assets/sp/${n}.webp`);
const WALK_FRAMES = Array.from({ length: 20 }, (_, i) => `walk${String(i).padStart(2, '0')}`);
const W = { el: null, bot: null, say: null, x: 0, y: 0, vy: 0, dir: 1, mode: 'idle', hops: 0, hopT: 0, until: 0, phase: 0, last: 0, tx: 0, ty: 0, drag: null, sayUntil: 0, page: null, idleAt: Date.now(), hidden: false,
  sp: null, taps: [], petT: 0, petSum: 0, hov: null, mood: 0 };
const wNow = () => performance.now();
const wSize = () => innerWidth <= 600 ? 112 : innerWidth <= 820 ? 150 : 220;
const wMinX = () => (innerWidth > 820 ? 228 : 6);
// 相談の小窓（右下）を開いている間は、その手前までしか行かない
const wMaxX = () => ui.botOpen && innerWidth > 820 ? innerWidth - 24 - 360 - wSize() * .8 : innerWidth - wSize() - 10;
// 足元が画面の下（スマホは下のタブの上）に来るように。足は箱の下端から 0.132×大きさ 上にある
const wGround = () => innerWidth <= 820 ? (document.querySelector('.tabbar')?.offsetHeight || 64) + 2 - wSize() * .132 : -30;
const rnd = (a, b) => a + Math.random() * (b - a);
/* 絵（スプライト）を出す／しまう。flip で左右反転（歩きの向き） */
function wSprite(name, flip = false) {
  if (!W.spImg) return;
  if (W.sp !== name) { W.sp = name; if (name) W.spImg.src = spSrc(name); W.bot.classList.toggle('sp-on', !!name); W.bot.dataset.sp = name || ''; }
  W.spImg.classList.toggle('flip', !!flip);
}
function walkerSay(line, ms = 5200) {
  if (!W.el || !line) return;
  W.say.innerHTML = `${esc(line.text)}${line.chat ? '<button data-act="bot-toggle">話す</button>' : ''}`;
  W.say.hidden = false; W.sayUntil = wNow() + ms;
  if (line.mood) setBotMood(W.bot, line.mood);
  W.bot.classList.add('talking'); setTimeout(() => W.bot.classList.remove('talking'), Math.min(ms, 300 + line.text.length * 55));
}
function walkerSet(mode, secs, mood) {
  W.mode = mode; W.until = wNow() + secs * 1000; W.t = 0; W.seq = null;
  if (!['walk', 'pose', 'sulk', 'pet', 'lie', 'drag', 'dizzy'].includes(mode)) wSprite(null);
  if (mood) setBotMood(W.bot, mood);
}
/* ポーズの絵を出す。anim：動き（bounce 弾む／shake 震える／sway ゆれる／hop 跳ぶ／still 止まる）。then：終わったら次へ */
function walkerPose(name, secs, { say, anim = 'still', then, mode = 'pose', flip = false } = {}) {
  if (!W.el) return;
  walkerSet(mode, secs); W.anim = anim; W.then = then || null; wSprite(name, flip);
  if (anim === 'hop') botJump(W.bot);
  if (say) walkerSay(say, Math.max(2200, secs * 1000));
}
function walkerCelebrate(text, score) {
  if (!W.el || W.hidden) return;
  if (score != null && score < 60) return walkerPose('fired', 2.6, { anim: 'bounce', say: { text }, then: () => walkerPose(pick(Math.random, ['heart', 'hugheart']), 1.8, { anim: 'sway', say: { text: pick(Math.random, ['次はもっといける！', '間違えた所が、伸びる所だよ']) } }) });
  if (score != null && score < 80) return walkerPose(pick(Math.random, ['cheer', 'hooray']), 2.4, { anim: 'bounce', say: { text }, then: () => walkerPose(pick(Math.random, ['wink', 'thumbs']), 1.6, { anim: 'sway', say: { text: 'あと少しで満点だね' } }) });
  walkerPose(pick(Math.random, ['party', 'hooray']), 2.4, { anim: 'bounce', say: { text }, then: () => walkerPose(pick(Math.random, ['cheer', 'yay', 'jump', 'skip', 'thumbs']), 1.8, { anim: 'bounce', say: score >= 100 ? { text: '満点！？ すごすぎる！' } : null }) });
}
function walkerInit() {
  const el = document.createElement('div'); el.id = 'walker';
  el.innerHTML = `<div class="w-say" hidden></div><span class="bot walker-bot mood-normal" data-bot data-mood="normal"><span class="w-shadow"></span><span class="w-zzz" aria-hidden="true"><i>z</i><i>z</i><i>Z</i></span><span class="w-fx" aria-hidden="true"></span><span class="bot-inner">
    <img class="pose" src="${asset(BOT_POSES.stand.src)}" alt="${BOT_NAME}">${faceSvg('normal', 'stand')}<img class="sprite" alt=""></span></span>`;
  document.body.appendChild(el);
  Object.assign(W, { el, bot: el.querySelector('.bot'), say: el.querySelector('.w-say'), x: innerWidth - wSize() - 40, y: 0, shadow: el.querySelector('.w-shadow'), spImg: el.querySelector('img.sprite'), fx: el.querySelector('.w-fx'), dragVx: 0 });
  // 絵は先に読み込んでおく（切り替えでちらつかないように）
  W.cache = [...SP, ...WALK_FRAMES, ...STROLL_FRAMES].map(n => { const i = new Image(); i.src = spSrc(n); return i; });
  W.bot.addEventListener('pointerdown', e => {
    e.preventDefault(); W.bot.setPointerCapture(e.pointerId);
    W.drag = { sx: e.clientX, sy: e.clientY, ox: W.x, oy: W.y, lx: e.clientX, dir: 0, rev: 0, path: 0, kind: null, shake: [], t0: wNow() };
  });
  W.bot.addEventListener('pointermove', e => {
    const d = W.drag; if (!d) return;
    const dx = e.clientX - d.lx, net = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
    if (Math.abs(dx) > 2) { const dir = Math.sign(dx); if (d.dir && dir !== d.dir) { d.rev++; d.shake.push(wNow()); } d.dir = dir; d.path += Math.abs(dx); d.lx = e.clientX; }
    // 小さく左右にこする＝なでる／大きく動かす＝つまむ
    if (!d.kind) { if (d.rev >= 2 && net < 40) d.kind = 'pet'; else if (net > 26) { d.kind = 'drag'; walkerPose('shock', 999, { mode: 'drag' }); W.say.hidden = true; } }
    if (d.kind === 'pet') return petTick();
    if (d.kind === 'drag') {
      const nx = clamp(d.ox + e.clientX - d.sx, 0, innerWidth - wSize()); W.dragVx = (nx - W.x) * 30; W.x = nx; W.y = Math.max(0, d.oy - (e.clientY - d.sy));
      d.shake = d.shake.filter(t => wNow() - t < 1200);
      if (d.shake.length >= 6 && W.sp !== 'cry') { wSprite('cry'); walkerSay({ text: '目がまわる〜！' }, 1800); }
    }
  });
  W.bot.addEventListener('pointerup', () => {
    const d = W.drag; W.drag = null; if (!d) return;
    if (d.kind === 'drag') { W.vy = 0; W.dizzy = W.sp === 'cry'; walkerSet('fall', 9); wSprite(W.dizzy ? 'cry' : 'shock'); return; }
    if (d.kind === 'pet') return;
    walkerTap();
  });
  // マウス：押さずに頭の上で左右に動かす＝なでる
  document.addEventListener('pointermove', e => {
    if (!W.el || e.pointerType !== 'mouse' || e.buttons || W.drag || W.el.style.display === 'none') return;
    const r = W.bot.getBoundingClientRect(), head = { l: r.left + r.width * .12, r: r.right - r.width * .12, t: r.top - r.height * .05, b: r.top + r.height * .5 };
    if (e.clientX < head.l || e.clientX > head.r || e.clientY < head.t || e.clientY > head.b) { W.hov = null; return; }
    const now = wNow(), h = W.hov && now - W.hov.t < 500 ? W.hov : (W.hov = { lx: e.clientX, dir: 0, rev: 0, path: 0, t: now });
    const dx = e.clientX - h.lx; h.t = now;
    if (Math.abs(dx) > 3) { const dir = Math.sign(dx); if (h.dir && dir !== h.dir) h.rev++; h.dir = dir; h.path += Math.abs(dx); h.lx = e.clientX; }
    if (h.rev >= 3 && h.path > 90) petTick();
  }, { passive: true });
  requestAnimationFrame(walkerTick);
}
/* なでられている間、何度も呼ばれる */
function petTick() {
  const now = wNow(), first = W.mode !== 'pet';
  if (W.mode === 'lie' || W.mode === 'sleep') { walkerPose(pick(Math.random, ['surprise', 'startled']), 1.2, { anim: 'hop', say: { text: 'ん…？ あ、なでてくれてたの？' } }); W.petSum = 0; return; }
  if (first) W.petSum = 0;
  W.petSum += Math.min(.25, (now - (W.petT || now)) / 1000); W.petT = now; W.idleAt = Date.now();
  const wasAngry = W.taps.length >= 5 || W.sulk;
  if (first) { W.sulk = false; W.taps = [];
    walkerPose('calm', 999, { mode: 'pet', anim: 'sway', say: { text: wasAngry ? pick(Math.random, ['…なでてくれるなら、ゆるす。', '…もう怒ってないよ。', 'ふん…まあ、いいけど。']) : pick(Math.random, ['えへへ…きもちいい', 'ん〜', 'そこそこ', 'ふにゃ…']) } }); W.petStage = 0; spawnFx('♪'); return; }
  W.until = now + 900;  // なでるのをやめたら少しして終わる
  if (W.petStage === 0 && W.petSum > 1.4) { W.petStage = 1; wSprite(pick(Math.random, ['love', 'blush', 'happy'])); walkerSay({ text: pick(Math.random, ['もっとなでて〜', 'しあわせ〜', 'きみの手、あったかい']) }, 2200); spawnFx('♥'); }
  else if (W.petStage === 1 && W.petSum > 3.6) { W.petStage = 2; wSprite(pick(Math.random, ['shy', 'shy2', 'hugheart'])); walkerSay({ text: pick(Math.random, ['て、てれる…', 'そんなに…えへへ', 'もう…やめてよ（うれしい）']) }, 2200); spawnFx('♥'); }
  else if (W.petStage === 2 && W.petSum > 7) { W.petStage = 3; wSprite(pick(Math.random, SLEEPS)); walkerSay({ text: 'すぅ…（なでられて眠くなった）' }, 2600); }
  else if (Math.random() < .06) spawnFx(W.petStage ? '♥' : '♪');
}
/* 押したとき：1回目は相談の小窓。押しすぎると怒って、すねる */
function walkerTap() {
  const now = wNow();
  if (W.mode === 'doze') { walkerSet('talk', 2, 'surprise'); botJump(W.bot); walkerSay({ mood: 'surprise', text: 'はっ！ ねてないよ！' }, 2200); return; }
  if (W.mode === 'lie' || W.mode === 'sleep') { walkerPose(pick(Math.random, ['surprise', 'startled', 'shocked']), 1.4, { anim: 'hop', say: { text: pick(Math.random, ['わっ！ おきてる、おきてるよ！', 'ねてないよ！ …ほんとだよ', 'はっ、いま何時？']) } }); return; }
  if (W.mode === 'sulk') {
    W.sulkTaps = (W.sulkTaps || 0) + 1;
    if (W.sulkTaps >= 3) { W.sulkTaps = 0; return walkerPose(pick(Math.random, ['cry', 'sob']), 2.6, { mode: 'sulk', anim: 'shake', say: { text: 'うぅ…やめてってば〜' }, then: () => walkerPose(pick(Math.random, ['back', 'back2']), 5, { mode: 'sulk', say: { text: '……。' } }) }); }
    W.bot.classList.remove('nudge'); void W.bot.offsetWidth; W.bot.classList.add('nudge'); return;
  }
  W.taps = W.taps.filter(t => now - t < 5000); W.taps.push(now);
  const n = W.taps.length;
  if (n === 1) {
    if (innerWidth <= 820) { walkerPose('yay', 1, { anim: 'bounce', say: { text: 'なになに？' } }); setTimeout(() => go('ai'), 350); }
    else if (!ui.botOpen) { ui.botOpen = true; render(); walkerPose('yay', 1.8, { anim: 'bounce', say: { text: pick(Math.random, ['なになに？ なんでも聞いてね', 'よんだ？', 'はーい、どうしたの？']) } }); }
    else walkerPose('surprise', 1, { anim: 'hop' });
  }
  else if (n === 2) walkerPose(pick(Math.random, ['puzzled', 'wonder', 'startled']), 1.3, { say: { text: pick(Math.random, ['ん？', 'なに？', 'よんだ？']) } });
  else if (n <= 4) walkerPose(pick(Math.random, ['worried', 'shocked', 'confused']), 1.8, { anim: 'shake', say: { text: pick(Math.random, ['ちょ、ちょっと…', 'くすぐったいよ〜', 'な、なに？', 'そんなに押さなくても…', 'ひゃっ']) } });
  else if (n <= 6) walkerPose(pick(Math.random, ['angry', 'angry2']), 2.4, { anim: 'shake', say: { text: pick(Math.random, ['もう！さわりすぎ！', 'おこるよ！', 'ぷんぷん！', 'いいかげんにして！', 'ぼくはボタンじゃないよ！']) } });
  else { W.taps = []; W.sulk = true; W.sulkTaps = 0;
    walkerPose(pick(Math.random, ['back', 'back2']), 6, { mode: 'sulk', say: { text: pick(Math.random, ['ふんっ。しらない。', 'もう口きかない。', '…あっち向いてる。']) }, then: () => { W.sulk = false;
      walkerPose('sad', 1.6, { say: { text: pick(Math.random, ['……もうしない？', '…ごめんって言う？']) }, then: () => walkerPose(pick(Math.random, ['smile', 'happy', 'hello']), 1.6, { say: { text: pick(Math.random, ['じゃあ、なかなおり。', 'ゆるしてあげる。']) } }) }); } }); }
}
/* ♥ や ♪ が頭の上にふわっと出る */
function spawnFx(ch) {
  if (!W.fx) return;
  const i = document.createElement('i'); i.textContent = ch; i.className = ch === '♥' ? 'heart' : 'note';
  i.style.left = (35 + Math.random() * 30) + '%'; W.fx.appendChild(i); setTimeout(() => i.remove(), 1400);
}
/* ふだんの気まぐれ。同じことは続けてしない。数字は出やすさ */
const ACTS = [
  ['rest', 6], ['walk', 5], ['stroll', 2], ['run', 1], ['hop', 1.4], ['look', 2], ['doze', 1], ['lie', 1], ['fly', .9], ['stretch', 1], ['spin', .7], ['dance', .8], ['dance2', .8], ['peek', 1], ['bounce', .7], ['yawn', .9],
  ['p:sing', .8], ['p:laptop', .8], ['p:tablet', .7], ['p:think', .8], ['p:wave', .8], ['p:calm', .5], ['p:fired', .7], ['p:heart', .4], ['p:gift', .3], ['p:shy', .4], ['p:puzzled', .5], ['p:talk', .5], ['p:announce', .4],
  ['carry', 1], ['search', 1], ['study', 1.2], ['think2', 1], ['goal', .7], ['megaphone', .6], ['chill', .9], ['muddle', .6], ['emote', 2], ['present', .4], ['turn', .5], ['typing', .6],
  ['tip', 2], ['mutter', 2.5], ['feel', 2], ['greet', .6], ['home', 1], ['excited', .7], ['bored', .6], ['wonder', .8], ['sneeze', .4], ['trip', .4],
];
function nextAct() {
  const list = ACTS.filter(([a]) => a !== W.lastAct), sum = list.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * sum; for (const [a, w] of list) { r -= w; if (r <= 0) return a; } return list[0][0];
}
/* 歩いて行く先：いまの場所から画面幅の frac 以上離れた所 */
function wTarget(frac = .2, maxFrac = 1) {
  const span = wMaxX() - wMinX(); let tx = rnd(wMinX(), wMaxX()), g = 0;
  while ((Math.abs(tx - W.x) < span * frac || Math.abs(tx - W.x) > span * maxFrac) && g++ < 20) tx = rnd(wMinX(), wMaxX());
  if (Math.abs(tx - W.x) < span * frac) tx = W.x < wMinX() + span / 2 ? wMaxX() - rnd(0, span * .25) : wMinX() + rnd(0, span * .25);
  return tx;
}
/* 移動して、着いたら after。style：walk 歩く／run 走る／stroll のんびり／carry 絵を1枚持ったまま移動（カバン・虫めがね） */
function walkTo(tx, style = 'walk', { after, carry, speed } = {}) {
  W.tx = tx; W.dir = tx > W.x ? 1 : -1; W.style = style; W.carry = carry || null; W.speed = speed || null; W.after = after || null; W.run = style === 'run'; walkerSet('walk', 40);
}
/* 絵を順に見せる（ダンスなど）。frames：[[絵, 秒], …] をくり返す */
function walkerSeq(frames, secs, { say, anim = 'sway', then } = {}) {
  walkerPose(frames[0][0], secs, { say, anim, then }); W.seq = frames; W.seqT = 0;
}
/* 表情いろいろ（ひとこと付き） */
const EMOTES = [
  ['blush', 'sway', ['えへへ…', 'なんだか照れるなあ']], ['hugheart', 'sway', ['きみの努力、だいすき！', 'いつも見てるよ']], ['happy', 'bounce', ['今日もいい日！', 'ふふっ']],
  ['laugh', 'bounce', ['あはは！', 'ちょっと思い出し笑い']], ['thumbs', 'still', ['いい感じ！', 'グッド！']], ['wink2', 'sway', ['その調子！', 'がんばってるね']],
  ['startled', 'hop', ['えっ！？', 'びっくりした〜']], ['shocked', 'shake', ['ええっ！', 'まさか…！']], ['hooray', 'bounce', ['やったー！', 'ばんざーい！']],
  ['skip', 'hop', ['るんるん♪', 'たのしいね']], ['raise', 'sway', ['はーい！', 'ここだよ！']], ['hello', 'sway', ['やっほー', 'こんにちは！']],
  ['whistle', 'sway', ['ひゅ〜♪', 'ふんふん♪']], ['stand2', 'still', ['…', 'ん？']], ['sob', 'shake', ['うう、感動しちゃった…']], ['angry2', 'shake', ['むむっ、サボりはだめだよ！']],
];
function startAct(act) {
  W.lastAct = act; W.t = 0; W.seq = null;
  const days = () => daysBetween(DAY, person(ME).goal.date), rest = () => tasksOf(ME).filter(t => t.date === DAY && t.status !== 'done');
  if (act === 'walk') return walkTo(wTarget());                                            // 歩いて別の場所へ
  if (act === 'stroll') return walkTo(wTarget(.12, .45), 'stroll', { after: () => Math.random() < .5 ? walkerPose('whistle', 2, { anim: 'sway', say: Math.random() < .5 ? { text: pick(Math.random, ['ひゅ〜♪', 'のんびり、のんびり', 'いい風〜']) } : null }) : walkerSet('idle', rnd(3, 6), 'normal') });
  if (act === 'run') { // 走って反対側へ
    const span = wMaxX() - wMinX(), tx = W.x < wMinX() + span / 2 ? wMaxX() - rnd(0, span * .15) : wMinX() + rnd(0, span * .15);
    walkerPose('fired', .7, { anim: 'bounce', say: Math.random() < .5 ? { text: pick(Math.random, ['よーい、どん！', 'いくよ〜！', 'ダッシュ！']) } : null, then: () => walkTo(tx, 'run') }); return;
  }
  // 教材を運ぶ：カバンを持って歩く → 置いて、ひと息
  if (act === 'carry') { const tx = wTarget(.25); walkerSay({ text: pick(Math.random, ['参考書を運んでるよ', 'よいしょ、よいしょ', '明日の教材、準備しとくね']) }, 2600);
    return walkTo(tx, 'carry', { carry: 'bag', speed: 120, after: () => walkerPose(pick(Math.random, ['thumbs', 'smile']), 2, { anim: 'sway', say: { text: pick(Math.random, ['とうちゃく！', 'ふう、重かった', '準備ばんたん！']) } }) }); }
  // 探しもの：虫めがねでゆっくり歩く → 見つけた／気のせい
  if (act === 'search') { const tx = wTarget(.15, .4);
    walkerSay({ text: pick(Math.random, ['なにか落ちてないかな…', 'まちがいの原因、さがしてるよ', 'じーっ…']) }, 2600);
    return walkTo(tx, 'carry', { carry: 'magnifier', speed: 60, after: () => Math.random() < .55
      ? walkerPose('startled', 1.6, { anim: 'hop', say: { text: pick(Math.random, ['あった！ 消しゴム！', '見つけた！ 計算ミスの原因！', 'あ、四つ葉のクローバー']) } })
      : walkerPose('wonder', 1.8, { anim: 'sway', say: { text: pick(Math.random, ['…気のせいだった', 'ないなあ', 'ま、いっか']) } }) }); }
  // 勉強：鉛筆で書く → ひらめく → できた
  if (act === 'study') return walkerPose('pencil', 3, { anim: 'sway', say: { text: pick(Math.random, ['カキカキ…', '単語をノートに書いてるよ', 'ぼくも勉強中！']) },
    then: () => walkerPose('idea', 1.6, { anim: 'hop', say: { text: pick(Math.random, ['ひらめいた！', 'そういうことか！', 'わかった！']) }, then: () => walkerPose('thumbs', 1.4, { anim: 'sway' }) }) });
  // 考える：…→ 電球 → 指さして豆知識
  if (act === 'think2') { const t = pick(Math.random, TIPS); return walkerPose('ponder', 2.4, { anim: 'still', say: { text: pick(Math.random, ['うーん…', 'どうしたら覚えやすいかな…', '考え中…']) },
    then: () => walkerPose('idea', 1.2, { anim: 'hop', then: () => walkerPose('point2', 4, { anim: 'sway', say: { text: t.text } }) }) }); }
  // 目標の旗：志望校まであと何日
  if (act === 'goal') return walkerPose('flag', 3.4, { anim: 'sway', say: { text: `${person(ME).goal.school}まで、あと${days()}日。えいえいおー！` }, then: () => walkerPose('hooray', 1.4, { anim: 'bounce' }) });
  // メガホンでお知らせ（いまの状況から）
  if (act === 'megaphone') { const r = rest(); return walkerPose('megaphone', 3.4, { anim: 'bounce', say: { text: r.length ? `お知らせ！ 今日はあと${r.length}つ。次は${r[0].time}の${mat(r[0].material).short}！` : 'お知らせ！ 今日の予定はぜんぶ終わり！ えらい！' } }); }
  // ひと休み：座って音楽 → ごろん
  if (act === 'chill') return walkerPose('sitmusic', rnd(4, 6), { anim: 'sway', say: { text: pick(Math.random, ['ちょっとひと休み♪', 'ふんふふーん♪', '休むのも勉強のうち']) },
    then: () => { walkerPose('lieflat', rnd(4, 7), { mode: 'lie' }); W.say.hidden = true; } });
  // こんがらがる → 笑ってごまかす
  if (act === 'muddle') return walkerPose('confused', 2.4, { anim: 'shake', say: { text: pick(Math.random, ['頭がこんがらがってきた…', '助動詞、多すぎない？', 'えっと、なんだっけ…']) },
    then: () => walkerPose('laugh', 1.8, { anim: 'bounce', say: { text: pick(Math.random, ['まあ、一歩ずつだね！', 'あはは、休けいしよ']) } }) });
  if (act === 'emote') { const [p, anim, says] = pick(Math.random, EMOTES); return walkerPose(p, rnd(2, 3), { anim, say: Math.random() < .7 ? { text: pick(Math.random, says) } : null }); }
  if (act === 'present') return walkerPose('present', 2.6, { anim: 'bounce', say: { text: pick(Math.random, ['プレゼント！ 中身は…応援だよ', 'はい、がんばったきみに！']) }, then: () => walkerPose('blush', 1.4, { anim: 'sway' }) });
  // あっちを向いてひと休み → 振り向いて手をふる
  if (act === 'turn') return walkerPose('back2', rnd(3, 5), { anim: 'still', say: Math.random() < .5 ? { text: '（あっち向いて、ひと休み）' } : null, then: () => walkerPose(pick(Math.random, ['hello', 'wave']), 1.6, { anim: 'sway', say: { text: pick(Math.random, ['あ、見てた？', 'やっほー']) } }) });
  if (act === 'typing') return walkerPose(pick(Math.random, ['laptop2', 'tablet2']), rnd(4, 6), { anim: 'still', say: Math.random() < .6 ? { text: pick(Math.random, ['（カタカタ…）明日の予定を見てるよ', '今週の記録、まとめてるんだ', '（ポチポチ…）']) } : null });
  // ダンス（絵を切り替えて）
  if (act === 'dance2') return walkerSeq([['dance', .42], ['skip', .42], ['whistle', .42], ['skip', .42]], rnd(3, 4.5), { anim: 'bounce', say: Math.random() < .6 ? { text: pick(Math.random, ['♪〜', 'おどっちゃおう！', 'ノリノリ〜']) } : null });
  if (act === 'mutter') return walkerPose(pick(Math.random, ['stand', 'stand2', 'smile', 'calm', 'think', 'talk', 'whistle', 'walk']), 3, { anim: 'sway', say: { text: pick(Math.random, MUTTERS) } });
  if (act === 'greet') { const g = greetLine(); return walkerPose(g.pose, 3.6, { anim: 'sway', say: { text: g.text } }); }
  if (act === 'feel') { const fl = feelLines(), f = fl.length && pick(Math.random, fl); return f ? walkerPose(f.pose, 3.8, { anim: f.anim, say: { text: f.text } }) : startAct('mutter'); }
  if (act === 'excited') return walkerPose('jump', .8, { anim: 'hop', then: () => walkerPose(pick(Math.random, ['cheer', 'hooray']), 1.4, { anim: 'bounce', say: { text: pick(Math.random, ['わーい！', 'なんかうれしい！', 'やる気でてきた！']) }, then: () => walkerPose('party', 1.4, { anim: 'bounce' }) }) });
  if (act === 'bored') return walkerPose('calm', 2, { say: { text: pick(Math.random, ['ひま…', 'なにしようかな…', 'ふぁ…']) }, then: () => walkerSet('yawn', 1.8, 'surprise') });
  if (act === 'wonder') return walkerPose(pick(Math.random, ['puzzled', 'wonder']), 2.4, { anim: 'sway', say: { text: pick(Math.random, ['あれ？ なんだっけ', 'うーん…？', 'これ、どういう意味だろ']) }, then: () => walkerPose(pick(Math.random, ['yay', 'idea']), 1.2, { anim: 'hop', say: { text: 'あ、わかった！' } }) });
  if (act === 'sneeze') return walkerPose('think', .9, { say: { text: 'は…はっ…' }, then: () => walkerPose('shock', 1.2, { anim: 'shake', say: { text: 'はっくしょん！' }, then: () => walkerPose(pick(Math.random, ['shy', 'shy2']), 1.2, { say: { text: 'しつれいしました' } }) }) });
  if (act === 'trip') return walkerPose('run', .6, { anim: 'bounce', then: () => walkerPose(pick(Math.random, ['shock', 'shocked']), .9, { anim: 'shake', say: { text: 'わっ！' }, then: () => walkerPose(pick(Math.random, ['shy', 'laugh']), 1.6, { say: { text: 'つまずいた…見てた？' } }) }) });
  if (act === 'hop') { W.dir = W.x < wMinX() + 80 ? 1 : W.x > wMaxX() - 80 ? -1 : (Math.random() < .5 ? -1 : 1); W.hops = 2 + Math.floor(Math.random() * 3); W.hopT = 0; return walkerSet('hop', 99, 'normal'); }
  if (act === 'look') return walkerSet('look', 2.6, 'normal');
  if (act === 'rest') return walkerSet('idle', rnd(6, 12), 'normal');   // なにもしないで立っている
  // 立ったまま、うとうと（半分は目を閉じた絵で）
  if (act === 'doze') { walkerSet('doze', rnd(6, 10), 'sleep'); if (Math.random() < .5) wSprite('drowsy'); W.say.hidden = true; return; }
  if (act === 'lie') { walkerPose(pick(Math.random, SLEEPS), rnd(7, 11), { mode: 'lie' }); W.say.hidden = true; return; } // 寝そべって、すやすや
  if (act === 'fly') { W.tx = rnd(wMinX(), wMaxX()); W.ty = rnd(70, Math.max(110, innerHeight * .3)); return walkerSet('fly', rnd(3.2, 4.5), 'wink'); }
  if (['stretch', 'spin', 'dance', 'bounce', 'yawn'].includes(act)) return walkerSet(act, { stretch: 2.4, spin: 1.1, dance: rnd(2.6, 3.6), bounce: 1.8, yawn: 1.8 }[act], { stretch: 'sleep', spin: 'happy', dance: 'happy', bounce: 'happy', yawn: 'surprise' }[act]);
  if (act === 'peek') { W.peekDir = W.x < innerWidth / 2 ? -1 : 1; W.peekX = W.x; return walkerSet('peek', 4.2, 'normal'); }
  if (act === 'tip') { const t = pick(Math.random, TIPS); return walkerPose(t.pose, 4.2, { anim: 'sway', say: { text: t.text } }); }
  if (act === 'home') { if (ui.page !== 'home') return startAct('p:wave'); const l = pick(Math.random, homeLines()); return l ? walkerSet('talk', 3.6, l.mood) || walkerSay(l) : startAct('p:wave'); }
  const name = act.slice(2), anim = { sing: 'sway', wave: 'sway', jump: 'hop', heart: 'sway', fired: 'bounce', laptop: 'still', tablet: 'still', think: 'still', calm: 'still' }[name] || 'still';
  const says = { sing: ['ふんふふーん♪', 'らららー♪', '♪〜 きょうも いい日〜'], laptop: ['（カタカタ…）勉強のコツを調べてるよ', '（カタカタ…）次の計画、考え中', '（カタカタ…）きみの苦手、分析してるよ'], tablet: ['今日の予定、見直してたんだ', '参考書の進み、いい感じだよ', 'ふむふむ、今週は順調'],
    fired: ['よし、今日もがんばろう！', 'いける！ いける！', '気合い入れていこう！'], heart: ['いつもおつかれさま！', 'きみのこと、応援してるよ', 'だいすき！'], jump: ['わーい！', 'ぴょん！', 'たのしい！'],
    gift: ['はい、これ。元気のおすそわけ', 'プレゼント…は、ぼくの応援！'], shy: ['…見られてる？', 'えへへ'], puzzled: ['あれ？', 'うーん？'], talk: ['ねえねえ', 'ちょっと聞いて'], announce: ['お知らせ！ 今日もえらい！', '休けいもだいじだよー！'], think: ['うーん…', 'なるほど…', 'えっと…'], calm: ['すう…はあ…', 'ふう'], wave: ['やっほー', 'こっち見て！', 'はーい'] }[name];
  const say = says && pick(Math.random, says);
  walkerPose(name, name === 'laptop' ? rnd(4, 6) : rnd(2.4, 3.4), { anim, say: say && Math.random() < .5 ? { text: say } : null });
}
/* 跳ねて移動：しゃがむ → 跳ぶ（放物線）→ 着地でつぶれる、をくり返す */
const HOP = { crouch: .12, air: .42, land: .14, rest: .16 };
function walkerTick(ts) {
  requestAnimationFrame(walkerTick);
  if (!W.el) return;
  const dt = Math.min(.05, (ts - (W.last || ts)) / 1000); W.last = ts;
  const show = ui.role === 'student' && ui.page !== 'ai' && !W.hidden && !(ui.botOpen && innerWidth <= 820);  // スマホは相談の小窓を開いたら隠れる
  W.el.style.display = show ? '' : 'none';
  if (!show) return;
  const now = wNow(), reduce = matchMedia('(prefers-reduced-motion: reduce)').matches, S = wSize() / 260;
  let hy = 0, sx = 1, sy = 1, rot = 0, shx = 0; // 跳ねた高さ・横と縦の伸び縮み・傾き・横の震え
  W.t = (W.t || 0) + dt;
  // 30秒さわらないと、寝そべって眠る
  if (!['drag', 'fall', 'sleep', 'fly', 'peek', 'spin', 'pet', 'sulk', 'lie'].includes(W.mode) && Date.now() - W.idleAt > 30000) { walkerPose(pick(Math.random, SLEEPS), 999, { mode: 'sleep' }); W.say.hidden = true; }
  switch (W.mode) {
    case 'walk': { // 歩き：20コマを順に。右向きの絵なので、左へ行くときは反転。1コマ分の歩幅に合わせて進む（小股にならないように）
      if (reduce) { W.x = W.tx; walkerSet('idle', 3, 'normal'); break; }
      const st = W.style || (W.run ? 'run' : 'walk');
      let speed = 190, fps = 17;
      if (st === 'run') { wSprite('run', W.dir < 0); speed = 420; hy = Math.abs(Math.sin(W.t * 14)) * 10 * S; rot = W.dir * 8; }
      else if (st === 'stroll') { fps = 5.5; wSprite(STROLL_FRAMES[Math.floor(W.t * fps) % 4], W.dir < 0); speed = 105; hy = Math.abs(Math.sin(W.t * fps / 2 * Math.PI)) * 4 * S; rot = W.dir * Math.sin(W.t * fps / 2 * Math.PI) * 2; }
      else if (st === 'carry') { wSprite(W.carry, W.dir < 0); speed = W.speed || 120; hy = Math.abs(Math.sin(W.t * 7)) * 6 * S; rot = Math.sin(W.t * 7) * 3; }
      else { wSprite(WALK_FRAMES[Math.floor(W.t * fps) % 20], W.dir < 0); hy = Math.abs(Math.sin(W.t * fps / 10 * Math.PI)) * 3 * S; rot = W.dir * Math.sin(W.t * fps / 10 * Math.PI) * 1.5; }
      W.x += W.dir * speed * S * dt;
      if ((W.dir > 0 && W.x >= W.tx) || (W.dir < 0 && W.x <= W.tx) || W.x <= wMinX() - 2 || (W.dir > 0 && W.x >= wMaxX() + 2)) {
        const r = Math.random(), after = W.after; W.after = null; W.style = null; W.run = false; walkerSet('idle', rnd(4, 8), 'normal');
        if (after) after();
        else if (st === 'run') walkerPose(pick(Math.random, ['yay', 'hooray']), 1.4, { anim: 'bounce', say: Math.random() < .5 ? { text: pick(Math.random, ['とうちゃく！', 'はやいでしょ？', 'ふう、走った〜']) } : null });
        else if (r < .25) walkerPose(pick(Math.random, ['wave', 'hello', 'raise']), 1.6, { anim: 'sway' }); else if (r < .4) walkerSet('look', 2.2, 'normal'); else if (r < .5) walkerPose(pick(Math.random, ['puzzled', 'wonder']), 1.4, { say: { text: pick(Math.random, ['あれ、ここどこだっけ', 'ん？', 'なにか落ちてた？']) } });
      }
      break;
    }
    case 'pose': case 'sulk': case 'pet': case 'lie': case 'sleep': {
      if (W.seq) { const tot = W.seq.reduce((x, f) => x + f[1], 0); let u = W.t % tot; for (const [n, d] of W.seq) { if (u < d) { wSprite(n); break; } u -= d; } }
      const a = W.mode === 'sleep' || W.mode === 'lie' ? 'breathe' : W.anim;
      if (!reduce) {
        if (a === 'bounce') { const b = Math.abs(Math.sin(W.t * 8)); hy = b * 10 * S; sy = 1 + (b - .5) * .04; }
        else if (a === 'shake') { shx = Math.sin(W.t * 55) * 4 * S * Math.max(0, 1 - W.t / 1.2); rot = Math.sin(W.t * 40) * 2 * Math.max(0, 1 - W.t / 1.2); }
        else if (a === 'sway') rot = Math.sin(W.t * 3.2) * 4;
        else if (a === 'breathe') sy = 1 + Math.sin(now / 900) * .02;
        else if (a === 'hop') hy = Math.max(0, Math.sin(Math.min(1, W.t / .45) * Math.PI)) * 30 * S;
        else sy = 1 + Math.sin(now / 650) * .01;
      }
      if (W.mode === 'sulk') rot += Math.sin(now / 500) * 1.5;
      if (W.mode !== 'sleep' && now > W.until) {
        const then = W.then; W.then = null;
        if (W.mode === 'pet') { walkerPose(W.petStage >= 3 ? 'surprise' : 'smile', 1.8, { anim: 'sway', say: { text: W.petStage >= 3 ? 'はっ！ 寝てた…' : W.petStage >= 1 ? pick(Math.random, ['ありがとう！ げんき出た！', 'また、なでてね', 'ぼくもきみを応援する！']) : pick(Math.random, ['えへへ。', 'ありがと']) } }); W.mood = Math.min(5, W.mood + 1); break; }
        if (then) then(); else walkerSet('idle', rnd(4, 9), 'normal');
      }
      break;
    }
    case 'dizzy': // 振り回されたあと：ふらふら
      rot = Math.sin(W.t * 6) * 7 * Math.max(0, 1 - W.t / 2.2); shx = Math.sin(W.t * 6) * 5 * S;
      if (now > W.until) walkerPose(pick(Math.random, ['puzzled', 'confused']), 1.4, { say: { text: '…ここどこ？' } });
      break;
    case 'hop': {
      if (reduce) { walkerSet('idle', 4, 'normal'); break; }
      W.hopT += dt;
      const { crouch, air, land, rest } = HOP, T = crouch + air + land + rest, u = W.hopT;
      if (u < crouch) { const k = u / crouch; sy = 1 - .09 * k; sx = 1 + .06 * k; }
      else if (u < crouch + air) { const v = (u - crouch) / air; hy = Math.sin(Math.PI * v) * 34 * S;
        sy = 1 + .05 * Math.cos(Math.PI * v); sx = 1 - .03 * Math.cos(Math.PI * v); rot = W.dir * 5 * Math.sin(Math.PI * v);
        W.x += W.dir * (62 * S / air) * dt; }
      else if (u < crouch + air + land) { const k = 1 - (u - crouch - air) / land; sy = 1 - .1 * k; sx = 1 + .07 * k; }
      if (u >= T) { W.hopT = 0; W.hops -= 1;
        if (W.x <= wMinX() + 4) W.dir = 1; if (W.x >= wMaxX() - 4) W.dir = -1;
        if (W.hops <= 0) walkerSet('idle', rnd(4, 8), 'normal'); }
      W.bot.style.setProperty('--lx', W.dir * 4 + 'px'); W.bot.style.setProperty('--ly', '1px');
      break;
    }
    case 'idle': case 'act': case 'talk':
      sy = 1 + Math.sin(now / 650) * .012; // 息をしている
      // 小窓に隠れていたら、見える所まで歩いてどく
      if (W.x > wMaxX() + 20 && W.mode !== 'talk') { W.tx = wMaxX(); W.dir = -1; walkerSet('walk', 30); break; }
      if (now > W.until) { if (reduce) { walkerSet('idle', 5, 'normal'); break; } startAct(nextAct()); }
      break;
    case 'stretch': { const u = W.t / 2.4, k = u < .5 ? Math.sin(u * Math.PI) : Math.max(0, Math.sin(u * Math.PI)) * (1 - (u - .5) * .6);
      sy = 1 + .11 * k; sx = 1 - .05 * k; hy = 6 * k * S; rot = -3 * k; if (u > .85) rot = Math.sin(now / 40) * 1.5;
      if (now > W.until) walkerSet('act', 1.2, 'happy'); break; }
    case 'spin': { const u = Math.min(1, W.t / 1.1); W.ry = (1 - Math.cos(u * Math.PI)) / 2 * 360; hy = Math.sin(u * Math.PI) * 18 * S;
      if (now > W.until) { W.ry = 0; walkerSet('act', 1.2, 'happy'); botJump(W.bot); } break; }
    case 'dance': { const beat = W.t * 4.2; rot = Math.sin(beat) * 9; hy = Math.abs(Math.sin(beat)) * 10 * S; sx = 1 + Math.cos(beat * 2) * .04; sy = 1 - Math.cos(beat * 2) * .04;
      W.x += Math.cos(beat) * 22 * S * dt; if (now > W.until) walkerSet('act', 1.4, 'wink'); break; }
    case 'peek': { const u = W.t / 4.2, edge = W.peekDir < 0 ? -wSize() * .72 : innerWidth - wSize() * .28;
      const k = u < .3 ? u / .3 : u < .72 ? 1 : 1 - (u - .72) / .28;
      W.x = W.peekX + (edge - W.peekX) * Math.min(1, Math.max(0, k)); rot = W.peekDir * -14 * (u > .3 && u < .72 ? 1 : 0) * Math.min(1, (u - .25) * 8);
      W.bot.style.setProperty('--lx', -W.peekDir * 5 + 'px'); W.bot.style.setProperty('--ly', '0px');
      if (now > W.until) { W.x = W.peekX; walkerSet('act', 1.4, 'wink'); } break; }
    case 'bounce': { const b = Math.abs(Math.sin(W.t * 9)); hy = b * 14 * S; sy = 1 + (b - .5) * .06; sx = 1 - (b - .5) * .05;
      if (now > W.until) walkerSet('idle', rnd(4, 8), 'normal'); break; }
    case 'yawn': { const u = Math.min(1, W.t / 1.8), k = Math.sin(u * Math.PI); rot = -6 * k; sy = 1 + .04 * k; hy = 3 * k * S;
      W.bot.classList.toggle('talking', k > .3);
      if (now > W.until) { W.bot.classList.remove('talking'); Math.random() < .5 ? startAct('lie') : walkerSet('idle', rnd(3, 6), 'normal'); } break; }
    case 'look': { const side = Math.sin(W.t * 3.2) > 0 ? 1 : -1;
      W.bot.style.setProperty('--lx', side * 5 + 'px'); W.bot.style.setProperty('--ly', '0px'); rot = side * 2;
      if (now > W.until) walkerSet('idle', rnd(4, 8), 'normal'); break; }
    case 'doze': { // 立ったまま眠る：ゆっくり傾いて、かくん、と戻る
      const c = (now / 2600) % 1, nod = c < .8 ? c / .8 : 1 - (c - .8) / .2;
      rot = 3 + nod * 5; hy = -nod * 3 * S; sy = 1 - nod * .015;
      if (now > W.until) { walkerSet('talk', 1.6, 'surprise'); botJump(W.bot); setTimeout(() => W.mode === 'talk' && setBotMood(W.bot, 'happy'), 700); }
      break; }
    case 'fly':
      W.phase += dt * 3; W.x += (W.tx - W.x) * Math.min(1, dt * 1.6); W.y += (W.ty - W.y) * Math.min(1, dt * 1.6);
      hy = Math.sin(W.phase) * 6 * S; rot = (W.tx > W.x ? 6 : -6);
      if (now > W.until) { W.vy = 0; walkerSet('fall', 9, 'surprise'); }
      break;
    case 'fall':
      W.vy -= 1700 * dt; W.y += W.vy * dt; sy = 1.05; sx = .97;
      if (W.y <= 0) { W.y = 0; W.vy = 0; botJump(W.bot);
        if (W.dizzy) { W.dizzy = false; walkerSet('dizzy', 2.2); wSprite('puzzled'); walkerSay({ text: 'ふ、ふらふら〜' }, 2000); }
        else if (W.sp === 'shock') walkerPose(pick(Math.random, ['surprise', 'startled']), 1, { then: () => walkerSet('idle', 1.4, 'happy') });
        else walkerSet('idle', 1.4, 'happy'); }
      break;
    case 'drag': rot = clamp(-W.dragVx * .04, -14, 14); W.dragVx *= .85; break; // つまむと、ふりこのように揺れる
  }
  if (W.mode !== 'spin') W.ry = 0;
  W.x = W.mode === 'peek' ? clamp(W.x, -wSize() * .75, innerWidth - wSize() * .25) : clamp(W.x, 0, Math.max(0, innerWidth - wSize()));
  W.el.style.transform = `translate(${W.x}px, ${-(wGround() + W.y)}px)`;
  W.bot.querySelector('.bot-inner').style.transform = `translate(${shx}px, ${-hy}px) rotate(${rot}deg) rotateY(${W.ry || 0}deg) scale(${sx}, ${sy})`;
  const k = Math.max(.35, 1 - (W.y + Math.max(0, hy)) / 400);
  W.shadow.style.transform = `translateY(${W.y}px) scale(${k})`; W.shadow.style.opacity = k;
  if (!W.say.hidden && now > W.sayUntil) W.say.hidden = true;
  W.say.classList.toggle('to-left', W.x > innerWidth - 360); W.say.classList.toggle('to-right', W.x < 120);
}
/* 画面が変わったら一言。眠っていたら起きる */
function walkerOnRender() {
  if (!W.el) walkerInit();
  if (ui.role !== 'student') return;
  if (W.page !== ui.page) {
    W.page = ui.page;
    const line = ui.botEvent || pageLine(ui.page);
    if (line && !['sleep', 'lie', 'sulk', 'drag', 'pet'].includes(W.mode)) setTimeout(() => {
      if (line.pose) walkerPose(line.pose, 4, { anim: 'sway', say: line }); else { walkerSet('talk', 4, line.mood); if (line.jump) botJump(W.bot); walkerSay(line); } }, 500);
  }
}
['pointermove', 'keydown', 'scroll', 'pointerdown'].forEach(t => document.addEventListener(t, e => {
  W.idleAt = Date.now();
  // 30秒放っておいて眠ったときだけ、動かすと起きる（うとうと・昼寝は、押すか時間で起きる）
  if (W.mode === 'sleep' && W.el && !(e.target.closest && e.target.closest('#walker'))) walkerPose('surprise', 1.6, { anim: 'hop', say: { text: 'わっ、おかえり！' } });
}, { passive: true }));
