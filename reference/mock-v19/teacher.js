'use strict';
/* ---------- 講師の画面 ---------- */

/* 生徒：1人1枚のカード。やることの箇条書きは置かず、計画の中で補助として出す */
function studentAlerts(sid) {
  const ws = weekStats(sid), l = lastRecord(sid), out = [];
  if (!l || daysBetween(l, DAY) >= 3) out.push({ tone: 'red', text: l ? `記録が${daysBetween(l, DAY)}日ない` : 'まだ記録がない' });
  if (ws.missed.length) out.push({ tone: 'red', text: `やり残し${ws.missed.length}件` });
  const lack = shortages(sid).length; if (lack) out.push({ tone: 'amber', text: `小テスト不足${lack}件` });
  const nextWeek = dateAdd(weekStart(DAY), 7), nw = weekStats(sid, nextWeek);
  if (!availRegistered(sid, nextWeek)) out.push({ tone: 'amber', text: '来週の勉強できる時間が未登録' });
  else if (nw.avail && nw.planned / nw.avail < .3) out.push({ tone: 'ink', text: '来週の計画がまだ' });
  return out;
}
function tHome() {
  const list = students().map(p => ({ p, al: studentAlerts(p.id), ws: weekStats(p.id) })).sort((a, b) => b.al.length - a.al.length);
  return `<div class="head"><h1>担当の生徒 <span class="count">${list.length}人</span></h1><span class="muted">対応が必要な順</span></div>
  <div class="scards">${list.map(({ p, al, ws }) => {
    const cm = commentsOf(p.id)[0], nx = nextMeeting(p.id);
    const nw = weekStats(p.id, dateAdd(weekStart(DAY), 7));
    return `<section class="card scard" data-act="open-plan" data-id="${p.id}" role="button" tabindex="0">
      <div class="sc-top"><span class="avatar">${esc(first(p.name)[0])}</span><div class="body"><h2>${esc(p.name)}</h2><p class="muted">${esc(p.grade)} · ${esc(p.goal.school)}まで${daysBetween(DAY, p.goal.date)}日</p></div>
        <p class="sc-meet ${nx ? '' : 'amber-t'}">${nx ? `面談 ${mdw(nx.date)}` : '面談 未予約'}</p></div>
      <p class="alerts">${al.length ? al.map(a => `<span class="${a.tone}-t">${esc(a.text)}</span>`).join('') : '<span class="muted">気になる点はありません</span>'}</p>
      <dl class="sc-week">
        <div><dt>今週の予定</dt><dd class="num">${ws.done.length}/${ws.due.length}件 完了</dd></div>
        <div><dt>来週の計画</dt><dd class="num">${nw.avail ? `${nw.planned ? hours(nw.planned) : 'まだ'}<span class="muted"> / 空き ${hours(nw.avail)}</span>` : '<span class="muted">勉強できる時間が未登録</span>'}</dd></div>
      </dl>
      <div class="sc-books">${booksOf(p.id).map(b => { const x = bookProgress(p.id, b.material); return `<div><span>${esc(x.m.short)}</span>${progressBar(x)}<span class="num muted">${x.done}/${x.total}</span><span>${statusTag(x)}</span></div>`; }).join('')}</div>
      ${cm ? `<p class="sc-cm">${ic('msg', 16)}<span><span class="muted">${md(cm.date)} ${esc(mat(cm.material).short)}</span> ${tagHtml(cm.comment.tag)}${esc(cm.comment.text)}</span></p>` : ''}
    </section>`; }).join('')}</div>`;
}

/* ---------- 計画：先生が自由に入れる。おすすめはボタンを押したときだけ ----------
   - 空き（勉強できる時間のうち、まだ何も入っていない所）を押すと、右にその時間が開く
   - 入れ方：①参考書の次の範囲（ボタン1つ）②時間だけ取る（予備時間・模試の復習など）③おすすめで残りを埋める ④目次から選ぶ
   - 長さは残りの時間に合わせる（残りが短ければいっぱいに、長ければいつもの時間）。一覧の −／＋ で5分ずつ変えられ、後ろは詰めて並び直す
   - 1周目の範囲は、入れた順ではなく日付の順に番号がそろう（data.js の resequence）
   - カレンダーのドラッグ・クリックでの自由な追加もそのまま使える */
const MIN_GAP = 15, MIN_TASK = 15, SHRINK = 0.8, STRETCH = 1.5;
const round5 = x => Math.round(x / 5) * 5;
/* 1つだけ入れるときの長さ（ドラッグで空きに落としたとき）：短い枠はいっぱいに。長い枠はいつもの時間（端数が20分未満ならいっぱいに） */
function fitDur(len, typical) {
  if (len <= typical + 20) return len;
  return len - typical < 20 ? len : typical;
}
function weekGaps(sid, start) {
  return weekDays(start).filter(d => d > DAY).flatMap(d => freeGaps(sid, d, {}).filter(([s, e]) => e - s >= MIN_GAP).map(([s, e]) => ({ date: d, s, e })));
}
const gapKey = g => g && `${g.date}:${g.s}`;
/* この空きに入れられるもの（再テスト・やり残し・参考書の次の範囲）を、入れたい順に */
function candidatesFor(sid, gap) {
  const len = gap.e - gap.s, sameDay = tasksOf(sid).filter(t => t.date === gap.date).map(t => t.material);
  const planned = id => state.tasks.some(t => t.student === sid && t.node === id && t.status !== 'done');
  const c = [];
  reviewQueue(sid).forEach(r => {
    if (planned(r.node) || r.due > dateAdd(gap.date, 3)) return;
    const late = daysBetween(r.due, gap.date);
    c.push({ kind: 'review', id: r.key, node: r.node, m: r.mat, badge: '再テスト', tone: 'amber',
      reason: `${late >= 0 ? '時期が来た' : md(r.due) + 'が時期'}・前回${r.lp}%`, score: 100 + Math.min(late, 10) - (late < 0 ? 30 : 0) });
  });
  tasksOf(sid).filter(isMissed).forEach(t => c.push({ kind: 'task', id: t.id, node: t.node, m: mat(t.material), badge: 'やり残し', tone: 'red', reason: `${md(t.date)}にできなかった分`, score: 90, task: t }));
  // 参考書の次の範囲：目標日から逆算した今週の目安（＋1）を、週の中にならして出す。目安を超えた分は「先取り」として後回し
  const wk = weekDays(weekStart(gap.date)), di = wk.indexOf(gap.date);
  booksOf(sid).forEach(b => {
    const p = bookProgress(sid, b.material), behind = p.status.tone !== 'green', quota = Math.ceil(p.needPerWeek || 1) + 1;
    const placed = tasksOf(sid).filter(t => t.material === b.material && !t.retest && wk.includes(t.date)).length, expected = quota * (di + 1) / 7;
    p.m.nodes.filter(x => !state.tasks.some(t => t.student === sid && t.node === x.id)).slice(0, 2).forEach((n, i) => {
      const k = placed + i, ahead = k >= quota;
      c.push({ kind: 'node', id: n.id, node: n.id, m: p.m, badge: ahead ? '先取り' : '次の範囲', tone: ahead ? 'gray' : 'blue',
        reason: ahead ? `今週の目安${quota}範囲は入れ終わり` : i ? `その次・今週の目安${quota}範囲` : behind ? `遅れ気味・目標${md(p.b.target)}` : `続き・今週の目安${quota}範囲`,
        score: ahead ? 15 - i * 10 : (behind ? 75 : 55) + Math.round((expected - k) * 20) - i * 30 });
    });
    // 演習の解き直し：前回7割未満で、まだ解き直していない範囲
    if (p.m.type === '演習') p.m.nodes.forEach(n => {
      const ts = tasksOf(sid).filter(t => t.node === n.id).sort(byTime), last = ts.at(-1);
      if (!last || last.status !== 'done' || last.score == null || ts.length > 1) return;
      const lp = pct(last.score, last.max); if (lp >= 70) return;
      c.push({ kind: 'node', id: n.id, node: n.id, m: p.m, badge: '解き直し', tone: 'amber', reason: `前回${lp}%・間違えた所をもう一度`, score: 45 - lp / 10 });
    });
  });
  c.forEach(x => {
    x.typ = x.task ? x.task.duration : typicalDur(sid, x.m.id);
    if (len <= 45 && x.m.type === '演習') x.score -= 45;   // 短い枠（朝・電車）は覚えるものを優先
    if (sameDay.includes(x.m.id)) x.score -= 20;          // 同じ日に同じ教材が続かないように
    x.pdf = x.task ? pdfOf(x.task) : freePdf(sid, x.node);
    if (!x.pdf && needsPdf(x.node)) x.score -= 8;
  });
  return c.sort((a, b) => b.score - a.score);
}
/* 案に入る？（いつもの時間の合計を2割まで縮めて枠に収まるなら入る） */
const fitsIn = (len, items, x) => (items.reduce((a, y) => a + y.typ, 0) + x.typ) * SHRINK <= len && (items.length + 1) * MIN_TASK <= len;
/* 枠の長さにぴったり合う組み合わせを選ぶ。まず教材が重ならないように、足りなければ同じ教材の続きも。
   いつもの時間の合計が枠より少し短ければ伸ばして埋める（1.5倍まで） */
