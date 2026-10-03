'use strict';
/* ---------- 生徒の画面 ---------- */

/* ホーム：今日やること（v2 の形のまま）＋参考書の進み */
function heroTask() {
  const today = tasksOf(ME).filter(t => t.date === DAY).sort(byTime);
  // 予備時間は「次の予定」にしない（ほかに残っていなければ出す）
  return today.find(t => t.startedAt && t.status !== 'done') || today.find(t => t.status !== 'done' && t.vague !== 'buffer') || today.find(t => t.status !== 'done');
}
function sHome() {
  const me = person(ME), today = tasksOf(ME).filter(t => t.date === DAY).sort(byTime);
  const hero = heroTask(), rest = today.filter(t => t !== hero), missed = tasksOf(ME).filter(isMissed).sort(byTime);
  const ws = weekStats(ME), c = state.coach[ME], doneN = today.filter(t => t.status === 'done').length;
  const noScore = today.filter(t => t.status === 'done' && t.pdf && t.score == null);
  const max = Math.max(60, ...ws.perDay), nx = nextMeeting(ME);
  return `
  <section class="home-top">
    <div class="greet"><h1>こんにちは、${esc(first(me.name))}さん</h1><p class="sub">${!today.length ? '今日は先生が入れた予定がありません' : doneN === today.length ? `今日の予定${today.length}件、ぜんぶ終わりました` : `今日の予定は${today.length}件、のこり${today.length - doneN}件です`}</p></div>
    <div class="stats">
      <div><span class="st-l">今日の勉強</span><b class="st-n num">${dur(ws.perDay[dow(DAY)])}</b><span class="st-c">${doneN}/${today.length}件 完了</span></div>
      <button type="button" data-act="profile" title="目標と入試の日を見る"><span class="st-l">${esc(me.goal.school)}まで</span><b class="st-n num">${daysBetween(DAY, me.goal.date)}日</b><span class="st-c">入試 ${md(me.goal.date)}</span></button>
    </div>
  </section>
  <div class="home-grid">
    <div class="stack">
      ${hero ? heroCard(hero) : today.length ? `<section class="card hero done"><h2>今日の予定はすべて終わりました</h2><p class="sub">おつかれさまでした。明日の予定は「予定」で見られます。</p></section>` : `<section class="card hero done"><h2>今日の予定はありません</h2><p class="sub">${missed.length ? 'やり残しがあれば、下から始められます。' : '明日からの予定は「予定」で見られます。'}</p></section>`}
      ${noScore.map(t => `<section class="card"><div class="rows"><div class="row"><div class="body"><h3>${esc(mat(t.material).name)}</h3><p class="muted">${esc(node(t.node).label)} · <span class="amber-t">点数がまだです</span></p></div><button class="btn sm primary" data-act="complete" data-id="${t.id}">点数を入れる</button></div></div></section>`).join('')}
      <section class="card"><div class="ch"><h2>今日のほかの予定</h2><button class="link" data-go="schedule">予定を見る</button></div>
        <div class="rows">${rest.map(t => taskRow(t)).join('') || '<div class="empty">ほかの予定はありません</div>'}</div></section>
      ${missed.length ? `<section class="card"><div class="ch"><h2>やり残し <span class="count">${missed.length}</span></h2><span class="muted">先生が次の予定に組み直します</span></div><div class="rows">${missed.map(t => taskRow(t, true)).join('')}</div></section>` : ''}
    </div>
    <aside class="stack">
      <section class="card"><div class="ch"><h2>参考書の進み</h2><button class="link" data-go="records">くわしく</button></div>
        <div class="cb mini-books">${booksOf(ME).map(b => { const p = bookProgress(ME, b.material);
          return `<div class="mini-book"><div class="mb-top"><span>${esc(p.m.short)}</span>${statusTag(p)}<span class="num">${p.done}/${p.total}</span></div>${progressBar(p)}</div>`; }).join('')}
        <p class="key"><i class="pin-key"></i>今日までの目安</p></div></section>
      <section class="card"><div class="ch"><h2>今週</h2><span class="muted">予定 ${ws.due.length}件中 ${ws.done.length}件 完了</span></div>
        <div class="cb week"><p class="big num">${dur(ws.minutes)}</p>
          <div class="bars" aria-label="曜日ごとの勉強時間">${ws.perDay.map((v, i) => `<div title="${WD[i]} ${dur(v)}"><span class="${dateAdd(ws.start, i) === DAY ? 'today' : ''}" style="height:${v ? Math.max(6, v / max * 100) : 0}%"></span><small>${WD[i]}</small></div>`).join('')}</div></div></section>
      <section class="card"><div class="ch"><h2>担当コーチ</h2></div><div class="cb">
        <div class="coach"><img class="avatar" src="${asset('assets/coach.webp')}" alt=""><div><strong>佐々木 雄光</strong><p class="muted">${nx ? `次の面談 ${mdw(nx.date)} ${nx.time}` : '今週の面談はまだ予約していません'}</p></div></div>
        ${nx ? '' : '<button class="btn sm" data-go="schedule">面談を予約する</button>'}
        ${c.message ? `<p class="note">${esc(c.message)}</p>` : ''}</div></section>
    </aside>
  </div>`;
}
function heroCard(t) {
  const m = mat(t.material), p = pdfOf(t), running = t.startedAt && t.status !== 'done', paused = running && t.pausedAt;
  return `<section class="card hero ${running ? 'running' : ''} ${paused ? 'paused' : ''}">
    <div class="hero-main"><div class="hero-txt">
      <p class="label">${paused ? '一時停止中' : running ? '取り組み中' : '次の予定'}</p>
      <h2>${esc(t.title || m.name)}</h2>
      <p class="sub">${t.title ? esc(vagueOf(t)?.note || '時間だけ取った予定') : esc(node(t.node).label)}${t.retest ? '（再テスト）' : ''}</p>
      <p class="meta">${t.vague ? '' : `${subjDot(m)}${m.subject} · `}${range(t.time, toTime(toMin(t.time) + t.duration))}（${dur(t.duration)}）${p ? ` · 小テスト ${p.max}点` : ''}</p></div>
      ${running ? `<div class="clock ${paused ? 'paused' : ''}" data-clock="${t.id}" role="timer" aria-live="off">${clockInner(t)}</div>` : ''}</div>
    <div class="actions">
      ${running ? `${paused ? `<button class="btn big" data-act="resume" data-id="${t.id}">${ic('play', 18)}再開</button>` : `<button class="btn big" data-act="pause" data-id="${t.id}">${ic('pause', 18)}一時停止</button>`}<button class="btn big primary" data-act="complete" data-id="${t.id}">${ic('check', 18)}完了</button>`
        : `<button class="btn big primary" data-act="start" data-id="${t.id}">${ic('play', 18)}始める</button><button class="btn big" data-act="complete" data-id="${t.id}">${ic('check', 18)}もう終わった</button>`}
    </div>
    ${p || running ? `<div class="hero-sub">${p ? `<a class="link" href="${esc(fileUrl(p.problem))}" target="_blank" rel="noopener">${ic('file', 16)}問題を開く</a><a class="link" href="${esc(fileUrl(p.answer))}" target="_blank" rel="noopener">${ic('file', 16)}解答を開く</a>` : ''}
      ${running ? `<button class="link quiet" data-act="timer-stop" data-id="${t.id}">タイマーをやめる</button>` : ''}</div>` : ''}
  </section>`;
}
/* ---------- タイマー（時計の形）：文字盤の色の部分が「あと何分」。1周＝60分（予定が60分を超えるときは120分） ---------- */
const elapsedMs = t => Math.max(0, (t.pausedAt || Date.now()) - t.startedAt - (t.pausedMs || 0));
const mmss = ms => { const sec = Math.floor(ms / 1000); return `${String(Math.floor(sec / 60)).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`; };
function stopTimer(t) { delete t.startedAt; delete t.pausedAt; delete t.pausedMs; }
function clockInner(t) {
  const ms = elapsedMs(t), plan = t.duration * 60000, rest = plan - ms, over = rest < 0, scale = t.duration > 60 ? 120 : 60;
  const ang = Math.min(359.999, Math.max(0, rest) / 60000 / scale * 360), r = 86, rad = a => (a - 90) * Math.PI / 180;
  const pt = a => `${(100 + r * Math.cos(rad(a))).toFixed(2)} ${(100 + r * Math.sin(rad(a))).toFixed(2)}`;
  const sector = ang > 0 ? `<path class="ck-rest" d="M100 100 L${pt(0)} A${r} ${r} 0 ${ang > 180 ? 1 : 0} 1 ${pt(ang)} Z"/>` : '';
  const ticks = Array.from({ length: 60 }, (_, i) => { const a = i * 6, big = i % 5 === 0, r1 = big ? 80 : 84;
    return `<line x1="${(100 + r1 * Math.cos(rad(a))).toFixed(1)}" y1="${(100 + r1 * Math.sin(rad(a))).toFixed(1)}" x2="${(100 + 90 * Math.cos(rad(a))).toFixed(1)}" y2="${(100 + 90 * Math.sin(rad(a))).toFixed(1)}" class="${big ? 'big' : ''}"/>`; }).join('');
  const nums = Array.from({ length: 12 }, (_, i) => { const a = i * 30; return `<text x="${(100 + 69 * Math.cos(rad(a))).toFixed(1)}" y="${(100 + 69 * Math.sin(rad(a)) + 3.5).toFixed(1)}">${i * scale / 12}</text>`; }).join('');
  return `<svg viewBox="0 0 200 200" aria-hidden="true"><circle class="ck-face" cx="100" cy="100" r="95"/>${sector}<g class="ck-ticks">${ticks}</g><g class="ck-nums">${nums}</g>
      <line class="ck-hand" x1="100" y1="100" x2="${pt(ang).split(' ')[0]}" y2="${pt(ang).split(' ')[1]}"/><circle class="ck-hub" cx="100" cy="100" r="47"/></svg>
    <div class="ck-text"><small>${t.pausedAt ? '一時停止中' : over ? 'オーバー' : 'のこり'}</small><b class="${over ? 'over' : ''}">${over ? '+' : ''}${mmss(Math.abs(rest))}</b><small>経過 ${mmss(ms)}</small></div>`;
}
function taskRow(t, showDate = false) {
  const m = mat(t.material), done = t.status === 'done', sc = t.score != null ? pct(t.score, t.max) : null;
  return `<div class="row ${done ? 'is-done' : ''}">
    <button class="check ${done ? 'on' : ''}" data-act="${done ? 'task-open' : 'complete'}" data-id="${t.id}" aria-label="${done ? '記録を見る' : '完了にする'}">${ic('check', 16)}</button>
    <span class="time num">${showDate ? md(t.date) : t.time}</span><span class="subj ${t.vague ? 'vague' : m.kind}"></span>
    <div class="body"><h3>${esc(t.title || m.name)}</h3><p class="muted">${t.title ? esc(vagueOf(t)?.note || '時間だけ取った予定') : esc(node(t.node).label)} · ${dur(t.duration)}${!done && t.pdf ? ' · 小テスト付き' : ''}</p></div>
    ${done ? (sc != null ? `<span class="score-t num ${sc < 60 ? 'red-t' : ''}">${t.score}/${t.max}</span>` : '<span class="muted">完了</span>')
      : t.vague === 'buffer' && t.date >= DAY && tasksOf(t.student).some(isMissed) ? `<button class="btn sm" data-act="use-buffer" data-id="${t.id}">やり残しを入れる</button>` : ''}
  </div>`;
}