function packGap(len, cands) {
  const set = [], mats = new Set(); let sum = 0;
  for (const pass of [0, 1]) for (const x of cands) {
    if (len - sum < 25) return set;   // 残りが短ければ、入れたものを少し伸ばして埋める
    if (set.includes(x) || (pass === 0 && mats.has(x.m.id))) continue;
    if (set.length ? sum + x.typ > len + 5 : !fitsIn(len, set, x)) continue;  // 縮めてよいのは1件目だけ（短い枠にいっぱいで入れるとき）
    set.push(x); mats.add(x.m.id); sum += x.typ;
  }
  return set;
}
/* 枠の中の並び：考える演習を先に、覚えるもの（単語・再テスト）を後に（寝る前に覚えたものは残りやすい） */
const orderSet = items => [...items].sort((a, b) => (a.m.type === '演習' ? 0 : 1) - (b.m.type === '演習' ? 0 : 1));
/* 枠の長さに合わせて時間を配る（5分単位。合計が枠の長さぴったりになるように） */
function fitSet(len, gapStart, items) {
  const sum = items.reduce((a, x) => a + x.typ, 0); if (!sum) return { items: [], used: 0 };
  const k = Math.min(STRETCH, len / sum), target = k >= STRETCH ? Math.min(len, round5(sum * k)) : len;
  const durs = items.map(x => Math.max(MIN_TASK, round5(x.typ * k)));
  for (let diff = target - durs.reduce((a, b) => a + b, 0), g = 0; diff && g < 200; g++) {
    const i = durs.indexOf(Math.max(...durs)), step = Math.abs(diff) >= 5 ? 5 * Math.sign(diff) : diff;
    if (durs[i] + step < MIN_TASK) break;
    durs[i] += step; diff -= step;
  }
  let at = gapStart;
  return { items: items.map((x, i) => { const o = { ...x, dur: durs[i], start: at }; at += durs[i]; return o; }), used: at - gapStart };
}
/* 1件をその時刻・長さで入れる（ボタン・ドラッグ・おすすめ がここを通る） */
function putTask(sid, date, s, duration, kind, id) {
  if (kind === 'task') { const t = state.tasks.find(x => x.id === id); if (!t || t.status === 'done') return null; t.date = date; t.time = toTime(s); t.duration = duration; return t; }
  const nid = kind === 'review' ? reviewQueue(sid).find(r => r.key === id)?.node : id;
  if (!nid) return null;
  const n = node(nid), p = freePdf(sid, nid);
  const t = { id: uid(), student: sid, date, time: toTime(s), duration, material: n.m.id, node: nid, status: 'todo',
    pdf: p?.id || null, ...(p ? { max: p.max } : {}), retest: state.tasks.some(o => o.student === sid && o.node === nid && o.status === 'done') };
  state.tasks.push(t); return t;
}
/* 時間だけ取る予定（予備時間・模試の復習など）。教材なし・小テストなし */
function putVague(sid, date, s, duration, k, title) {
  const v = VAGUE.find(x => x.k === k);
  const t = { id: uid(), student: sid, date, time: toTime(s), duration, material: 'free', node: 'free:' + uid(), title: title || v?.label || 'その他', vague: k || 'free', status: 'todo', pdf: null, noQuiz: true, retest: false };
  state.tasks.push(t); return t;
}
/* 1件だけ空きに入れる（ドラッグで落としたとき）。長さは空きに合わせる */
function fillGap(sid, gap, kind, id) {
  const typ = kind === 'task' ? state.tasks.find(x => x.id === id)?.duration || 30 : typicalDur(sid, kind === 'review' ? reviewQueue(sid).find(r => r.key === id)?.mat.id : node(id).m.id);
  return putTask(sid, gap.date, gap.s, fitDur(gap.e - gap.s, typ), kind, id);
}

/* ---------- 枠（勉強できる時間のまとまり） ---------- */
function weekBlocks(sid, start) {
  return weekDays(start).filter(d => d > DAY).flatMap(d => availOn(sid, d).map(a => ({ date: d, s: toMin(a.start), e: toMin(a.end), label: a.label })));
}
const blkKey = b => b && `${b.date}:${b.s}`;
const blockAt = (sid, date, m) => date > DAY ? weekBlocks(sid, weekStart(date)).find(b => b.date === date && m >= b.s && m < b.e) || null : null;
const inBlock = (t, b) => t.date === b.date && toMin(t.time) >= b.s && toMin(t.time) < b.e;
const blockTasks = (sid, b) => tasksOf(sid).filter(t => inBlock(t, b)).sort(byTime);
const blockGaps = (sid, b) => freeGaps(sid, b.date).filter(([s, e]) => s >= b.s && e <= b.e && e - s >= MIN_GAP);
/* 一覧で長さを変えた・外したあとは、枠の頭から順に詰め直す（面談の時間はよける） */
function repack(sid, b) {
  const mt = meetingOn(sid, b.date), ms = mt ? toMin(mt.time) : -1, me = mt ? ms + mt.len : -1;
  let at = b.s;
  blockTasks(sid, b).forEach(t => { if (mt && at < me && at + t.duration > ms) at = Math.max(at, me); t.time = toTime(at); at += t.duration; });
}
/* 参考書の「次の範囲」をこの時刻に入れたら、どの範囲になるか（範囲は日付の順にそろうので、前に入れた予定より早い日なら若い番号になる） */
function predictRange(sid, mid, date, s) {
  const m = mat(mid), nxt = nextNode(sid, mid); if (!nxt) return null;
  const idx = id => m.nodes.findIndex(n => n.id === id), plan = tasksOf(sid).filter(t => t.material === mid && t.status !== 'done' && !t.retest);
  const nodes = [...plan.map(t => t.node), nxt.id].sort((a, b) => idx(a) - idx(b)), before = plan.filter(t => t.date + t.time < date + toTime(s)).length;
  return { node: nodes[before], shifted: nodes[before] !== nxt.id };
}
/* 「おすすめで残りを埋める」：枠の空きごとに、長さにぴったりの組み合わせ */
function recommendFill(sid, b) {
  const out = [];
  for (const [s, e] of blockGaps(sid, b)) {
    const gap = { date: b.date, s, e }, fit = fitSet(e - s, s, orderSet(packGap(e - s, candidatesFor(sid, gap))));
    fit.items.forEach(x => { const t = putTask(sid, b.date, x.start, x.dur, x.kind, x.id); if (t) out.push(t); });
  }
  return out;
}
/* おすすめの中身を、押す前に一言で見せる（入れはしない） */
function recommendPreview(sid, b) {
  const g = blockGaps(sid, b)[0]; if (!g) return [];
  return orderSet(packGap(g[1] - g[0], candidatesFor(sid, { date: b.date, s: g[0], e: g[1] })));
}

/* ---------- 自由に書いて入れる（既定の入れ方） ----------
   「模試の直し」のように書けば時間だけ取る予定に、「ターゲット 801」「古文 単語」のように教材の名前を書けば
   その参考書の範囲（番号があればその範囲、無ければ次の範囲）に結びつけて小テストも付ける */
function parseFreeEntry(sid, text) {
  const t = String(text || '').trim(); if (!t) return null;
  const vg = VAGUE.find(v => v.label === t); if (vg) return { kind: 'vague', v: vg, title: vg.label };
  const n = norm(t), nums_ = nums(t);
  let best = null, bestScore = 0;
  for (const m of booksOf(sid).map(b => mat(b.material)).concat(visibleMats().filter(m => !book(sid, m.id)))) {
    const keys = [m.name, m.short, ...(m.keys || [])].map(norm).filter(k => k.length >= 2);
    const sc = keys.filter(k => n.includes(k) || k.includes(n) && n.length >= 2).reduce((a, k) => a + Math.min(k.length, n.length), 0);
    if (sc > bestScore) { best = m; bestScore = sc; }
  }
  if (!best) return { kind: 'free', title: t };
  let hit = null;
  if (nums_.length) hit = best.nodes.find(x => { const ln = nums(x.label); return ln.length && nums_.every(v => ln.includes(v)); }) || best.nodes.find(x => nums(x.label).includes(nums_[0]));
  if (!hit) { const rest = norm(t.replace(/\d+/g, '')); hit = best.nodes.find(x => { const lt = norm(x.label.replace(/\d+/g, '')); return lt.length >= 2 && (rest.includes(lt) || (lt.includes(rest) && rest.length >= 3 && !keysOf(best).some(k => rest.includes(k)))); }); }
  if (!hit) return { kind: 'next', m: best, node: nextNode(sid, best.id)?.id || null };
  const done = state.tasks.some(x => x.student === sid && x.node === hit.id && x.status === 'done'), planned = tasksOf(sid).find(x => x.node === hit.id && x.status !== 'done');
  return { kind: 'node', m: best, node: hit.id, done, planned };
}
const keysOf = m => [m.name, m.short, ...(m.keys || [])].map(norm).filter(k => k.length >= 2);
function freeEntryHint(sid, pe) {
  if (!pe) return '';
  if (pe.kind === 'vague') return `${esc(pe.v.label)}として入れます${pe.v.note ? `（${esc(pe.v.note)}）` : ''}`;
  if (pe.kind === 'free') return `「${esc(pe.title)}」として入れます（教材なし）`;
  const nid = pe.node; if (!nid) return `${esc(pe.m.short)}は1周ぶん入っています。上で教材を選んで範囲を指定してください`;
  const p = freePdf(sid, nid), q = p ? ` · 小テスト第${p.version}版` : needsPdf(nid) ? ' · <span class="amber-t">使える小テストなし</span>' : '';
  if (pe.kind === 'next') return `次の範囲：${esc(pe.m.short)} <b>${esc(node(nid).label)}</b>${q}`;
  if (pe.planned) return `${esc(pe.m.short)} ${esc(node(nid).label)}は${mdw(pe.planned.date)}に入っています。ここへ移します`;
  return `${pe.done ? '再テスト' : '範囲'}：${esc(pe.m.short)} <b>${esc(node(nid).label)}</b>${q}`;
}
/* 入れる欄：まず「教材」を選ぶ（教材なし＝自由に書く／担当の参考書／ほかの教材）。
   教材を選んだら範囲を選ぶ（最初は次の範囲。済んだ範囲は再テスト、予定に入っている範囲は「ここへ移す」）。小テストは付けるか選べる */