/* 完了：小テスト付きなら点数、どのタスクでも「ひとこと」（講師の計画画面に届く） */
function completeSheet(t) {
  const m = mat(t.material), p = pdfOf(t), max = p?.max || t.max;
  const c = t.comment || { tag: '', text: '' };
  ui.cTag = c.tag;
  openDialog(`<form class="dl" id="done-form" data-id="${t.id}">
    <div class="dl-h"><div class="done-h">${botImg('done', 'bot-sm')}<div><h2>${t.status === 'done' ? '記録を直す' : 'おつかれさま！'}</h2><p class="muted">${esc(m.name)} · ${esc(node(t.node).label)}</p></div></div>${closeBtn}</div>
    ${p ? `<div><div class="section-t">点数</div><div class="score"><button type="button" class="stepper" data-act="step" data-v="-1" aria-label="1点下げる">−</button><input id="score-in" type="number" inputmode="numeric" min="0" max="${max}" value="${t.score ?? ''}" placeholder="0" autofocus><span>/ ${max}</span><button type="button" class="stepper" data-act="step" data-v="1" aria-label="1点上げる">＋</button></div>
      <p class="score-note"><a class="link" href="${esc(fileUrl(p.answer))}" target="_blank" rel="noopener">${ic('file', 16)}解答を開く</a><span class="muted">点数はあとで入れても大丈夫です</span></p></div>` : ''}
    <div><div class="section-t">ひとこと <span class="muted">先生に届きます（なくても大丈夫）</span></div>
      <div class="chips" id="tag-chips">${TAGS.map((x, i) => `<button type="button" class="chip tagc t${i} ${c.tag === x ? 'on' : ''}" data-act="ctag" data-v="${x}">${x}</button>`).join('')}</div>
      <input id="ctext" class="mt-8" maxlength="80" value="${esc(c.text)}" placeholder="例：affect と effect で迷った"></div>
    <div class="dl-foot"><button class="btn primary" type="submit">${ic('check', 18)}${t.status === 'done' ? '保存' : '完了にする'}</button></div></form>`);
}
function finish(t, { score, tag, text }) {
  const snap0 = snapshot(), wasDone = t.status === 'done';
  if (!wasDone) {
    t.status = 'done'; t.doneAt = Date.now();
    // 一時停止していた時間は数えない
    t.actual = t.startedAt ? Math.min(t.duration * 3, Math.max(1, Math.round(elapsedMs(t) / 60000))) : t.duration;
    if (t.startedAt && t.actual < 5) t.actual = t.duration; // 押してすぐ完了なら予定の時間で
    stopTimer(t);
    const p = pdfOf(t); if (p) t.max = p.max;
  }
  if (score != null) t.score = score;
  if (tag || text) t.comment = { tag: tag || '', text: text || '', date: DAY }; else delete t.comment;
  save(); render();
  if (wasDone) return toast('保存しました', { fn: () => { state = JSON.parse(snap0); save(); render(); } });
  const p = bookProgress(ME, t.material);
  walkerCelebrate(t.score != null ? `${pct(t.score, t.max) >= 80 ? 'すごい！' : pct(t.score, t.max) >= 60 ? 'いいね！' : 'おつかれさま。'} ${t.score}/${t.max}点。${p.m.short}は${p.done}/${p.total}範囲まで来たよ` : `できた！ ${p.m.short}は${p.done}/${p.total}範囲まで来たよ。その調子！`, t.score != null ? pct(t.score, t.max) : null);
  toast(`できた！ ${p.m.short} ${p.done}/${p.total}範囲${t.comment ? '・ひとことを先生に送りました' : ''}`, { fn: () => { state = JSON.parse(snap0); save(); render(); } }, 'done');
}
function taskOpen(t) {
  const m = mat(t.material), p = pdfOf(t), done = t.status === 'done';
  openDialog(`<div class="dl"><div class="dl-h"><div><h2>${esc(m.name)}</h2><p class="muted">${esc(node(t.node).label)} · ${mdw(t.date)} ${range(t.time, toTime(toMin(t.time) + t.duration))}</p></div>${closeBtn}</div>
    ${done ? `<p>勉強時間 <strong>${dur(t.actual || t.duration)}</strong>${t.score != null ? `　点数 <strong>${t.score} / ${t.max}</strong>` : ''}</p>
      ${t.comment ? `<p class="note">${tagHtml(t.comment.tag)}${esc(t.comment.text)}</p>` : ''}
      ${t.reply ? `<div class="reply"><img class="avatar sm" src="${asset('assets/coach.webp')}" alt=""><p>${esc(t.reply.text)}</p></div>` : ''}`
      : `<p class="sub">${p ? `小テスト 第${p.version}版（${p.max}点）が付いています。` : '小テストはありません。'}${t.date > DAY ? 'この日にやりましょう。' : ''}</p>`}
    <div class="dl-foot">${done ? `<button class="btn ghost" data-act="undo-done" data-id="${t.id}">未完了に戻す</button><button class="btn primary" data-act="complete" data-id="${t.id}">点数・ひとことを直す</button>`
      : t.date <= DAY ? `<button class="btn primary" data-act="complete" data-id="${t.id}">${ic('check')}完了にする</button>` : '<button class="btn" data-act="close">閉じる</button>'}</div></div>`);
}

/* 予定：勉強できる時間を塗る（カレンダー）。講師はこの中に学習を置く */
function sSchedule() {
  const start = dateAdd(weekStart(DAY), ui.week * 7), ws = weekStats(ME, start);
  const missing = start >= weekStart(DAY) && !availRegistered(ME, start), canCopy = availRegistered(ME, dateAdd(start, -7));
  return `<div class="head"><h1>予定</h1>${weekNav(start)}</div>
  ${meetCard(ME, start)}
  ${missing ? `<div class="notice"><div><b>${range(md(start), md(dateAdd(start, 6)))}の勉強できる時間が、まだありません</b><p>カレンダーの空いている所をなぞるか、「時間を追加」で入れてください。先生はこの時間の中に学習を入れます。</p></div>${canCopy ? `<button class="btn sm primary" data-act="avail-copy" data-sid="${ME}">先週と同じにする</button>` : ''}</div>` : ''}
  <div class="cal-bar">
    <p class="sum"><span class="sum-l"><span class="sw sw-av"></span>勉強できる時間</span><b class="num">${hours(ws.avail)}</b></p>
    <p class="sum"><span class="sum-l"><span class="sw sw-ev"></span>先生が入れた学習</span><b class="num">${hours(ws.planned)}</b></p>
    <button class="btn sm" data-act="avail-add">${ic('plus', 16)}時間を追加</button>
  </div>
  ${calendar({ sid: ME, start, mode: 'avail' })}`;
}
/* 先生との面談：その週の1回を、先生が公開した時間から選ぶ（前日まで） */
function meetCard(sid, start) {
  const m = meetingInWeek(sid, start), label = start === weekStart(DAY) ? '今週' : start === dateAdd(weekStart(DAY), 7) ? '来週' : `${md(start)}〜の週`;
  const head = sub => `<p class="mc-cap">${label}の面談 · 佐々木先生${sub ? ' · ' + sub : ''}</p>`;
  if (start < weekStart(DAY)) return m ? `<section class="card meet-card">${head()}<h3>${meetLabel(m)}</h3></section>` : '';
  if (m) return `<section class="card meet-card"><div class="mc-row"><div>${head()}<h3>${meetLabel(m)}</h3>${canBook(m.date) ? '' : `<p class="muted">${m.date < DAY ? '終わりました' : '前日を過ぎたので、変更は先生に連絡してください'}</p>`}</div>
    <div class="mc-act">${canBook(m.date) ? `<button class="btn sm" data-act="meet-open" data-date="${m.date}">時間を変える</button>` : ''}<button class="btn sm" data-act="meet-ics" data-sid="${sid}">${ic('download', 16)}カレンダーに入れる</button></div></div></section>`;
  if (!state.booking.published) return `<section class="card meet-card">${head()}<h3>先生が予約の受付を始めるのを待っています</h3></section>`;
  const opts = meetingSlots(sid, start), best = opts[0], others = opts.filter(o => o !== best);
  if (!best) return `<section class="card meet-card">${head()}<h3>${weekDays(start).some(canBook) ? '予約できる時間がもうありません' : '予約は前日までです'}</h3><p class="muted">先生に相談してください</p></section>`;
  return `<section class="card meet-card">${head(`${state.booking.len}分 · 前日まで`)}
    <div class="mc-row"><div><h3>${mdw(best.date)} ${best.time}</h3><p class="muted">${best.same ? '先週と同じ時間' : best.fit ? '勉強できる時間と重なっています' : '空いている時間'}</p></div>
      <div class="mc-act"><button class="btn primary" data-act="meet-book" data-date="${best.date}" data-t="${best.time}">この時間で予約</button></div></div>
    ${others.length ? `<details class="mc-more" ${ui.open.meet ? 'open' : ''} data-open="meet"><summary>ほかの時間から選ぶ（${others.length}件）</summary>
      <div class="chips">${others.map(o => `<button class="chip" data-act="meet-book" data-date="${o.date}" data-t="${o.time}">${WD[dow(o.date)]}\u00a0${o.time}</button>`).join('')}</div></details>` : ''}
  </section>`;
}
function meetDialog(sid, date) {
  const m = meetingOn(sid, date); if (!m) return;
  const opts = meetingSlots(sid, weekStart(date)).slice(0, 12);
  openDialog(`<div class="dl"><div class="dl-h"><div><h2>面談 · ${esc(person(sid).name)}</h2><p class="muted">${meetLabel(m)} · 佐々木先生</p></div>${closeBtn}</div>
    ${m.date < DAY ? '<p class="sub">この面談は終わっています</p>' : canBook(m.date) || ui.role === 'teacher' ? `<div><div class="section-t">ほかの時間に変える</div><div class="chips">${opts.map(o => `<button class="chip" data-act="meet-book" data-sid="${sid}" data-date="${o.date}" data-t="${o.time}">${WD[dow(o.date)]}\u00a0${o.time}</button>`).join('') || '<span class="muted">空いている時間がありません</span>'}</div></div>` : '<p class="sub">前日を過ぎているので、変更は先生に連絡してください</p>'}
    <div class="dl-foot">${m.date >= DAY && (canBook(m.date) || ui.role === 'teacher') ? `<button class="btn danger" data-act="meet-cancel" data-sid="${sid}" data-id="${m.id}">予約を取り消す</button>` : ''}<span class="grow"></span><button class="btn primary" data-act="close">閉じる</button></div></div>`);
}
function weekNav(start) {
  const label = ui.week === 0 ? '今週' : ui.week === 1 ? '来週' : ui.week === -1 ? '先週' : '';
  return `<div class="weeknav"><button class="icon-btn" data-act="week" data-v="-1" aria-label="前の週">${ic('left')}</button><strong class="num">${label ? `<span class="wk">${label}</span>` : ''}${range(md(start), md(dateAdd(start, 6)))}</strong><button class="icon-btn" data-act="week" data-v="1" aria-label="次の週">${ic('right')}</button>${ui.week ? `<button class="btn sm" data-act="week" data-v="0">今週へ</button>` : ''}</div>`;
}
/* 「時間を追加」：なぞる操作を知らなくても入れられるように */
function availAddDialog(sid, start) {
  const days = weekDays(start).filter(d => d >= DAY), d0 = days[0] || start;
  openDialog(`<form class="dl" id="av-add" data-sid="${sid}"><div class="dl-h"><div><h2>勉強できる時間を追加</h2><p class="muted">${range(md(start), md(dateAdd(start, 6)))}の週</p></div>${closeBtn}</div>
    <label>日にち<select id="aa-date">${weekDays(start).map(d => `<option value="${d}" ${d === d0 ? 'selected' : ''}>${mdw(d)}</option>`).join('')}</select></label>
    <div class="time-row"><label>始まり<input type="time" id="aa-s" value="19:00" step="900"></label><span>〜</span><label>終わり<input type="time" id="aa-e" value="21:00" step="900"></label></div>
    <p class="muted">カレンダーの空いている所をなぞっても追加できます。</p>
    <div class="dl-foot"><button type="button" class="btn ghost" data-act="close">やめる</button><button class="btn primary">追加</button></div></form>`);
}
const AV_LABELS = ['朝', '電車', '昼休み', '塾のあと', '自習室'];
function availDialog(id, date) {
  const a = state.avail.find(x => x.id === id); if (!a) return;
  const inside = tasksOf(a.student).filter(t => t.date === date && toMin(t.time) >= toMin(a.start) && toMin(t.time) < toMin(a.end));
  ui.avLabel = a.label;
  openDialog(`<form class="dl" id="av-form" data-id="${id}" data-date="${date}"><div class="dl-h"><div><h2>勉強できる時間</h2><p class="muted">${a.repeat ? `毎週${WD[a.weekday]}曜` : mdw(a.date) + '（この週だけ）'}</p></div>${closeBtn}</div>
    <div class="time-row"><label>始まり<input type="time" id="av-s" value="${a.start}" step="900"></label><span>〜</span><label>終わり<input type="time" id="av-e" value="${a.end}" step="900"></label></div>
    <div><div class="section-t">どんな時間？（なくてもOK）</div><div class="chips">${AV_LABELS.map(x => `<button type="button" class="chip ${a.label === x ? 'on' : ''}" data-act="av-label" data-v="${x}">${x}</button>`).join('')}</div>
      </div>
    <label class="switch"><input type="checkbox" id="av-rep" ${a.repeat ? 'checked' : ''}> 毎週くり返す</label>
    ${inside.length ? `<p class="sub">この時間には、先生が入れた学習が${inside.length}件あります。</p>` : ''}
    <div class="dl-foot">${a.repeat ? `<button type="button" class="btn ghost" data-act="av-skip" data-id="${id}" data-date="${date}">${md(date)}だけ休み</button><button type="button" class="btn danger" data-act="av-del" data-id="${id}">毎週の枠を消す</button>` : `<button type="button" class="btn danger" data-act="av-del" data-id="${id}">消す</button>`}<span class="grow"></span><button class="btn primary">保存</button></div></form>`);
}