function feNodeOf(sid, m, b, g0) {
  if (ui.feNode && m.nodes.some(n => n.id === ui.feNode)) return ui.feNode;
  return predictRange(sid, m.id, b.date, g0[0])?.node || m.nodes[0]?.id || null;
}
function feNodeInfo(sid, nid, b, g0) {
  const ts = tasksOf(sid).filter(x => x.node === nid), done = ts.filter(x => x.status === 'done'), planned = ts.find(x => x.status !== 'done');
  const pr = predictRange(sid, node(nid).m.id, b.date, g0[0]);
  return { done: done.length, planned, next: pr?.node === nid, shifted: pr?.node === nid && pr.shifted, rv: reviewQueue(sid).find(r => r.node === nid), sc: done.filter(x => x.score != null).at(-1) };
}
function freeEntryHtml(sid, b, g0) {
  const rest = g0[1] - g0[0], books = booksOf(sid).map(x => mat(x.material)), others = visibleMats().filter(m => !books.includes(m));
  const m = ui.feMat && mat(ui.feMat), opts = d => [...new Set([15, 30, 45, 60, 90, rest].filter(x => x <= rest))].sort((a, c) => a - c)
    .map(x => `<option value="${x}" ${x === d ? 'selected' : ''}>${x === rest ? `残り全部（${dur(x)}）` : dur(x)}</option>`).join('');
  const tab = (id, label, cls = '') => `<button type="button" class="fe-tab ${cls} ${(ui.feMat || '') === id ? 'on' : ''}" aria-pressed="${(ui.feMat || '') === id}" data-act="fe-mat" data-v="${id}">${label}</button>`;
  const tabs = `<div class="fe-tabs" role="group" aria-label="教材">${tab('', '自由に書く')}${books.map(x => tab(x.id, `${subjDot(x)}${esc(x.short)}`)).join('')}
    ${others.length ? `<select class="fe-other ${m && !books.includes(m) ? 'on' : ''}" data-fe="other" aria-label="ほかの教材"><option value="">ほかの教材</option>${others.map(o => `<option value="${o.id}" ${ui.feMat === o.id ? 'selected' : ''}>${esc(o.short)}</option>`).join('')}</select>` : ''}</div>`;
  const foot = (d, ok) => `<div class="fe-row"><label class="fe-dur">長さ<select id="fe-dur">${opts(d)}</select></label><button class="btn primary" ${ok ? '' : 'disabled'}>この時間に追加</button></div>`;
  if (!m) { // 自由に書く
    const pe = parseFreeEntry(sid, ui.feText), typ = pe?.m ? typicalDur(sid, pe.m.id) : pe?.kind === 'vague' ? pe.v.dur : pe?.kind === 'free' ? 60 : 30;
    return `<form class="fe" id="free-entry">${tabs}
      <input id="fe-text" value="${esc(ui.feText || '')}" placeholder="例：模試の直し" autocomplete="off" aria-label="何をするか">
      <p class="fe-hint">${pe ? freeEntryHint(sid, pe) : ''}</p>
      <div class="fe-quick">${VAGUE.map(v => `<button type="button" class="chip sm" data-act="fe-quick" data-v="${v.k}">${esc(v.label)}</button>`).join('')}</div>
      ${foot(ui.feDur || fitDur(rest, typ), !!pe)}</form>`;
  }
  // 教材あり：範囲を選ぶ
  const nid = feNodeOf(sid, m, b, g0), info = nid ? feNodeInfo(sid, nid, b, g0) : null, typ = typicalDur(sid, m.id);
  const reviews = reviewQueue(sid);
  const optLabel = n => { const ts = tasksOf(sid).filter(x => x.node === n.id), dn = ts.filter(x => x.status === 'done'), pl = ts.find(x => x.status !== 'done'), rv = reviews.find(r => r.node === n.id), sc = dn.filter(x => x.score != null).at(-1);
    return `${dn.length ? '✓ ' : pl ? '● ' : '　'}${esc(n.label)}${pl ? `（${md(pl.date)}に予定）` : rv ? `（再テスト${rv.due <= b.date ? 'の時期' : ' ' + md(rv.due) + '頃'}）` : sc ? `（前回${pct(sc.score, sc.max)}%）` : dn.length ? '（済み）' : ''}`; };
  const p = nid && !info.planned ? freePdf(sid, nid) : info?.planned ? pdfOf(info.planned) : null, hasQ = nid && pdfsOf(nid).length;
  const kind = !nid ? '' : info.planned ? `${mdw(info.planned.date)}の予定をここへ移します`
    : info.done ? `再テスト（${info.done + 1}回目${info.sc ? `・前回${pct(info.sc.score, info.sc.max)}%` : ''}）`
    : info.next ? (info.shifted ? 'この日より後の同じ参考書の予定は、1つずつ後ろの範囲になります' : `${esc(m.short)}の続き`)
    : '次の範囲より先です。範囲は日付の順にそろえます';
  return `<form class="fe" id="free-entry">${tabs}
    <label class="fe-node">範囲<select id="fe-node" data-fe="node">${m.nodes.map(n => `<option value="${n.id}" ${n.id === nid ? 'selected' : ''}>${optLabel(n)}</option>`).join('')}</select></label>
    <p class="fe-hint">${kind}</p>
    ${hasQ || needsPdf(nid) ? `<label class="fe-q"><input type="checkbox" id="fe-quiz" ${ui.feQuiz !== false ? 'checked' : ''} ${p ? '' : 'disabled'}> ${p ? `小テスト第${p.version}版（${p.max}点）を付ける` : '<span class="amber-t">この生徒に使える小テストがありません</span>'}</label>` : ''}
    ${foot(ui.feDur || fitDur(rest, info?.planned ? info.planned.duration : typ), !!nid)}
    <p class="fe-hint muted">${esc(first(person(sid).name))}さんはいつも約${typ}分（直近5回）</p></form>`;
}
function tPlan() {
  const sid = ui.planStudent, p = person(sid), start = dateAdd(weekStart(DAY), ui.week * 7);
  const gaps = ui.availEdit ? [] : weekGaps(sid, start), blocks = ui.availEdit ? [] : weekBlocks(sid, start);
  if (!blocks.some(b => blkKey(b) === blkKey(ui.blk))) ui.blk = blocks.find(b => gaps.some(g => g.date === b.date && g.s >= b.s && g.e <= b.e)) || blocks[0] || null;
  const ws = weekStats(sid, start), free = gaps.reduce((a, g) => a + g.e - g.s, 0);
  const noAvail = !ui.availEdit && start > DAY && !availRegistered(sid, start), hadLast = availRegistered(sid, dateAdd(start, -7));
  return `<div class="plan-top">
    <label class="who-sel"><span class="sr">生徒</span><select id="plan-student">${students().map(x => `<option value="${x.id}" ${x.id === sid ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
    ${weekNav(start)}
    <span class="grow"></span>
    <p class="plan-sum">勉強できる時間 <b class="num">${hours(ws.avail)}</b><i></i>まだ空き <b class="num">${hours(free)}</b></p>
    <button class="btn sm ${ui.availEdit ? 'primary' : ''}" data-act="avail-edit">${ui.availEdit ? '直し終わった' : '<span><span class="long">勉強できる</span>時間を直す</span>'}</button>
  </div>
  ${ui.availEdit ? `<div class="notice"><div><b>${esc(first(p.name))}さんの勉強できる時間を直しています</b><p>なぞると追加、端をつかむと長さを変えられます。生徒の画面にもそのまま出ます。</p></div></div>`
    : `<p class="plan-legend"><span><i class="lg lg-gap"></i>空き（押して入れる）</span><span><i class="lg lg-meet"></i>面談</span><span><i class="lg lg-q"></i>小テスト付き</span><span><i class="lg lg-dot"></i>要確認</span></p>`}
  ${noAvail ? `<div class="notice"><div><b>${esc(first(p.name))}さんの${range(md(start), md(dateAdd(start, 6)))}の勉強できる時間が、まだありません</b><p>生徒が「予定」で週ごとに登録します。急ぐときは先週と同じ時間で仮に入れられます。</p></div>
    <div class="notice-act">${hadLast ? `<button class="btn sm primary" data-act="avail-copy">先週と同じで仮に入れる</button>` : ''}<button class="btn sm" data-act="avail-edit">時間を直接入れる</button></div></div>` : ''}
  <div class="plan">
    ${calendar({ sid, start, mode: ui.availEdit ? 'avail' : 'plan', gaps, blk: ui.availEdit ? null : ui.blk })}
    <aside class="card side ${ui.sheet ? 'open' : ''}">${planSide(sid, start, blocks)}</aside>
  </div>`;
}
function planSide(sid, start, blocks) {
  const tab = ui.sideTab, unread = commentsOf(sid).filter(t => !t.reply).length, b = ui.blk, rest = b ? blockGaps(sid, b).reduce((a, [s, e]) => a + e - s, 0) : 0;
  return `<button class="sheet-h" data-act="sheet" aria-expanded="${ui.sheet ? 'true' : 'false'}"><i class="grip"></i><span>${b ? `<b>${mdw(b.date)} ${range(toTime(b.s), toTime(b.e))}</b>${rest ? ` · 残り${dur(rest)}` : ' · いっぱい'}` : '<b>予定を入れる</b>'}</span><span class="sheet-chev ${ui.sheet ? '' : 'up'}">${ic('chev', 18)}</span></button>
  <div class="seg">${[['slot', '予定を入れる'], ['cmt', 'コメント'], ['who', '目標・メモ']].map(([k, l]) => `<button data-act="side" data-v="${k}" class="${tab === k ? 'on' : ''}">${l}${k === 'cmt' && unread ? `<i class="cnt">${unread}</i>` : ''}</button>`).join('')}</div>
  ${tab === 'cmt' ? sideComments(sid) : tab === 'who' ? sideWho(sid) : sideSlot(sid, blocks)}`;
}
const taskKindLabel = t => t.vague ? '時間だけ' : isMissed(t) ? 'やり残し' : t.retest ? '再テスト' : '初回';
/* 「入れる」タブ：選んだ時間 → 入っているもの → 残りの時間に入れる（参考書の次の範囲／時間だけ取る／おすすめ／目次から） */
function sideSlot(sid, blocks) {
  const b = ui.blk;
  if (!b) return `<div class="side-body"><div class="slot-empty"><p><b>この週は勉強できる時間がありません</b></p><p class="muted">「勉強できる時間を直す」で時間を足すか、カレンダーをなぞって予定を入れられます。</p></div></div>`;
  const i = blocks.findIndex(x => blkKey(x) === blkKey(b)), len = b.e - b.s, ts = blockTasks(sid, b), gaps = blockGaps(sid, b), freeMin = gaps.reduce((a, [s, e]) => a + e - s, 0);
  const mt = meetingOn(sid, b.date), mtIn = mt && toMin(mt.time) < b.e && toMin(mt.time) + mt.len > b.s ? mt : null;
  const g0 = gaps[0], rec = g0 ? recommendPreview(sid, b) : [];
  // 帯：入っているもの・面談・空き を時刻の順に
  const segs = [...ts.map(t => ({ s: toMin(t.time), d: t.duration, c: t.vague ? 'vague' : mat(t.material).kind })), ...(mtIn ? [{ s: toMin(mtIn.time), d: mtIn.len, c: 'meet' }] : []), ...gaps.map(([s, e]) => ({ s, d: e - s, c: 'rest' }))].sort((x, y) => x.s - y.s);
  const row = t => { const m = mat(t.material), p = pdfOf(t);
    return `<li class="pl ${t.vague ? 'vague' : m.kind} ${ui.flashTask === t.id ? 'flash' : ''}" data-hover="task:${t.id}">
      <span class="pl-time num">${t.time}</span>
      <button class="pl-t" data-act="blk-edit" data-id="${t.id}" title="押すと直せます"><span>${esc(t.title || `${m.short} ${node(t.node).label}`)}</span>${p ? '<i class="ev-q" title="小テスト付き"></i>' : ''}</button>
      <button class="icon-btn pl-x" data-act="blk-del" data-id="${t.id}" aria-label="外す" title="外す（後ろは詰めます）">${ic('close', 16)}</button>
      <p class="pl-why">${t.vague ? '時間だけ' : `<span class="${isMissed(t) ? 'red-t' : ''}">${taskKindLabel(t)}</span>`}${pdfMissing(t) ? ' · <span class="amber-t">小テストなし</span>' : ''}</p>
      <div class="pl-dur"><button data-act="blk-dur" data-id="${t.id}" data-v="-5" aria-label="5分短く" ${t.duration <= 10 ? 'disabled' : ''}>−</button><b class="num">${dur(t.duration)}</b><button data-act="blk-dur" data-id="${t.id}" data-v="5" aria-label="5分長く" ${freeMin < 5 ? 'disabled' : ''}>＋</button></div></li>`; };
  return `<div class="side-body">
    <div class="slot-h"><button class="icon-btn" data-act="blk-nav" data-v="-1" ${i > 0 ? '' : 'disabled'} aria-label="前の時間">${ic('left', 18)}</button>
      <div><p class="slot-when">${mdw(b.date)} ${range(toTime(b.s), toTime(b.e))}</p><p class="muted">${dur(len)}${b.label ? ` · ${esc(b.label)}` : ''} · ${freeMin ? `<b class="rest-t">残り${dur(freeMin)}</b>` : 'いっぱい'}</p></div>
      <button class="icon-btn" data-act="blk-nav" data-v="1" ${i < blocks.length - 1 ? '' : 'disabled'} aria-label="次の時間">${ic('right', 18)}</button></div>
    ${ts.length || mtIn ? `<div class="fill-bar" aria-hidden="true">${segs.map(x => `<i class="${x.c}" style="flex:${x.d}"></i>`).join('')}</div>
      <ol class="pl-list">${[...ts.map(t => [toMin(t.time), row(t)]), ...(mtIn ? [[toMin(mtIn.time), `<li class="pl meet"><span class="pl-time num">${mtIn.time}</span><p class="pl-t"><span>面談（佐々木）</span></p><p class="pl-why">予約済み</p><div class="pl-dur"><b class="num">${dur(mtIn.len)}</b></div></li>`]] : [])].sort((x, y) => x[0] - y[0]).map(x => x[1]).join('')}</ol>` : ''}
    ${g0 ? `<p class="tray-h">残り${dur(freeMin)}に入れる</p>
    ${freeEntryHtml(sid, b, g0)}
    <details class="more-src" ${ui.open.rec ? 'open' : ''} data-open="rec"><summary>おすすめから入れる${rec.length ? `<span class="muted">${rec.length}件</span>` : ''}</summary>
      <div class="rec-box">${rec.length ? `<ul class="rec-pv-list">${rec.map(x => `<li><b>${esc(x.m.short)} ${esc(node(x.node).label)}</b><span class="muted">${x.badge} · ${esc(x.reason)}</span></li>`).join('')}</ul><button class="btn" data-act="blk-rec">この${rec.length}件を入れる</button>` : '<p class="muted">再テスト・やり残し・次の範囲のどれも、この時間には入りません</p>'}</div></details>`
    : `<div class="slot-full"><p>この時間はいっぱいです</p>${i < blocks.length - 1 ? `<button class="btn sm" data-act="blk-nav" data-v="1">次の時間へ</button>` : ''}</div>`}
  </div>`;
}
/* 目次の1行（参考書の範囲）。押すと act を実行（空きに入れる／時間を選んで追加） */
function rangeRow(sid, n, nextId, reviews, act = 'range-add') {
  const ts = tasksOf(sid).filter(t => t.node === n.id).sort(byTime), done = ts.filter(t => t.status === 'done'), plan = ts.find(t => t.status !== 'done');
  const sc = done.filter(t => t.score != null).at(-1), rv = reviews.find(r => r.node === n.id), vs = pdfsOf(n.id), free = freePdf(sid, n.id);
  const icon = plan ? '<i class="ri plan"></i>' : done.length ? `<i class="ri done ${sc ? level(pct(sc.score, sc.max)) : ''}">✓</i>` : '<i class="ri"></i>';
  const st = plan ? `${md(plan.date)} 予定` : rv ? `<span class="${rv.due <= DAY ? 'amber-t' : ''}">再テスト ${rv.due <= DAY ? '時期' : md(rv.due) + '頃'}</span>` : sc ? `${pct(sc.score, sc.max)}%` : done.length ? '済' : n.id === nextId ? '<b class="next-t">次はここ</b>' : '';
  const q = vs.length ? (free || plan?.pdf ? '<span class="qt" title="小テストあり（未使用の版が自動で付く）">小テスト</span>' : '<span class="qt none" title="この生徒が使っていない版がありません">小テストなし</span>') : '';
  return `<div class="rr ${n.id === nextId ? 'next' : ''}" role="button" tabindex="0" draggable="true" data-drag="node:${n.id}" data-act="${act}" data-id="${n.id}" data-hover="node:${n.id}">
    ${icon}<span class="rl">${esc(n.label)}</span><span class="rst">${st}</span>${q}<span class="radd" aria-hidden="true">${ic('plus', 14)}</span></div>`;
}
/* 週の空きを全部おすすめで埋める（あとで1回で取り消せる）。空きごとに、長さにぴったりの組み合わせを入れる */
function fillAll(sid) {
  const start = dateAdd(weekStart(DAY), ui.week * 7), s0 = snapshot(); let n = 0;
  for (const b of weekBlocks(sid, start)) n += recommendFill(sid, b).length;
  commit(n ? `空きに${n}件入れました（空きの長さに合わせ、小テストも自動で付けています）` : '入れられるおすすめがありませんでした', n ? s0 : null);
}
/* 範囲を押したときの初期の時間：表示中の週（今日より後）で最初に空いている所 */
function firstFreeSlot(sid, len) {
  const start = dateAdd(weekStart(DAY), ui.week * 7), from = start > DAY ? start : dateAdd(DAY, 1);
  for (let i = 0; i < 21; i++) { const d = dateAdd(from, i), g = freeGaps(sid, d, {}).find(([s, e]) => e - s >= len); if (g) return { date: d, time: toTime(Math.ceil(g[0] / 5) * 5) }; }
  return { date: from, time: '19:00' };
}
/* ---------- 予定を追加・直す（どの教材・どの範囲でも、教材なしでも入れられる） ---------- */
function openPlanDialog(o) {
  const sid = o.sid || ui.planStudent, t = o.taskId && state.tasks.find(x => x.id === o.taskId);
  const pf = ui.pf = t ? { sid, taskId: t.id, date: t.date, time: t.time, dur: t.duration, durTouched: true, mid: t.material, nid: t.node, title: t.title || '', quiz: !t.noQuiz }
    : { sid, date: o.date || dateAdd(DAY, 1), time: o.time || '19:00', dur: o.dur || null, durTouched: !!o.dur, mid: o.mid || (o.nid ? node(o.nid).m.id : booksOf(sid)[0]?.material || 'free'), nid: o.nid || null, title: o.title || '', quiz: true };
  if (pf.mid !== 'free' && !pf.nid) pf.nid = defaultNode(sid, pf.mid);
  if (!pf.dur) pf.dur = pf.mid === 'free' ? 60 : typicalDur(sid, pf.mid);
  openDialog(planDialogHtml(), false);
  dlg().classList.add('wide');
}
const defaultNode = (sid, mid) => { const m = mat(mid); return (m.nodes.find(n => !state.tasks.some(t => t.student === sid && t.node === n.id)) || m.nodes[0])?.id || null; };
function planDialogHtml() {
  const pf = ui.pf, sid = pf.sid, books = booksOf(sid).map(b => mat(b.material)), others = visibleMats().filter(m => !books.includes(m));
  const m = mat(pf.mid), free = pf.mid === 'free', reviews = reviewQueue(sid), t = pf.taskId && state.tasks.find(x => x.id === pf.taskId);
  const chip = (id, label) => `<button type="button" class="chip ${pf.mid === id ? 'on' : ''}" data-act="pf-mat" data-v="${id}">${label}</button>`;
  const nodeOpt = n => {
    const ts = tasksOf(sid).filter(x => x.node === n.id && x.id !== pf.taskId), done = ts.filter(x => x.status === 'done'), plan = ts.find(x => x.status !== 'done');
    const sc = done.filter(x => x.score != null).at(-1), rv = reviews.find(r => r.node === n.id);
    const tag = plan ? `（${md(plan.date)}に予定あり）` : rv ? `（再テストの時期${rv.due <= DAY ? '' : '：' + md(rv.due) + '頃'}）` : sc ? `（前回${pct(sc.score, sc.max)}%）` : done.length ? '（済）' : '';
    return `<option value="${n.id}" ${pf.nid === n.id ? 'selected' : ''}>${done.length ? '✓ ' : plan ? '● ' : '　'}${esc(n.label)}${tag}</option>`;
  };
  let quiz = '';
  if (!free && pf.nid) {
    const vs = pdfsOf(pf.nid), cur = t?.node === pf.nid && t.pdf ? pdfOf(t) : null, f = cur || freePdf(sid, pf.nid, pf.taskId);
    quiz = !vs.length ? `<p class="pf-q none">${ic('file', 15)} この範囲の小テストはまだありません（小テスト画面で登録すると、この予定に自動で付きます）</p>`
      : f ? `<label class="pf-q"><input type="checkbox" id="pf-quiz" ${pf.quiz ? 'checked' : ''}> ${ic('file', 15)} 小テスト 第${f.version}版（${f.max}点）を付ける <span class="d-m">${esc(first(person(sid).name))}さんはまだ使っていない版</span></label>`
      : `<p class="pf-q warn">${ic('alert', 15)} 小テストは全部の版を使いました。小テスト画面で新しい版を追加すると、この予定に自動で付きます</p>`;
  }
  const doneInfo = !free && pf.nid ? tasksOf(sid).filter(x => x.node === pf.nid && x.status === 'done' && x.id !== pf.taskId).length : 0;
  const next = !free && pf.nid ? m.nodes[node(pf.nid).index + 1] : null;
  return `<form class="dl" id="plan-form"><div class="dl-h"><div><h2>${t ? '予定を直す' : '予定を追加'}</h2><p class="muted">${esc(person(sid).name)}</p></div>${closeBtn}</div>
    <div class="pf-row"><label>日付<input type="date" id="pf-date" value="${pf.date}"></label><label>開始<input type="time" id="pf-time" value="${pf.time}" step="300"></label>
      <div class="lbl">時間<div class="chips">${[15, 30, 45, 60, 90].map(x => `<button type="button" class="chip ${pf.dur === x ? 'on' : ''}" data-act="pf-dur" data-v="${x}">${x}分</button>`).join('')}<span class="pf-durw"><input type="number" id="pf-dur" value="${pf.dur}" min="5" step="5" class="pf-durin" aria-label="時間（分）">分</span></div></div></div>
    <div><div class="lbl">教材</div><div class="chips">${books.map(b => chip(b.id, esc(b.short))).join('')}${chip('free', '教材なし')}
      ${others.length ? `<select class="pf-other" data-pf="other"><option value="">ほかの教材…</option>${others.map(o => `<option value="${o.id}" ${pf.mid === o.id ? 'selected' : ''}>${esc(o.name)}</option>`).join('')}</select>` : ''}</div></div>
    ${free ? `<label>内容<input id="pf-title" value="${esc(pf.title)}" placeholder="例：学校の課題（英語）、模試の直し" autofocus></label>`
      : `<label>範囲 <span class="d-m">✓ 済　● 予定あり</span><select id="pf-node" data-pf="node" size="6">${m.nodes.map(nodeOpt).join('')}</select></label>
        ${doneInfo ? `<p class="d-m">この範囲は${doneInfo + 1}回目（再テストとして入れます）</p>` : ''}${quiz}`}
    <div class="dl-foot">${t ? `<button type="button" class="btn danger" data-act="task-del" data-id="${t.id}">削除</button>` : ''}<span class="grow"></span>
      ${!t && next ? `<button type="button" class="btn" data-act="pf-save-next">追加して次の範囲も</button>` : ''}<button class="btn primary">${t ? '保存' : '追加'}</button></div></form>`;
}
function pfRead() {
  const pf = ui.pf, g = id => document.querySelector(id);
  if (g('#pf-date')) pf.date = g('#pf-date').value || pf.date;
  if (g('#pf-time')) pf.time = g('#pf-time').value || pf.time;
  if (g('#pf-dur')) { const v = Math.max(5, Math.round(+g('#pf-dur').value / 5) * 5 || pf.dur); if (v !== pf.dur) { pf.dur = v; pf.durTouched = true; } }
  if (g('#pf-title')) pf.title = g('#pf-title').value;
  if (g('#pf-quiz')) pf.quiz = g('#pf-quiz').checked;
}
function pfRefresh() { pfRead(); dlg().innerHTML = planDialogHtml(); }
function savePlanForm(andNext) {
  pfRead();
  const pf = ui.pf, sid = pf.sid, free = pf.mid === 'free';
  if (free && !pf.title.trim()) return toast('内容を入れてください');
  if (!free && !pf.nid) return toast('範囲を選んでください');
  const s0 = snapshot();
  let t = pf.taskId && state.tasks.find(x => x.id === pf.taskId), isNew = !t;
  if (!t) t = { id: uid(), student: sid, status: 'todo' };
  const nodeChanged = t.node !== (free ? t.node : pf.nid);
  Object.assign(t, { date: pf.date, time: pf.time, duration: pf.dur, material: pf.mid });
  if (free) {
    if (!String(t.node || '').startsWith('free:')) t.node = 'free:' + uid();
    Object.assign(t, { title: pf.title.trim(), pdf: null, noQuiz: true, retest: false }); delete t.max;
  } else {
    t.node = pf.nid; delete t.title;
    t.retest = state.tasks.some(o => o.id !== t.id && o.student === sid && o.node === pf.nid && o.status === 'done');
    if (!pf.quiz) { t.pdf = null; t.noQuiz = true; }
    else { t.noQuiz = false; if (nodeChanged || !t.pdf) { const p = freePdf(sid, pf.nid, t.id); t.pdf = p?.id || null; if (p) t.max = p.max; } }
  }
  if (isNew) state.tasks.push(t);
  closeDialog();
  const p = pdfOf(t);
  commit(`${mdw(t.date)} ${t.time} ${free ? t.title : mat(t.material).short + ' ' + node(t.node).label}${p ? ` · 小テスト第${p.version}版を付けました` : pdfMissing(t) ? ' · 使える小テストがありません' : ''}`, s0);
  if (andNext && !free) {
    const m = mat(pf.mid), next = m.nodes[node(pf.nid).index + 1];
    if (next) openPlanDialog({ sid, date: pf.date, time: toTime(toMin(pf.time) + pf.dur + 5), mid: pf.mid, nid: next.id });
  }
}
/* コメント：教材ごとにたたむ。返信欄は「返信」を押したときだけ */
function sideComments(sid) {
  const groups = booksOf(sid).map(b => mat(b.material)).filter(m => commentsOf(sid, m.id).length);
  if (!groups.length) return '<div class="side-body"><p class="empty">コメントはまだありません</p></div>';
  return `<div class="side-body">${groups.map(m => { const cs = commentsOf(sid, m.id), unread = cs.filter(t => !t.reply).length;
    const top = TAGS.map(t => [t, cs.filter(x => x.comment.tag === t).length]).sort((a, b) => b[1] - a[1])[0];
    return `<details class="cg" data-cg="${m.id}" ${ui.cmtOpen.has(m.id) ? 'open' : ''}><summary><span class="d-t">${esc(m.short)}</span><span class="d-m">${cs.length}件 · 「${top[0]}」が多い</span>${unread ? `<i class="cnt">${unread}</i>` : ''}</summary>
      ${cs.slice(0, 12).map(t => `<div class="cmt"><p class="d-m">${md(t.date)} · ${esc(node(t.node).label)}${t.score != null ? ` · ${t.score}/${t.max}` : ''}</p>
        <p class="c-text">${tagHtml(t.comment.tag)}${esc(t.comment.text)}</p>
        ${t.reply ? `<p class="d-m">↳ ${esc(t.reply.text)}</p>` : ui.replyOpen === t.id ? `<form class="reply-in" data-reply="${t.id}"><input placeholder="返信（生徒の記録に出ます）" autofocus><button class="btn sm primary">送る</button></form>` : `<button class="link sm" data-act="reply-open" data-id="${t.id}">返信</button>`}</div>`).join('')}
    </details>`; }).join('')}</div>`;
}
function sideWho(sid) {
  const p = person(sid), c = state.coach[sid] ||= { message: '', memo: '' };
  const unused = visibleMats().filter(m => !book(sid, m.id));
  return `<form class="side-body form" id="who-form" data-id="${sid}">
    <div><p class="lead">${esc(p.name)} <span class="muted">${esc(p.grade)}</span></p>
    <p class="sub">${esc(p.goal.school)} ${esc(p.goal.faculty)} · 入試 ${md(p.goal.date)}（あと${daysBetween(DAY, p.goal.date)}日）</p></div>
    <div class="section-t">参考書と「いつまでに1周」</div>
    ${booksOf(sid).map(b => `<div class="book-row">${subjDot(mat(b.material))}<span>${esc(mat(b.material).short)}</span><input type="date" data-book="${b.material}" value="${b.target}"><button type="button" class="icon-btn" data-act="book-del" data-id="${b.material}" aria-label="外す">${ic('close', 14)}</button></div>`).join('')}
    ${unused.length ? `<div class="book-row"><select id="book-add">${unused.map(m => `<option value="${m.id}">${esc(m.name)}</option>`).join('')}</select><button type="button" class="btn sm" data-act="book-add">追加</button></div>` : ''}
    <div><div class="section-t">面談</div>${(() => { const nx = nextMeeting(sid);
      return nx ? `<p>次回 ${meetLabel(nx)}</p>` : '<p class="amber-t">この先の予約がありません</p>'; })()}<button type="button" class="link" data-go="meet">面談のカレンダーへ</button></div>
    <label><div class="section-t">生徒へのメッセージ（ホームに出ます）</div><textarea id="who-msg">${esc(c.message)}</textarea></label>
    <label><div class="section-t">講師メモ（生徒には見えません）</div><textarea id="who-memo" class="short">${esc(c.memo)}</textarea></label>
    <button class="btn primary">保存</button>
  </form>`;
}
function taskPop(t) {
  if (t.status !== 'done') return openPlanDialog({ taskId: t.id });
  const m = mat(t.material), n = node(t.node), next = m.nodes[n.index + 1], p = pdfOf(t), done = t.status === 'done';
  openDialog(`<div class="dl"><div class="dl-h"><div><h2>${esc(m.name)}</h2><p class="muted">${esc(n.label)}${t.retest ? ' · 再テスト' : ''} · ${esc(person(t.student).name)}</p></div>${closeBtn}</div>
    ${done ? `<p>完了 · ${dur(t.actual || t.duration)}${t.score != null ? ` · ${t.score}/${t.max}点` : ''}</p>
      ${t.comment ? `<p class="note">${tagHtml(t.comment.tag)}${esc(t.comment.text)}</p>` : '<p class="muted">ひとことはありません</p>'}
      ${t.comment ? (t.reply ? `<p class="muted">↳ ${esc(t.reply.text)}</p>` : `<form class="reply-in" data-reply="${t.id}"><input placeholder="返信（生徒の記録に出ます）"><button class="btn sm">返信</button></form>`) : ''}` : `
    <div class="time-row"><label>日付<input type="date" id="pop-date" value="${t.date}"></label><label>開始<input type="time" id="pop-time" value="${t.time}" step="300"></label></div>
    <div class="inline-row"><span class="sub">長さ</span><button class="btn sm" data-act="pop-dur" data-v="-5">−5</button><strong class="num" id="pop-dur">${t.duration}分</strong><button class="btn sm" data-act="pop-dur" data-v="5">＋5</button><span class="muted">いつもは約${typicalDur(t.student, m.id)}分</span></div>
    <p class="sub">小テスト：${p ? `第${p.version}版（${p.max}点）· この生徒は初めて` : needsPdf(t.node) ? `<span class="amber-t">この生徒が使っていない版がありません</span> <button class="link" data-act="to-prints" data-id="${t.node}">小テストを追加</button>` : 'なし'}</p>
    ${inAvail(t) ? '' : '<p class="amber-t">勉強できる時間の外です</p>'}`}
    <div class="dl-foot">${done ? '' : `<button class="btn danger" data-act="task-del" data-id="${t.id}">削除</button>`}${next && !done ? `<button class="btn" data-act="task-next" data-id="${t.id}">${ic('next')}次の「${esc(next.label)}」を置く</button>` : ''}${done ? '<button class="btn primary" data-act="close">閉じる</button>' : `<button class="btn primary" data-act="pop-save" data-id="${t.id}">保存</button>`}</div></div>`);
}
function suggSheet(s) {
  const n = node(s.node), p = s.kind === 'move' ? pdfOf(s.task) : freePdf(ui.planStudent, s.node), cm = commentsOf(ui.planStudent, n.m.id).slice(0, 3);
  openDialog(`<div class="dl"><div class="dl-h"><div><p class="muted">自動の案</p><h2>${esc(n.m.name)}</h2><p class="muted">${esc(n.label)} · ${mdw(s.date)} ${s.time}〜 ${dur(s.dur)}</p></div>${closeBtn}</div>
    <p class="sub">${esc(s.why)}<br>小テスト：${p ? `第${p.version}版（この生徒は初めて）` : needsPdf(s.node) ? '<span class="amber-t">この生徒が使っていない版がありません</span>' : 'なし'}</p>
    ${cm.length ? `<div><div class="section-t">${esc(first(person(ui.planStudent).name))}さんのコメント（${esc(n.m.short)}）</div>${cm.map(x => `<div class="cmt"><span class="muted">${md(x.date)} ${esc(node(x.node).label)}</span><div>${tagHtml(x.comment.tag)}${esc(x.comment.text)}</div></div>`).join('')}</div>` : ''}
    <div class="dl-foot"><button class="btn ghost" data-act="sg-no" data-key="${s.key}">この案を消す</button><button class="btn primary" data-act="sg-ok" data-key="${s.key}">${ic('check')}この時間に置く</button></div></div>`);
}
/* 「次の範囲」は、この予定のあとの最初の空き時間へ */
function placeNext(t) {
  const m = mat(t.material), next = m.nodes[node(t.node).index + 1], len = typicalDur(t.student, m.id);
  for (let i = 0; i < 14; i++) {
    const d = dateAdd(t.date, i); if (d <= DAY) continue;
    const g = freeGaps(t.student, d, {}).find(([s, e]) => e - s >= len && (i > 0 || s >= toMin(t.time) + t.duration));
    if (g) { ui.planStudent = t.student; place('node', next.id, d, toTime(Math.ceil(g[0] / 5) * 5)); return; }
  }
  toast('2週間以内に空き時間がありません。カレンダーにドラッグして置いてください');
}

/* ---------- 面談：講師のカレンダーを公開し、生徒が毎週1回を予約する ----------
   講師は「面談できる時間」をなぞって塗る（毎週）。公開すると、生徒の「予定」に予約の欄が出る。
   生徒は1度選べば毎週自動で入る（その週だけ休むこともできる）。未予約の生徒は講師がまとめて自動で入れることもできる */
const BOOKING_URL = 'https://actify.example/book/sasaki';
function tMeet() {
  const start = dateAdd(weekStart(DAY), ui.week * 7), len = state.booking.len, pub = state.booking.published, end = dateAdd(start, 6);
  const rows = students().map(p => { const m = meetingInWeek(p.id, start), slots = meetingSlots(p.id, start); return { p, m, slots, best: slots.find(x => x.same) || slots.find(x => x.fit) || slots[0] }; });
  const none = rows.filter(r => !r.m && r.best), openMin = weekDays(start).reduce((a, d) => a + coachOpenOn(d).reduce((x, o) => x + toMin(o.end) - toMin(o.start), 0), 0);
  const noOpen = start >= weekStart(DAY) && !coachOpenRegistered(start), hadLast = coachOpenRegistered(dateAdd(start, -7));
  return `<div class="head"><h1>面談</h1>${weekNav(start)}</div>
  <section class="card meet-top">
    <div class="mt-pub"><label class="toggle"><input type="checkbox" data-act="meet-publish" ${pub ? 'checked' : ''}><span class="tg" aria-hidden="true"></span><span><b>予約の受付</b><small>${pub ? '受付中：生徒の「予定」から予約できます' : '停止中：生徒からは予約できません'}</small></span></label></div>
    <div class="mt-tools">
      <div class="mt-len"><span class="muted">1回の長さ</span><div class="seg inline">${[20, 30, 45, 60].map(x => `<button class="${len === x ? 'on' : ''}" data-act="meet-len" data-v="${x}">${x}分</button>`).join('')}</div></div>
      ${pub ? `<button class="btn sm" data-act="meet-copy">${ic('link', 16)}予約リンクをコピー</button>` : ''}
      <button class="btn sm" data-act="meet-ics" title="Googleカレンダーなどに取り込めるファイル（.ics）を作ります">${ic('download', 16)}カレンダーに書き出す</button>
    </div>
  </section>
  ${noOpen ? `<div class="notice"><div><b>${range(md(start), md(end))}の面談できる時間が、まだありません</b><p>カレンダーをなぞって塗ってください。塗った時間から生徒が予約します。</p></div>${hadLast ? '<button class="btn sm primary" data-act="co-copy">先週と同じにする</button>' : ''}</div>` : ''}
  <div class="plan meet-layout">
    ${coachCal(start)}
    <aside class="card side"><div class="side-body">
      <div class="ch"><h2>${range(md(start), md(end))}の予約</h2><span class="muted">面談できる時間 ${hours(openMin)}</span></div>
      <ul class="mt-list">${rows.map(({ p, m, best }) => `<li class="mt-row ${m ? '' : 'none'}"><span class="avatar">${esc(first(p.name)[0])}</span>
        <div class="body"><b>${esc(p.name)}</b><p class="${m ? 'muted' : 'amber-t'}">${m ? meetLabel(m) + (m.date < DAY ? ' · 済み' : '') : best ? '未予約' : start < weekStart(DAY) ? '面談なし' : openMin ? '空いている時間がもうありません' : '面談できる時間がまだありません'}</p>${!m && best?.same ? `<p class="muted">先週は${WD[dow(best.date)]}\u00a0${best.time}</p>` : ''}</div>
        ${m && m.date < DAY ? '' : m ? `<button class="btn sm ghost" data-act="meet-open" data-sid="${p.id}" data-date="${m.date}">変更</button>` : best ? `<button class="btn sm" data-act="meet-book" data-sid="${p.id}" data-date="${best.date}" data-t="${best.time}" title="${best.same ? '先週と同じ時間' : best.fit ? '生徒の勉強できる時間と重なる、空いている時間' : '空いている時間'}">${WD[dow(best.date)]}\u00a0${best.time}で入れる</button>` : ''}</li>`).join('')}</ul>
      ${none.length > 1 ? `<div class="pad2"><button class="btn primary full" data-act="meet-auto" title="先週と同じ時間、生徒の勉強できる時間と重なる所、週末の順に選びます。生徒はあとから変えられます">未予約の${none.length}人をまとめて入れる</button></div>` : ''}
    </div></aside>
  </div>`;
}
function coachCal(start) {
  const days = weekDays(start);
  return `<div class="cal-wrap card" data-cal="coach:${start}"><div class="cal" data-mode="coach" style="--px:${PX}px">
    <div class="cal-h corner"></div>
    ${days.map(d => dayHead(d)).join('')}
    ${rulerHtml()}
    ${days.map(d => `<div class="col ${d === DAY ? 'today' : ''} ${d < DAY ? 'past' : ''}" data-date="${d}" style="height:${(H1 - H0) * PX}px">
      ${coachOpenOn(d).map(o => `<div class="av co" role="button" tabindex="0" data-act="co-open" data-id="${o.id}" data-date="${d}" title="面談できる時間 ${range(o.start, o.end)}" style="top:${yOf(o.start)}px;height:${yOf(o.end) - yOf(o.start)}px"><span class="av-t">${range(o.start, o.end)}</span><span class="rs rs-top" data-resize="co:${o.id}"></span><span class="rs" data-resize="co:${o.id}"></span></div>`).join('')}
      ${state.meetings.filter(m => m.date === d).map(m => `<div class="mt" role="button" tabindex="0" data-act="meet-open" data-sid="${m.student}" data-date="${d}" title="${esc(person(m.student).name)} ${meetLabel(m)}" style="top:${yOf(m.time)}px;height:${Math.max(18, m.len / 60 * PX - 2)}px"><span>${m.time} ${esc(first(person(m.student).name))}</span></div>`).join('')}
    </div>`).join('')}
  </div></div>`;
}
function addCoachOpen(date, start, end) {
  const same = state.coachOpen.filter(o => !o.repeat && o.date === date && o.start <= end && o.end >= start), s0 = snapshot();
  let s = start, e = end; same.forEach(o => { if (o.start < s) s = o.start; if (o.end > e) e = o.end; });
  state.coachOpen = state.coachOpen.filter(o => !same.includes(o));
  state.coachOpen.push({ id: uid(), date, start: s, end: e });
  commit(`${mdw(date)} ${range(s, e)} を面談できる時間にしました`, s0);
}
function coachOpenDialog(id, date) {
  const o = state.coachOpen.find(x => x.id === id); if (!o) return;
  const booked = state.meetings.filter(m => m.date === date && m.time >= o.start && m.time < o.end);
  openDialog(`<div class="dl"><div class="dl-h"><div><h2>面談できる時間</h2><p class="muted">${o.repeat ? `毎週${WD[o.weekday]}曜` : mdw(o.date)} ${range(o.start, o.end)}</p></div>${closeBtn}</div>
    ${booked.length ? `<p class="sub">この時間の予約：${booked.map(m => esc(person(m.student).name) + ' ' + m.time).join('、')}（消しても予約はそのまま）</p>` : '<p class="sub">この時間の予約はまだありません</p>'}
    <p class="muted">カレンダーで端をつかむと、長さを変えられます。</p>
    <div class="dl-foot"><button class="btn danger" data-act="co-del" data-id="${id}">この時間を消す</button><span class="grow"></span><button class="btn primary" data-act="close">閉じる</button></div></div>`);
}
/* .ics（Googleカレンダー・iPhoneのカレンダーに取り込める形式）。毎週くり返しと、休みの週を入れる */
function icsText(sid) {
  const ymd = d => d.replace(/-/g, ''), hm = t => t.replace(':', '') + '00';
  const L = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Actify//mock//JA', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${sid ? 'Actify 面談' : 'Actify 面談（佐々木）'}`,
    'BEGIN:VTIMEZONE', 'TZID:Asia/Tokyo', 'BEGIN:STANDARD', 'DTSTART:19700101T000000', 'TZOFFSETFROM:+0900', 'TZOFFSETTO:+0900', 'TZNAME:JST', 'END:STANDARD', 'END:VTIMEZONE'];
  state.meetings.filter(m => !sid || m.student === sid).forEach(m => {
    L.push('BEGIN:VEVENT', `UID:${m.id}@actify.example`, 'DTSTAMP:20261002T000000Z', `DTSTART;TZID=Asia/Tokyo:${ymd(m.date)}T${hm(m.time)}`, `DTEND;TZID=Asia/Tokyo:${ymd(m.date)}T${hm(toTime(toMin(m.time) + m.len))}`,
      `SUMMARY:${sid ? '面談（佐々木先生）' : '面談：' + person(m.student).name}`, 'END:VEVENT');
  });
  L.push('END:VCALENDAR'); return L.join('\r\n');
}
function downloadIcs(sid) {
  const txt = icsText(sid), n = state.meetings.filter(m => !sid || m.student === sid).length;
  openDialog(`<div class="dl"><div class="dl-h"><div><h2>カレンダーに書き出す</h2><p class="muted">面談${n}件。GoogleカレンダーやiPhoneのカレンダーに取り込めます</p></div>${closeBtn}</div>
    <textarea id="ics-text" class="ics-text" readonly aria-label="カレンダーのファイルの中身（.ics）">${esc(txt)}</textarea>
    <p class="muted">${IN_FRAME ? 'コピーしてメモ帳などに貼り、名前を「面談.ics」にして保存すると取り込めます。' : '「ファイルで保存」が動かないときは、コピーしてメモ帳に貼り、名前を「面談.ics」にして保存してください。'}</p>
    <div class="dl-foot"><button class="btn ${IN_FRAME ? 'primary' : ''}" data-act="ics-copy">${ic('link', 16)}コピー</button>${IN_FRAME ? '' : `<button class="btn primary" data-act="ics-file" data-sid="${sid || ''}">${ic('download', 16)}ファイルで保存</button>`}</div></div>`);
}
/* 共有リンク（URL）で開いたときは枠の中なので、ファイル保存は使えない。コピーだけにする */
const IN_FRAME = (() => { try { return window.self !== window.top; } catch { return true; } })();
function saveIcsFile(sid) {
  if (IN_FRAME) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([icsText(sid)], { type: 'text/calendar;charset=utf-8' })); a.download = sid ? 'actify-面談.ics' : 'actify-面談-佐々木.ics';
  document.body.appendChild(a); a.click(); a.remove();
  toast('カレンダーのファイルを保存しました。開くとGoogleやiPhoneのカレンダーに入ります');
}