/* 参考書の進みの棒：青で塗り、今日の目安に届いていない分だけ薄い赤。目安は細い線（文字の吹き出しは出さない） */
function progressBar(p, big) {
  const d = pct(p.done, p.total), e = pct(p.expected, p.total), gap = p.expected > p.done;
  return `<div class="pbar ${big ? 'big' : ''}" role="img" aria-label="${p.total}範囲中${p.done}範囲。今日の目安は${p.expected}範囲">
    <i class="fill" style="width:${d}%"></i>${gap ? `<i class="lag" style="left:${d}%;width:${e - d}%"></i>` : ''}<b class="pin" style="left:${e}%"></b></div>`;
}
/* 状態：遅れているときだけ色の文字で出す（順調は出さない） */
const statusTag = p => p.status.tone === 'green' ? '' : `<span class="st ${p.status.tone}">${p.status.label}</span>`;
/* マスの状態は4つだけ：済み／60%未満（やり直したい）／予定あり／まだ */
const cellClass = c => c.done ? (c.last != null && c.last < 60 ? 'c-low' : 'c-done') : c.planned ? 'c-plan' : '';
/* ひとことの種類は色を付けず、文字で出す */
const tagHtml = tag => tag ? `<span class="tag">${esc(tag)}</span>` : '';
function bookCard(p) {
  const behind = p.expected - p.done;
  return `<section class="card book"><div class="book-h"><h2>${esc(p.m.name)}</h2>${statusTag(p)}</div>
    <div class="book-num"><strong class="num">${p.done}</strong><span class="num">/ ${p.total}範囲</span><em class="num">${pct(p.done, p.total)}%</em></div>
    ${progressBar(p, true)}
    <dl class="book-proj">
      <div><dt>今日の目安</dt><dd class="num">${p.expected}範囲${behind > 0 ? `<span class="red-t">（あと${behind}）</span>` : ''}</dd></div>
      <div><dt>目標</dt><dd class="num">${md(p.b.target)}に1周</dd></div>
      <div><dt>このペースだと</dt><dd class="num ${p.status.tone === 'green' ? '' : p.status.tone + '-t'}">${p.rem === 0 ? '1周終わりました' : p.finish ? md(p.finish) + 'に1周' : '—'}</dd></div>
    </dl>
    <div class="cells">${p.cells.map((c, i) => `<span class="cell ${cellClass(c)}" title="${esc(c.n.label)}${c.last != null ? ` · ${c.last}%` : c.done ? ' · 済み' : c.planned ? ' · 予定あり' : ''}${c.tries > 1 ? ` · ${c.tries}回` : ''}">${i + 1}</span>`).join('')}</div>
  </section>`;
}
function sRecords() {
  const ws = weekStats(ME), max = Math.max(60, ...ws.perDay), f = ui.recFilter;
  const list = tasksOf(ME).filter(t => t.status === 'done' && (t.score != null || t.comment) && (!f || t.material === f)).sort(byTime).reverse().slice(0, ui.recMore ? 200 : 12);
  const all = tasksOf(ME).filter(t => t.status === 'done'), total = all.reduce((a, t) => a + (t.actual || t.duration), 0), days = new Set(all.map(t => t.date)).size;
  let streak = 0; for (let d = DAY; all.some(t => t.date === d); d = dateAdd(d, -1)) streak++;
  return `<div class="head"><h1>記録</h1></div>
  <div class="rec-top">
    <div class="rt wide"><span>今週の勉強時間</span><strong class="num">${dur(ws.minutes)}</strong><small>予定 ${ws.due.length}件中 ${ws.done.length}件 完了</small>
      <div class="bars" aria-label="曜日ごとの勉強時間">${ws.perDay.map((v, i) => `<div title="${WD[i]} ${dur(v)}"><span class="${dateAdd(ws.start, i) === DAY ? 'today' : ''}" style="height:${v ? Math.max(6, v / max * 100) : 0}%"></span><small>${WD[i]}</small></div>`).join('')}</div></div>
    <div class="rt"><span>これまでの合計</span><strong class="num">${dur(total)}</strong><small>${days}日 · ${all.length}件</small></div>
    <div class="rt"><span>今日</span><strong class="num">${dur(ws.perDay[dow(DAY)])}</strong><small>${streak ? `${streak}日続けて勉強中` : 'まだ始めていません'}</small></div>
  </div>
  <div class="sec-h"><h2>参考書</h2><p class="legend"><span class="cell c-done"></span>済み<span class="cell c-low"></span>60%未満<span class="cell c-plan"></span>予定あり<span class="cell"></span>まだ</p></div>
  <div class="book-grid">${booksOf(ME).map(b => bookCard(bookProgress(ME, b.material))).join('')}</div>
  <div class="rec-grid">
    <section class="card"><div class="ch"><h2>点数とひとこと</h2></div>
      <div class="chips scroll-x pad-x"><button class="chip ${!f ? 'on' : ''}" data-act="rec-filter" data-v="">すべて</button>${booksOf(ME).map(b => `<button class="chip ${f === b.material ? 'on' : ''}" data-act="rec-filter" data-v="${b.material}">${esc(mat(b.material).short)}</button>`).join('')}</div>
      <div class="rows">${list.map(t => { const sc = t.score != null ? pct(t.score, t.max) : null;
        return `<div class="row top"><span class="time num">${md(t.date)}</span><span class="subj ${mat(t.material).kind}"></span>
        <div class="body"><h3>${esc(mat(t.material).short)} ${esc(node(t.node).label)}${t.retest ? '<span class="muted">（再テスト）</span>' : ''}</h3>
          ${t.comment ? `<p class="sub">${tagHtml(t.comment.tag)}${esc(t.comment.text)}</p>` : ''}
          ${t.reply ? `<div class="reply"><img class="avatar sm" src="${asset('assets/coach.webp')}" alt=""><p>${esc(t.reply.text)}</p></div>` : ''}</div>
        ${sc != null ? `<span class="score-t num ${sc < 60 ? 'red-t' : ''}">${t.score}/${t.max}</span>` : ''}</div>`; }).join('') || '<div class="empty">まだありません</div>'}</div>
      ${!ui.recMore && list.length >= 12 ? '<div class="pad2"><button class="link" data-act="rec-more">もっと見る</button></div>' : ''}</section>
    <section class="card"><div class="ch"><h2>今週の教科ごと</h2><span class="num">${dur(ws.minutes)}</span></div><div class="cb">
      ${Object.entries(ws.bySubject).map(([s, v]) => `<div class="subj-row"><span>${subjDot({ kind: SUBJECTS[s] })}${s}</span><span class="bar"><i class="${SUBJECTS[s]}" style="width:${pct(v, ws.minutes)}%"></i></span><span class="num">${dur(v)}</span></div>`).join('') || '<p class="muted">まだありません</p>'}
    </div></section>
  </div>`;
}

function sResources() {
  const docs = state.resources.filter(d => d.target === 'all' || d.target === ME).sort((a, b) => b.date.localeCompare(a.date));
  return `<div class="head"><h1>資料</h1></div>
  <section class="card"><div class="rows">${docs.map(d => `<a class="row link-row" href="${esc(fileUrl(d.url))}" target="_blank" rel="noopener"><span class="file-ic">${ic('file', 18)}</span><div class="body"><h3>${esc(d.name)}</h3><p class="muted">PDF · ${md(d.date)}に先生から</p></div>${ic('right', 16)}</a>`).join('') || '<div class="empty">まだありません</div>'}</div></section>
  <p class="foot-note">小テストの問題と解答は、ホームの予定から開けます。</p>`;
}

function profileDialog() {
  const p = person(ME), g = p.goal;
  openDialog(`<div class="dl"><div class="dl-h"><div><h2>${esc(p.name)}</h2><p class="muted">${esc(p.grade)} · 担当 佐々木 雄光</p></div>${closeBtn}</div>
    <img class="campus" src="${asset('assets/campus.jpg')}" alt="">
    <div><div class="section-t">第一志望</div><p class="lead">${esc(g.school)} ${esc(g.faculty)}</p><p class="sub">入試 ${g.date.replaceAll('-', '.')} · あと${daysBetween(DAY, g.date)}日</p></div>
    <div><div class="section-t">参考書と目標</div>${booksOf(ME).map(b => `<p class="sub">${esc(mat(b.material).name)} — ${md(b.target)}までに1周</p>`).join('')}</div>
    <p class="muted">目標は面談で先生と一緒に決めます。</p></div>`);
}