/* ---------- 小テスト ---------- */
function tPrints() {
  const tab = ui.printTab;
  return `<div class="head"><h1>小テスト</h1>
    <div class="seg inline">${[['pdf', '問題・解答のPDF'], ['res', '配る資料']].map(([k, l]) => `<button data-act="print-tab" data-v="${k}" class="${tab === k ? 'on' : ''}">${l}</button>`).join('')}</div></div>
  ${tab === 'pdf' ? pdfUploader() + pdfStage() + pdfUsage() : resourcesPanel()}`;
}
function pdfUploader() {
  return `<section class="card upl"><label class="dropzone" data-dropzone="pdf">
      <span class="dz-ic">${ic('upload', 24)}</span><strong>PDFをまとめてここに置く</strong><span class="muted">問題と解答が混ざっていても大丈夫です。ファイル名から教材と範囲を読み取ります。</span>
      <span class="btn primary">ファイルを選ぶ</span><input type="file" accept="application/pdf" multiple hidden data-files="pdf"></label>
    <div class="upl-side">
      <details class="plain"><summary>ファイル名の付け方</summary>
        <p class="sub"><code>ターゲット1900_201-300_問題.pdf</code><br><code>ターゲット1900_201-300_解答.pdf</code><br><code>古文_助動詞1_問題.pdf</code></p>
        <p class="muted">教材名の一部・範囲の番号・「問題」か「解答」が入っていれば読み取れます。読めなかったファイルは、登録の前に選べます。</p></details>
      <button class="btn sm" data-act="pdf-sample">サンプルのファイルで試す</button></div></section>`;
}
function pdfStage() {
  if (!ui.stage.length) return '';
  const nextV = {}, rows = ui.stage.map(e => {
    const v = e.node ? (nextV[e.node] = (nextV[e.node] || (pdfsOf(e.node).at(-1)?.version || 0)) + 1) : null;
    return { e, v };
  });
  const bad = rows.filter(r => !r.e.node).length;
  return `<section class="card sec"><div class="ch"><h2>登録する前の確認</h2><span class="muted">${ui.stage.length}件 · ${bad ? `<span class="amber-t">${bad}件は範囲を選んでください</span>` : 'すべて読み取れました'}</span></div>
    <div class="scroll"><table class="stage"><thead><tr><th>ファイル</th><th>教材</th><th>範囲</th><th>版</th><th>満点</th><th></th></tr></thead><tbody>
    ${rows.map(({ e, v }, i) => `<tr class="${e.node ? '' : 'need'}"><td><div class="fname">${ic('file', 16)}${esc(e.problem?.name || '—')}<span class="muted">問題</span></div>${e.answer ? `<div class="fname">${ic('file', 16)}${esc(e.answer.name)}<span class="muted">解答</span></div>` : '<div class="muted">解答なし（問題に解答が付いている扱い）</div>'}</td>
      <td><select data-stage="${i}" data-f="material"><option value="">選ぶ</option>${visibleMats().map(m => `<option value="${m.id}" ${e.material === m.id ? 'selected' : ''}>${esc(m.name)}</option>`).join('')}</select></td>
      <td><select data-stage="${i}" data-f="node" ${e.material ? '' : 'disabled'}><option value="">選ぶ</option>${e.material ? mat(e.material).nodes.map(n => `<option value="${n.id}" ${e.node === n.id ? 'selected' : ''}>${esc(n.label)}</option>`).join('') : ''}</select>${e.node && !e.sure ? '<div class="amber-t">番号から推測しました</div>' : ''}</td>
      <td class="num">${v ? `第${v}版` : '—'}</td>
      <td><input type="number" class="w-num" min="1" max="200" value="${e.max}" data-stage="${i}" data-f="max"></td>
      <td><button class="icon-btn" data-act="stage-del" data-i="${i}" aria-label="外す">${ic('close', 16)}</button></td></tr>`).join('')}
    </tbody></table></div>
    <div class="dl-foot pad2"><button class="btn ghost" data-act="stage-clear">やめる</button><button class="btn primary" data-act="stage-save" ${bad ? 'disabled' : ''}>${ui.stage.length}件を登録</button></div></section>`;
}
function pdfUsage() {
  const m = mat(ui.printMat) || visibleMats()[0];
  const ss = students().filter(p => book(p.id, m.id) || tasksOf(p.id).some(t => t.material === m.id));
  const lack = students().flatMap(p => shortages(p.id));
  return `${lack.length ? `<section class="card sec lack"><div class="ch"><h2>小テストが足りません <span class="count">${lack.length}件</span></h2></div>
    <p class="cap">その生徒がまだ使っていない版がありません。上でPDFを登録すると、待っている予定にも自動で付きます。</p>
    <ul class="rows">${lack.map(x => `<li class="row"><div class="body"><h3>${esc(node(x.node).m.short)} ${esc(node(x.node).label)}</h3><p class="muted">${esc(person(x.sid).name)} · ${esc(x.why)}</p></div><button class="btn sm ghost" data-act="print-jump" data-id="${x.node}">表で見る</button></li>`).join('')}</ul></section>` : ''}
  <section class="card sec"><div class="ch"><h2>配った記録</h2><span class="muted">同じ生徒に同じ版は配りません</span></div>
    <div class="chips scroll-x pad-x">${visibleMats().map(x => `<button class="chip ${x.id === m.id ? 'on' : ''}" data-act="print-mat" data-v="${x.id}">${esc(x.short)}</button>`).join('')}</div>
    <p class="legend pad-x"><span class="um done">1✓</span>解いた<span class="um planned">2</span>予定に付いている<span class="um next">次3</span>次に配る版<span class="um none">なし</span>配れる版がない</p>
    <div class="scroll"><table class="usage"><thead><tr><th>範囲</th><th>登録</th>${ss.map(p => `<th>${esc(first(p.name))}</th>`).join('')}</tr></thead><tbody>
    ${m.nodes.map(n => { const vs = pdfsOf(n.id);
      return `<tr id="u-${n.id}" class="${ui.flashNode === n.id ? 'flash' : ''}"><th scope="row">${esc(n.label)}</th>
        <td class="num">${vs.length ? `<a class="plain-link" href="${esc(fileUrl(vs[0].problem))}" target="_blank" rel="noopener" title="第1版を開く">${vs.length}版</a>` : '<span class="muted">なし</span>'}</td>
        ${ss.map(p => { const marks = vs.map(v => [v, pdfUse(p.id, v.id)]).filter(x => x[1]), free = freePdf(p.id, n.id);
          return `<td><div class="uc">${marks.map(([v, u]) => `<span class="um ${u}">${v.version}${u === 'done' ? '✓' : ''}</span>`).join('')}${vs.length ? (free ? `<span class="um next">次${free.version}</span>` : '<span class="um none">なし</span>') : (needsPdf(n.id) && tasksOf(p.id).some(t => t.node === n.id) ? '<span class="um none">なし</span>' : '')}</div></td>`; }).join('')}</tr>`; }).join('')}
    </tbody></table></div></section>`;
}
function resourcesPanel() {
  return `<section class="card upl"><label class="dropzone" data-dropzone="res"><span class="dz-ic">${ic('upload', 24)}</span><strong>配る資料をここに置く</strong><span class="muted">置くとすぐ、生徒の「資料」に届きます</span><span class="btn">ファイルを選ぶ</span><input type="file" multiple hidden data-files="res"></label>
    <div class="upl-side"><label>配る相手<select id="res-target"><option value="all">全員</option>${students().map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></label></div></section>
    <section class="card sec"><div class="rows">${state.resources.slice().sort((a, b) => b.date.localeCompare(a.date)).map(d => `<div class="row"><span class="file-ic">${ic('file', 18)}</span><div class="body"><h3>${esc(d.name)}</h3><p class="muted">${md(d.date)} · ${d.target === 'all' ? '全員' : esc(person(d.target)?.name)}</p></div><a class="btn sm" href="${esc(fileUrl(d.url))}" target="_blank" rel="noopener">開く</a><button class="icon-btn" data-act="res-del" data-id="${d.id}" aria-label="取り下げる">${ic('trash', 16)}</button></div>`).join('')}</div></section>`;
}
/* ファイル名から振り分けて「登録前の確認」に並べる。同じ範囲の問題と解答は1つの版にまとめる */
function stagePdfs(files) {
  const list = files.filter(f => /pdf$/i.test(f.type || '') || /\.pdf$/i.test(f.name));
  if (!list.length) return toast('PDFを入れてください');
  const groups = new Map(), loose = [];
  list.forEach(f => { const r = matchPdfName(f.name); const key = r.node ? r.node : null;
    if (!key) { loose.push({ problem: f, answer: null, material: r.material, node: null, sure: false }); return; }
    if (!groups.has(key)) groups.set(key, { r, problems: [], answers: [] });
    groups.get(key)[r.role === 'answer' ? 'answers' : 'problems'].push(f); });
  const out = [];
  groups.forEach(({ r, problems, answers }) => {
    const n = Math.max(problems.length, answers.length);
    for (let i = 0; i < n; i++) out.push({ problem: problems[i] || answers[i], answer: problems[i] ? answers[i] || null : null, material: r.material, node: r.node, sure: r.sure });
  });
  const maxOf = mid => state.pdfs.filter(p => node(p.node).m.id === mid).at(-1)?.max || 20;
  ui.stage.push(...[...out, ...loose].map(e => ({ ...e, max: e.material ? maxOf(e.material) : 20 })));
  render(); document.querySelector('.stage')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
}
async function saveStage() {
  const snap0 = snapshot(), nextV = {};
  for (const e of ui.stage) {
    const v = nextV[e.node] = (nextV[e.node] || (pdfsOf(e.node).at(-1)?.version || 0)) + 1;
    const problem = await storeFile(e.problem), answer = e.answer ? await storeFile(e.answer) : problem;
    state.pdfs.push({ id: uid(), node: e.node, version: v, max: +e.max || 20, problem, answer, name: e.problem.name });
  }
  const n = ui.stage.length, attached = autoAttach(); ui.stage = [];
  commit(`${n}件を登録しました${attached ? `。小テストが無かった予定 ${attached}件に自動で付けました` : ''}`, snap0);
}
async function addResources(files) {
  const target = document.querySelector('#res-target')?.value || 'all';
  for (const f of files) state.resources.push({ id: uid(), name: f.name.replace(/\.[^.]+$/, ''), date: DAY, target, url: await storeFile(f) });
  commit(`${files.length}件を配りました（${target === 'all' ? '全員' : person(target).name}）`);
}
/* 自由に書いた内容を、残りの時間の頭に入れる */
function putFreeEntry() {
  const sid = ui.planStudent, b = ui.blk, g0 = blockGaps(sid, b)[0]; if (!g0) return toast('この時間はいっぱいです');
  const d = Math.min(g0[1] - g0[0], +document.querySelector('#fe-dur').value || 30), s0 = snapshot();
  let t;
  if (ui.feMat) { // 教材と範囲を選んだ
    const nid = document.querySelector('#fe-node')?.value; if (!nid) return;
    const q = document.querySelector('#fe-quiz'), wantQ = q ? q.checked : true;
    const planned = tasksOf(sid).find(x => x.node === nid && x.status !== 'done');
    if (planned) { t = planned; t.date = b.date; t.time = toTime(g0[0]); t.duration = d; }
    else t = putTask(sid, b.date, g0[0], d, 'node', nid);
    if (!wantQ) { t.pdf = null; t.noQuiz = true; delete t.max; }
    ui.feNode = null; ui.feQuiz = true;
  } else {
    const pe = parseFreeEntry(sid, document.querySelector('#fe-text')?.value); if (!pe) return;
    if (pe.kind === 'vague') t = putVague(sid, b.date, g0[0], d, pe.v.k);
    else if (pe.kind === 'free') t = putVague(sid, b.date, g0[0], d, 'free', pe.title);
    else if (!pe.node) return toast(`${pe.m.short}は1周ぶん済み・予定済みです。教材を選んで範囲を指定してください`);
    else if (pe.planned) { t = pe.planned; t.date = b.date; t.time = toTime(g0[0]); t.duration = d; }
    else t = putTask(sid, b.date, g0[0], d, 'node', pe.node);
    ui.feText = ''; ui.feFocus = true;
  }
  const ch = seqNow().filter(c => c.t !== t);
  ui.feDur = 0; ui.flashTask = t.id;
  commit(`${t.time}〜 ${dur(t.duration)} ${t.title || `${mat(t.material).short} ${node(t.node).label}`}${t.title ? '' : quizNote(t)}${seqNote(ch)}`, s0);
}