/* ---------- 受験AI Actifyくん ---------- */
const BOT_TOPICS = ['今日なにからやる？', '参考書、間に合う？', '苦手なところは？', '覚え方のコツは？', 'やる気が出ない', '問題の解き方を聞きたい'];
function botReply(text, hasImg) {
  const q = String(text).normalize('NFKC'), sid = ME;
  const rest = tasksOf(sid).filter(t => t.date === DAY && t.status !== 'done').sort(byTime);
  if (hasImg) return { mood: 'think', text: '写真ありがとう！\n（この試作版では、まだ画像を読めないんだ）\n\nどこまでわかって、どこで止まったか教えてくれる？「2行目の式変形がわからない」みたいに。' };
  if (/今日|なにから|何から|次|やること/.test(q)) {
    if (!rest.length) return { mood: 'done', text: !tasksOf(sid).some(t => t.date === DAY) ? '今日は先生が入れた予定がないよ。\n点が低かった範囲を見直すのがおすすめ。「苦手なところは？」って聞いてみて。' : '今日の予定はぜんぶ終わってるよ。おつかれさま！\n余裕があれば、点が低かった範囲を見直すのがおすすめ。「苦手なところは？」って聞いてみて。' };
    return { mood: 'support', text: `今日はあと${rest.length}つだよ。\n${rest.map(t => `・${t.time} ${mat(t.material).short} ${node(t.node).label}（${t.duration}分）`).join('\n')}\n\nまずは ${rest[0].time} の ${mat(rest[0].material).short} から。${rest[0].pdf ? '小テストはホームの「次の予定」から開けるよ。' : ''}` };
  }
  if (/間に合|進み|進捗|ペース|終わ|参考書/.test(q)) {
    const ps = booksOf(sid).map(b => bookProgress(sid, b.material)), late = ps.filter(p => p.status.tone !== 'green');
    return { mood: late.length ? 'think' : 'happy', text: `参考書の進みはこんな感じ。\n${ps.map(p => `・${p.m.short}：${p.done}/${p.total}範囲（${p.status.label}）${p.finish ? ` このペースだと${md(p.finish)}に1周。目標は${md(p.b.target)}` : ''}`).join('\n')}\n\n${late.length ? `${late.map(p => p.m.short).join('・')}が少し遅れてるね。${late.map(p => `${p.m.short}は週${Math.ceil(p.needPerWeek * 10) / 10}範囲`).join('、')}のペースなら間に合うよ。勉強できる時間を少し増やせそうなら「予定」で塗っておくと、先生がそこに入れてくれるよ。` : '全部順調！この調子でいこう。'}` };
  }
  if (/苦手|伸び|点|弱|低|間違/.test(q)) {
    const cells = booksOf(sid).flatMap(b => bookProgress(sid, b.material).cells.filter(c => c.last != null).map(c => ({ ...c, m: mat(b.material) }))).sort((a, b) => a.last - b.last).slice(0, 3);
    if (!cells.length) return { mood: 'think', text: 'まだ点数の記録が少ないみたい。小テストを解いたら点数を入れてね。' };
    const cm = commentsOf(sid, cells[0].m.id).find(x => x.node === cells[0].n.id);
    return { mood: 'think', text: `点が低めなのはここだよ。\n${cells.map(c => `・${c.m.short} ${c.n.label}：${c.last}%`).join('\n')}\n${cm ? `\n${cells[0].n.label}では「${cm.comment.text || cm.comment.tag}」って書いてたね。` : ''}\n再テストは間をあけてやると記憶に残りやすいんだ。先生が予定に入れてくれるから、その日にもう一度やってみよう。` };
  }
  if (/やる気|疲|眠|しんど|だる|つら|むり|無理/.test(q)) {
    const s = [...rest].sort((a, b) => a.duration - b.duration)[0];
    return { mood: 'sleep', text: `そういう日もあるよね。まずは5分だけやってみない？\n${s ? `いちばん短いのは「${mat(s.material).short} ${node(s.node).label}」（${s.duration}分）。\n` : ''}始めると、やる気はあとからついてくることが多いんだ。どうしてもしんどい日は、佐々木先生に一言LINEしておくと計画を調整してもらえるよ。` };
  }
  if (/写真|解き方|わから|解説|問題/.test(q)) return { mood: 'think', text: '問題の写真を送ってね（入力欄の左の画像ボタン）。\nどこまでわかって、どこで止まったかも一言そえてくれると、ヒントを出しやすいよ。' };
  if (/覚え|暗記|単語|勉強法|やり方|コツ/.test(q)) return { mood: 'support', text: '暗記ものは「思い出す練習」がいちばん効くよ。\n・見て覚えるより、隠してテスト\n・1日後 → 7日後 → 30日後にもう一度\n・電車みたいな短い時間に回すと続けやすい\n\nActifyの再テストも、この間隔で先生が入れるようになってるよ。' };
  if (/先生|コーチ|面談|相談/.test(q)) { const nx = nextMeeting(sid); return { mood: 'support', text: `${nx ? `次の面談は${mdw(nx.date)} ${nx.time}だよ。` : '面談の予約がまだだよ。「予定」の上から前日までに選べるよ。'}\n計画を変えたいときや、ぼくじゃ答えにくい悩みは佐々木先生に相談してね。急ぎならLINEで。` }; }
  if (/ありがと|できた|終わった/.test(q)) return { mood: 'done', text: 'やったね！その調子！' };
  if (/^(お[けっ]|ok|オッケ|了解|りょ|わかった|うん|はい|おけ)/i.test(q.trim())) return { mood: 'wink', text: 'よし、その調子！\nまた聞きたいことがあったら、いつでも呼んでね。' };
  return { mood: 'think', text: 'うーん、ごめんね。まだうまく答えられないかも。\nこんなことなら得意だよ。\n・今日なにからやる？\n・参考書、間に合う？\n・苦手なところは？\n・やる気が出ない' };
}
const chatLog = () => (state.chat[ME] ||= []);
function chatHtml(limit) {
  const log = limit ? chatLog().slice(-limit) : chatLog();
  return log.map(m => m.from === 'bot'
    ? `<div class="msg from-bot">${botImg(m.mood, 'bot-av')}<div class="bubble">${m.typing ? '<span class="typing"><i></i><i></i><i></i></span>' : esc(m.text).replace(/\n/g, '<br>')}</div></div>`
    : `<div class="msg from-me"><div class="bubble">${m.img ? `<img src="${esc(m.img)}" alt="送った写真">` : ''}${esc(m.text).replace(/\n/g, '<br>')}</div></div>`).join('');
}
function chatInput(where) {
  return `<form class="chat-in" data-chat="${where}"><label class="icon-btn" role="button" tabindex="0" title="問題の写真を送る" aria-label="問題の写真を送る">${ic('image', 20)}<input type="file" accept="image/*" hidden data-chatimg="${where}"></label>
    <input name="q" placeholder="${BOT_NAME}に聞く" autocomplete="off"><button class="send" aria-label="送る">${ic('send', 18)}</button></form>`;
}
function sendChat(text, img) {
  if (!text && !img) return;
  chatLog().push({ from: 'me', text: text || '', img, at: DAY });
  const typing = { from: 'bot', mood: 'think', typing: true };
  chatLog().push(typing); save(); refreshChat();
  setTimeout(() => {
    const r = botReply(text || '', !!img); Object.assign(typing, { typing: false, ...r }); delete typing.typing;
    if (chatLog().length > 80) state.chat[ME] = chatLog().slice(-80);
    save(); refreshChat();
  }, 750);
}
function refreshChat() {
  document.querySelectorAll('[data-chatlog]').forEach(el => { el.innerHTML = chatHtml(el.dataset.chatlog === 'mini' ? 6 : 0); el.scrollTop = el.scrollHeight; });
}
function sAi() {
  return `<div class="ai-page">
    <header class="ai-head"><img class="ai-img" src="${asset('assets/sp/point.webp')}" alt=""><div><h1>${BOT_NAME}に相談</h1><p class="sub">今日の予定・参考書の進み・点数を見て答えます。先生には共有されません。</p></div></header>
    <section class="card chat"><div class="chat-log" data-chatlog="full">${chatHtml()}</div>
      <div class="chips bp-chips scroll-x">${BOT_TOPICS.map(t => `<button class="chip" data-act="ask" data-v="${t}">${t}</button>`).join('')}</div>${chatInput('full')}</section>
  </div>`;
}
function botFab() {
  // ふだんは画面を歩いている（js/bot.js）。隠したときだけ右下のボタンで呼び戻す
  if (ui.role !== 'student' || ui.page === 'ai') return '';
  return `${W.hidden ? `<button class="fab" data-act="bot-show" aria-label="${BOT_NAME}を呼ぶ">${botImg('face', 'fab-img')}</button>` : ''}
  ${ui.botOpen && innerWidth > 820 ? `<section class="bot-panel"><div class="bp-h">${botImg('happy', 'bot-av')}<div><strong>${BOT_NAME}</strong><small>わからないことを聞けます</small></div><button class="link" data-go="ai">大きく開く</button><button class="link muted-link" data-act="bot-hide">隠れる</button><button class="icon-btn" data-act="bot-toggle" aria-label="閉じる">${ic('close')}</button></div>
    <div class="chat-log" data-chatlog="mini">${chatHtml(6)}</div>
    <div class="chips bp-chips">${BOT_TOPICS.slice(0, 3).map(t => `<button class="chip" data-act="ask" data-v="${t}">${t}</button>`).join('')}</div>${chatInput('mini')}</section>` : ''}`;
}
