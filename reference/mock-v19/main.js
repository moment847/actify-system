'use strict';
/* ---------- 画面の骨組み・切り替え・操作 ---------- */
const ui = {
  role: 'student', page: 'home', week: 0, planStudent: 's1', sideTab: 'slot', blk: null, slotMat: null, flashTask: null, meetPick: false, meetMore: false, open: { nb: false, rec: false, toc: false }, feText: '', feDur: 0, feFocus: false, feMat: '', feNode: null, feQuiz: true, bookOpen: null, suggOff: new Set(), pf: null, cmtFilter: '', picking: null, dismissed: new Set(), sugg: [],
  cmtOpen: new Set(), replyOpen: null, stage: [], printTab: 'pdf', printMat: 'en', toc: [], tocEdit: false, recFilter: '', availEdit: false, botOpen: false, botHint: null, hinted: false, flashNode: null,
};
const NAV = {
  student: [['home', 'home', 'ホーム'], ['schedule', 'cal', '予定'], ['records', 'chart', '記録'], ['ai', 'msg', 'AI相談'], ['resources', 'folder', '資料']],
  teacher: [['home', 'users', '生徒'], ['plan', 'cal', '計画'], ['meet', 'clock', '面談'], ['prints', 'print', '小テスト']],
  admin: [['materials', 'book', '教材'], ['accounts', 'users', 'アカウント']],
};
/* 金・土・日は来週の計画を立てる日。計画画面は来週から開く */
const planWeekDefault = () => dow(DAY) >= 4 ? 1 : 0;
const ROLE = { student: '生徒', teacher: '講師', admin: '運営' };
const PAGES = {
  student: { home: sHome, schedule: sSchedule, records: sRecords, ai: sAi, resources: sResources },
  teacher: { home: tHome, plan: tPlan, meet: tMeet, prints: tPrints },
  admin: { materials: aMaterials, accounts: aAccounts },
};

function render() {
  const nav = NAV[ui.role];
  if (!nav.some(n => n[0] === ui.page)) ui.page = nav[0][0];
  const title = nav.find(n => n[0] === ui.page)[2];
  document.title = `${title} | Actify`;
  const who = ui.role === 'student' ? person(ME) : ui.role === 'teacher' ? person('c1') : person('a1');
  const keep = ['.cal-wrap', '.side-body', '[data-chatlog]'].map(q => [q, document.querySelector(q)?.scrollTop || 0, document.querySelector(q)?.scrollLeft || 0]);
  hidePop();
  document.querySelector('#app').innerHTML = `
  <div class="shell ${ui.picking ? 'picking' : ''}">
    <aside class="side-nav">
      <div class="brand"><img src="${asset('assets/logo-mark.png')}" alt="" class="brand-mark"><img src="${asset('assets/logo-word.png')}" alt="Actify" class="brand-word"></div>
      <p class="tagline">学びを、動かす。</p>
      <nav class="nav">${nav.map(([id, i, l]) => `<button data-go="${id}" class="${id === ui.page ? 'on' : ''}">${ic(i)}${l}</button>`).join('')}</nav>
      <button class="me" ${ui.role === 'student' ? 'data-act="profile"' : 'tabindex="-1"'}>
        ${ui.role === 'teacher' ? `<img class="avatar" src="${asset('assets/coach.webp')}" alt="">` : `<span class="avatar">${esc(first(who.name)[0])}</span>`}
        <span><strong>${esc(who.name)}</strong><small>${ui.role === 'student' ? '目標・プロフィール' : ROLE[ui.role]}</small></span>
      </button>
    </aside>
    <div class="mainwrap">
      <header class="top">
        <img src="${asset('assets/logo-mark.png')}" alt="Actify" class="top-mark">
        <span class="where">10月2日（金）· ${title}</span>
        <div class="roles" aria-label="表示する役割">${Object.entries(ROLE).map(([k, l]) => `<button data-role="${k}" class="${ui.role === k ? 'on' : ''}">${l}</button>`).join('')}</div>
        <button class="btn sm ghost" data-act="reset" title="デモのデータを最初の状態に戻します">初期化</button>
      </header>
      <main class="main page-${ui.role}-${ui.page}" id="main">${PAGES[ui.role][ui.page]()}</main>
    </div>
    <nav class="tabbar">${nav.map(([id, i, l]) => `<button data-go="${id}" class="${id === ui.page ? 'on' : ''}">${ic(i, 20)}${l}</button>`).join('')}</nav>
  </div>
  ${ui.picking ? `<div class="pick-banner">${ic('cal')}カレンダーの置きたい時刻を押してください<button data-act="pick-cancel">やめる</button></div>` : ''}
  ${botFab()}`;
  keep.forEach(([q, v, h]) => { const el = document.querySelector(q); if (el) { el.scrollTop = v; el.scrollLeft = h; } });
  calInitScroll();
  document.body.dataset.page = `${ui.role}-${ui.page}`;
  if (ui.feFocus) { const fe = document.querySelector('#fe-text'); if (fe) { fe.focus(); fe.setSelectionRange(fe.value.length, fe.value.length); } ui.feFocus = false; }
  // ホームのActifyくん：描き直したら今の状況のセリフを言う（完了直後はお祝いから）
  walkerOnRender(); ui.botEvent = null;
  document.querySelectorAll('[data-chatlog]').forEach(el => { el.scrollTop = el.scrollHeight; });
  clearInterval(ui.timer);
  const ck = document.querySelector('[data-clock]');
  if (ck) ui.timer = setInterval(() => { const t = state.tasks.find(x => x.id === ck.dataset.clock); if (t?.startedAt && !t.pausedAt) ck.innerHTML = clockInner(t); }, 1000);
  { const tb = document.querySelector('.tabbar'), tp = document.querySelector('header.top'); if (tb?.offsetHeight) document.documentElement.style.setProperty('--tabbar-h', tb.offsetHeight + 'px'); if (tp?.offsetHeight) document.documentElement.style.setProperty('--top-h', tp.offsetHeight + 'px'); }
  if (ui.flashTask) { const f = ui.flashTask; setTimeout(() => { if (ui.flashTask === f) ui.flashTask = null; }, 2500); }
  if (ui.flashNode) { const f = ui.flashNode; setTimeout(() => { if (ui.flashNode === f) ui.flashNode = null; }, 3000); }
}
/* 画面が狭いと右の欄はカレンダーの下に出るので、そこまで送る */
function toSide() {
  if (matchMedia('(max-width:820px)').matches && ui.page === 'plan') { ui.sheet = true; render(); return; }  // スマホ：下から出る欄を開く
  if (matchMedia('(max-width:1180px)').matches) document.querySelector('.side')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function go(page) { if (page !== ui.page) ui.week = ui.role === 'teacher' && page === 'plan' ? planWeekDefault() : 0; ui.page = page; ui.picking = null; location.hash = `${ui.role}/${page}`; render(); scrollTo(0, 0); }
/* 保存のたびに、1周目の範囲の順番を日付の順にそろえる（data.js の resequence） */
const seqNow = () => students().flatMap(p => resequence(p.id));
const seqNote = ch => ch.length ? `。${[...new Set(ch.map(c => mat(c.t.material).short))].join('・')}の範囲を日付の順にそろえました` : '';
const quizNote = t => t.pdf ? ` · 小テスト第${pdfOf(t).version}版` : pdfMissing(t) ? ' · 使える小テストなし' : '';
function commit(msg, snap0) {
  const ch = seqNow(); if (ch.length) msg = (msg || '保存しました') + seqNote(ch);
  save(); render(); if (msg) toast(msg, snap0 ? { fn: () => { state = JSON.parse(snap0); save(); render(); } } : null);
}

const dlg = () => document.querySelector('#dialog');
function openDialog(html, drawer = false) { hidePop(); const d = dlg(); d.className = drawer ? 'drawer' : ''; d.innerHTML = html; if (!d.open) d.showModal();
  // 開いた直後に×ボタンへ枠が出ないよう、入力欄の指定が無ければ本文にフォーカスを置く（Tabで順に進める）
  const f = matchMedia('(pointer: coarse)').matches ? null : d.querySelector('[autofocus]'), body = d.querySelector('.dl'); if (f) f.focus(); else if (body) { body.tabIndex = -1; body.focus(); } }
function closeDialog() { const d = dlg(); if (d.open) d.close(); }
const closeBtn = `<button type="button" class="icon-btn" data-act="close" aria-label="閉じる">${ic('close')}</button>`;

/* ---------- クリック ---------- */
document.addEventListener('pointerdown', e => { ui.lastPointer = e.pointerType; }, true);
document.addEventListener('click', e => {
  if (ui.suppressClick) { ui.suppressClick = false; e.preventDefault(); return; }
  if (!e.target.closest('#pop') && !e.target.closest('[data-hover]')) hidePop();
  const g = e.target.closest('[data-go]'); if (g) { if (dlg().open) closeDialog(); return go(g.dataset.go); }
  const r = e.target.closest('[data-role]');
  if (r) { ui.role = r.dataset.role; ui.page = NAV[ui.role][0][0]; ui.week = 0; ui.picking = null; ui.availEdit = false; location.hash = `${ui.role}/${ui.page}`; render(); return scrollTo(0, 0); }
  const a = e.target.closest('[data-act]');
  // 「押して置く」：項目を選んだあと、カレンダーの列を押す
  if (ui.picking) {
    const col = e.target.closest('.cal[data-mode="plan"] .col');
    if (col && (!a || a.dataset.act === 'task-pop' || a.dataset.act === 'sg-open')) return place(ui.picking.k, ui.picking.id, col.dataset.date, toTime(timeFromY(col, e.clientY)));
  }
  if (!a) return;
  const { act, id, v } = a.dataset, t = id && state.tasks.find(x => x.id === id);
  switch (act) {
    case 'close': return closeDialog();
    case 'reset': return openDialog(`<div class="dl"><div class="dl-h"><div><h2>デモデータを最初に戻す</h2><p class="muted">入れた予定・記録・登録したファイルが消えて、最初の状態に戻ります</p></div>${closeBtn}</div>
      <div class="dl-foot"><button class="btn ghost" data-act="close">やめる</button><button class="btn danger" data-act="reset-ok">最初に戻す</button></div></div>`);
    case 'reset-ok': closeDialog(); freshState(); save(); ui.dismissed.clear(); ui.stage = []; ui.toc = []; render(); return toast('最初の状態に戻しました');
    case 'ics-copy': { const ta = document.querySelector('#ics-text'); const done = () => toast('コピーしました。メモ帳に貼って「.ics」で保存すると取り込めます');
      if (navigator.clipboard?.writeText) navigator.clipboard.writeText(ta.value).then(done, () => { ta.select(); toast('選択しました。コピーしてください'); }); else { ta.select(); toast('選択しました。コピーしてください'); } return; }
    case 'undo': ui.undo?.(); document.querySelector('#toast').classList.remove('show'); return;
    case 'profile': return profileDialog();
    // 生徒
    case 'start': { const s0 = snapshot(); tasksOf(t.student).forEach(x => { if (x !== t) stopTimer(x); }); t.startedAt = Date.now(); t.pausedMs = 0; delete t.pausedAt; return commit('タイマーを始めました', s0); }
    case 'pause': t.pausedAt = Date.now(); save(); return render();
    case 'resume': t.pausedMs = (t.pausedMs || 0) + Date.now() - t.pausedAt; delete t.pausedAt; save(); return render();
    case 'timer-stop': { const s0 = snapshot(); stopTimer(t); return commit('タイマーをやめました（記録はしていません）', s0); }
    case 'use-buffer': { // 予備時間に、いちばん古いやり残しを入れる
      const s0 = snapshot(), mv = tasksOf(t.student).filter(isMissed).sort(byTime)[0]; if (!mv) return;
      mv.date = t.date; mv.time = t.time; t.time = toTime(toMin(t.time) + mv.duration); t.duration -= mv.duration;
      if (t.duration < 10) state.tasks = state.tasks.filter(x => x !== t);
      return commit(`予備時間に「${mat(mv.material).short} ${node(mv.node).label}」を入れました`, s0); }
    case 'meet-book': { const s0 = snapshot(), sid = a.dataset.sid || ME, m = bookMeeting(sid, a.dataset.date, a.dataset.t); closeDialog();
      return commit(`${ui.role === 'student' ? '' : person(sid).name + ' '}${meetLabel(m)} で予約しました`, s0); }
    case 'meet-more': ui.meetMore = true; return render();
    case 'meet-cancel': { const s0 = snapshot(); state.meetings = state.meetings.filter(m => m.id !== id); closeDialog(); return commit('予約を取り消しました', s0); }
    case 'meet-open': return meetDialog(a.dataset.sid || ME, a.dataset.date);
    case 'meet-auto': { const s0 = snapshot(), start = dateAdd(weekStart(DAY), ui.week * 7); let n = 0;
      students().filter(p => !meetingInWeek(p.id, start)).forEach(p => { const sl = meetingSlots(p.id, start), o = sl.find(x => x.same) || sl.find(x => x.fit) || sl[0]; if (o) { bookMeeting(p.id, o.date, o.time); n++; } });
      return commit(n ? `${n}人の面談を入れました（生徒の「予定」に出ます）` : '入れられる生徒はいませんでした', n ? s0 : null); }
    case 'meet-len': { const s0 = snapshot(); state.booking.len = +v; return commit(`これからの予約は1回${v}分にします`, s0); }
    case 'meet-publish': { const s0 = snapshot(); state.booking.published = !state.booking.published; return commit(state.booking.published ? '予約の受付を始めました。生徒の「予定」から予約できます' : '予約の受付を止めました（入っている予約はそのまま）', s0); }
    case 'meet-copy': navigator.clipboard?.writeText(BOOKING_URL).catch(() => {}); return toast('予約リンクをコピーしました');
    case 'meet-ics': return downloadIcs(a.dataset.sid);
    case 'ics-file': closeDialog(); return saveIcsFile(a.dataset.sid || undefined);
    case 'co-copy': { const s0 = snapshot(), n = copyCoachOpenFromLastWeek(dateAdd(weekStart(DAY), ui.week * 7)).length; return commit(n ? `先週と同じ${n}枠を入れました` : '先週の登録がありません', n ? s0 : null); }
    case 'avail-copy': { const s0 = snapshot(), sid = a.dataset.sid || ui.planStudent, n = copyAvailFromLastWeek(sid, dateAdd(weekStart(DAY), ui.week * 7)).length;
      return commit(n ? `先週と同じ${n}枠を入れました${ui.role === 'teacher' ? '（仮の登録。生徒の「予定」に出ます）' : ''}` : '先週の登録がありません', n ? s0 : null); }
    case 'co-open': return coachOpenDialog(id, a.dataset.date);
    case 'co-del': { const s0 = snapshot(); state.coachOpen = state.coachOpen.filter(o => o.id !== id); closeDialog(); return commit('面談できる時間から外しました（入っている予約はそのまま）', s0); }
    case 'complete': return completeSheet(t);
    case 'step': { const i = document.querySelector('#score-in'); i.value = clamp((+i.value || 0) + +v, 0, +i.max); return; }
    case 'ctag': ui.cTag = ui.cTag === v ? '' : v; document.querySelectorAll('#tag-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.v === ui.cTag)); return;
    case 'task-open': return taskOpen(t);
    case 'undo-done': { const s0 = snapshot(); t.status = 'todo'; delete t.score; delete t.actual; closeDialog(); return commit('未完了に戻しました', s0); }
    case 'week': ui.week = v === '0' ? 0 : ui.week + +v; return render();
    case 'av-open': return availDialog(id, a.dataset.date);
    case 'avail-add': return availAddDialog(ME, dateAdd(weekStart(DAY), ui.week * 7));
    case 'acc-edit': return accDialog(id);
    case 'av-label': ui.avLabel = ui.avLabel === v ? '' : v; a.parentElement.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.v === ui.avLabel)); return;
    case 'av-skip': { const s0 = snapshot(); state.availSkip.push({ id, date: a.dataset.date }); closeDialog(); return commit(`${mdw(a.dataset.date)}は休みにしました`, s0); }
    case 'av-del': { const s0 = snapshot(); state.avail = state.avail.filter(x => x.id !== id); closeDialog(); return commit('勉強できる時間を消しました', s0); }
    case 'rec-filter': ui.recFilter = v; return render();
    case 'rec-more': ui.recMore = true; return render();
    case 'ask': if (ui.page !== 'ai') { if (innerWidth <= 820) go('ai'); else { ui.botOpen = true; render(); } } ui.botHint = null; return sendChat(v);
    case 'bot-toggle': if (innerWidth <= 820) { ui.botOpen = false; return go('ai'); } ui.botOpen = !ui.botOpen; ui.botHint = null; return render();
    case 'bot-hide': W.hidden = true; ui.botOpen = false; return render();
    case 'bot-show': W.hidden = false; return render();
    // 講師
    case 'open-plan': ui.planStudent = id; ui.sideTab = 'slot'; ui.blk = null; ui.availEdit = false; if (ui.page === 'plan') { ui.week = planWeekDefault(); return render(); } return go('plan');
    case 'side': ui.sideTab = v; ui.sheet = true; return render();
    case 'sheet': ui.sheet = !ui.sheet; return render();
    case 'gap': ui.blk = blockAt(ui.planStudent, a.dataset.date, +a.dataset.s); ui.sideTab = 'slot'; ui.slotMat = null; render(); return toSide();
    case 'blk-nav': { const bs = weekBlocks(ui.planStudent, dateAdd(weekStart(DAY), ui.week * 7)), i = bs.findIndex(b => blkKey(b) === blkKey(ui.blk)); ui.blk = bs[clamp(i + +v, 0, bs.length - 1)] || ui.blk; ui.slotMat = null; return render(); }
    case 'slot-mat': ui.slotMat = v; return render();
    case 'blk-next': { // 参考書の次の範囲を、残りの時間の頭に入れる
      const sid = ui.planStudent, b = ui.blk, g = blockGaps(sid, b)[0], nx = nextNode(sid, v); if (!g || !nx) return;
      const s0 = snapshot(), t = putTask(sid, b.date, g[0], fitDur(g[1] - g[0], typicalDur(sid, v)), 'node', nx.id), ch = seqNow(); ui.flashTask = t.id;
      return commit(`${t.time}〜 ${dur(t.duration)} ${mat(v).short} ${node(t.node).label}${quizNote(t)}${seqNote(ch.filter(c => c.t !== t))}`, s0); }
    case 'fe-mat': ui.feMat = v; ui.feNode = null; ui.feDur = 0; ui.feQuiz = true; ui.feFocus = !v; return render();
    case 'fe-quick': { const x = VAGUE.find(y => y.k === v); ui.feText = x.label; ui.feDur = 0; ui.feFocus = true; return render(); }
    case 'blk-vague': {
      const sid = ui.planStudent, b = ui.blk, g = blockGaps(sid, b)[0]; if (!g) return;
      if (v === 'free') return openPlanDialog({ mid: 'free', date: b.date, time: toTime(g[0]), dur: fitDur(g[1] - g[0], 60) });
      const x = VAGUE.find(y => y.k === v), s0 = snapshot(), t = putVague(sid, b.date, g[0], fitDur(g[1] - g[0], x.dur), v); ui.flashTask = t.id;
      return commit(`${t.time}〜 ${dur(t.duration)} ${x.label}を入れました（長さは −／＋ で変えられます）`, s0); }
    case 'blk-rec': { const sid = ui.planStudent, s0 = snapshot(), put = recommendFill(sid, ui.blk); if (!put.length) return toast('入れられるおすすめがありません');
      const lack = put.filter(pdfMissing).length; ui.flashTask = put[0].id;
      return commit(`おすすめを${put.length}件入れました${lack ? `（使える小テストがない予定が${lack}件）` : '（小テストは自動で付けています）'}。× で外せます`, s0); }
    case 'blk-del': { const s0 = snapshot(), label = t.title || `${mat(t.material).short} ${node(t.node).label}`; state.tasks = state.tasks.filter(x => x !== t); if (ui.blk) repack(ui.planStudent, ui.blk); return commit(`「${label}」を外しました（後ろは詰めました）`, s0); }
    case 'blk-dur': { const s0 = snapshot(); t.duration = Math.max(10, t.duration + +v); if (ui.blk) repack(ui.planStudent, ui.blk); return commit(null, s0); }
    case 'blk-edit': return openPlanDialog({ taskId: id });
    case 'slot-range': { // 目次から選んだ範囲を、残りの時間の頭に入れる
      const sid = ui.planStudent, b = ui.blk, g = blockGaps(sid, b)[0]; if (!g) return toast('この時間はいっぱいです');
      const planned = tasksOf(sid).find(x => x.node === id && x.status !== 'done');
      if (planned) return toast(`この範囲は${mdw(planned.date)}に入っています`, { label: 'ここへ移す', fn: () => { const s0 = snapshot(); planned.date = b.date; planned.time = toTime(g[0]); planned.duration = fitDur(g[1] - g[0], planned.duration); ui.flashTask = planned.id; commit('移しました', s0); } });
      const s0 = snapshot(), t = putTask(sid, b.date, g[0], fitDur(g[1] - g[0], typicalDur(sid, node(id).m.id)), 'node', id), ch = seqNow(); ui.flashTask = t.id;
      return commit(`${t.time}〜 ${dur(t.duration)} ${mat(t.material).short} ${node(t.node).label}${t.retest ? '（再テスト）' : ''}${quizNote(t)}${seqNote(ch.filter(c => c.t !== t))}`, s0); }
    case 'fill-all': return fillAll(ui.planStudent);
    case 'book-open': ui.bookOpen = ui.bookOpen === id ? '' : id; render(); document.querySelector('.bk.open .rr.next')?.scrollIntoView({ block: 'nearest' }); return;
    case 'range-add': { const n = node(id); return openPlanDialog({ nid: id, mid: n.m.id, ...firstFreeSlot(ui.planStudent, typicalDur(ui.planStudent, n.m.id)) }); }
    case 'free-add': return openPlanDialog({ mid: 'free', dur: 60, ...firstFreeSlot(ui.planStudent, 60) });
    case 'pf-mat': { pfRead(); const pf = ui.pf; pf.mid = v; pf.nid = v === 'free' ? null : defaultNode(pf.sid, v); pf.quiz = true; if (!pf.durTouched) pf.dur = v === 'free' ? 60 : typicalDur(pf.sid, v); dlg().innerHTML = planDialogHtml(); return; }
    case 'pf-dur': pfRead(); ui.pf.dur = +v; ui.pf.durTouched = true; dlg().innerHTML = planDialogHtml(); return;
    case 'pf-save-next': return savePlanForm(true);
    case 'sg-apply': { const s0 = snapshot(), list = ui.sugg.filter(s => !ui.suggOff.has(s.key)); list.forEach(s => doPlace('sugg', s.key, s.date, s.time, list)); ui.suggOff.clear();
      const lack = list.filter(s => { const t = state.tasks.find(x => x.student === ui.planStudent && x.node === s.node && x.date === s.date && x.time === s.time); return t && pdfMissing(t); }).length;
      ui.sideTab = 'slot'; ui.blk = null; return commit(`${list.length}件を入れました。小テストは自動で付けています${lack ? `（使える版がない予定が${lack}件）` : ''}`, s0); }
    case 'reply-open': ui.replyOpen = id; render(); document.querySelector(`[data-reply="${id}"] input`)?.focus(); return;
    case 'cmt-filter': ui.cmtFilter = v; ui.sideTab = 'cmt'; return render();
    case 'pick': if (e.target.closest('[data-act="rv-skip"]')) return; ui.picking = ui.picking?.id === id ? null : { k: a.dataset.k, id }; return render();
    case 'pick-cancel': ui.picking = null; return render();
    case 'rv-skip': { e.stopPropagation(); const s0 = snapshot(); state.skips.push(a.dataset.key); ui.picking = null; return commit('今回の再テストは見送りました', s0); }
    case 'sg-open': { const k = a.dataset.key; ui.suggOff.has(k) ? ui.suggOff.delete(k) : ui.suggOff.add(k); return render(); }
    case 'sg-ok': { const s = ui.sugg.find(x => x.key === a.dataset.key); closeDialog(); if (s) place('sugg', s.key, s.date, s.time); return; }
    case 'sg-no': ui.dismissed.add(a.dataset.key); closeDialog(); return render();
    case 'sg-all': { const s0 = snapshot(), list = [...ui.sugg]; list.forEach(s => doPlace('sugg', s.key, s.date, s.time, list)); const lack = tasksOf(ui.planStudent).filter(pdfMissing).length; return commit(`案を${list.length}件置きました${lack ? `（小テストが無い予定が${lack}件）` : '。小テストは自動で付きました'}`, s0); }
    case 'avail-edit': ui.availEdit = !ui.availEdit; ui.picking = null; return render();
    case 'task-pop': { const b = t.status !== 'done' && blockAt(t.student, t.date, toMin(t.time));
      if (b) { ui.blk = b; ui.sideTab = 'slot'; ui.flashTask = t.id; render(); return toSide(); }
      return taskPop(t); }
    case 'pop-dur': { const el = document.querySelector('#pop-dur'); el.textContent = Math.max(10, parseInt(el.textContent) + +v) + '分'; return; }
    case 'pop-save': { const s0 = snapshot(); t.date = document.querySelector('#pop-date').value || t.date; t.time = document.querySelector('#pop-time').value || t.time; t.duration = parseInt(document.querySelector('#pop-dur').textContent); closeDialog(); return commit('保存しました', s0); }
    case 'task-del': { const s0 = snapshot(); state.tasks = state.tasks.filter(x => x !== t); closeDialog(); return commit('削除しました（小テストの版は空きに戻りました）', s0); }
    case 'task-next': closeDialog(); return placeNext(t);
    case 'to-prints': closeDialog(); ui.printTab = 'pdf'; ui.printMat = node(id).m.id; ui.flashNode = id; go('prints'); document.querySelector('#u-' + id)?.scrollIntoView({ block: 'center' }); return;
    case 'book-del': { const s0 = snapshot(); state.books = state.books.filter(b => !(b.student === ui.planStudent && b.material === id)); return commit('参考書を外しました', s0); }
    case 'book-add': { const mid = document.querySelector('#book-add').value; state.books.push({ student: ui.planStudent, material: mid, target: dateAdd(DAY, 90), start: DAY }); return commit(`${mat(mid).name}を追加しました。目標日を決めてください`); }
    case 'print-tab': ui.printTab = v; return render();
    case 'print-mat': ui.printMat = v; return render();
    case 'print-jump': ui.printMat = node(id).m.id; ui.flashNode = id; render(); document.querySelector('#u-' + id)?.scrollIntoView({ block: 'center', behavior: 'smooth' }); return;
    case 'pdf-sample': return stagePdfs(['ターゲット1900_1301-1400_問題.pdf', 'ターゲット1900_1301-1400_解答.pdf', 'ターゲット1900_1401-1500_問題.pdf', 'ターゲット1900_1401-1500_解答.pdf', '古文_古文単語001-050_問題.pdf', '古文_古文単語001-050_解答.pdf', '古文_古文単語051-100_問題.pdf', '古文_古文単語051-100_解答.pdf', '長文トレ_Unit11.pdf', '数学基礎_確率2.pdf', 'スキャン_0012.pdf']
      .map(name => ({ name, type: 'application/pdf', src: /解答/.test(name) ? 'assets/sample-answers.pdf' : 'assets/sample-questions.pdf' })));
    case 'stage-del': ui.stage.splice(+a.dataset.i, 1); return render();
    case 'stage-clear': ui.stage = []; return render();
    case 'stage-save': return saveStage();
    case 'res-del': { const s0 = snapshot(); state.resources = state.resources.filter(d => d.id !== id); return commit('取り下げました', s0); }
    // 運営
    case 'toc-sample': return stageToc(null, ['toc-sample-1.jpg', 'toc-sample-2.jpg']);
    case 'paste-books': return pasteBooks(document.querySelector('#paste-books').value);
    case 'toc-type': ui.toc[+a.dataset.i].type = v; return render();
    case 'toc-del': ui.toc.splice(+a.dataset.i, 1); return render();
    case 'toc-clear': ui.toc = []; return render();
    case 'toc-save': return saveToc();
    case 'mat-open': ui.tocEdit = false; return matDrawer(id);
    case 'm-type': { const fid = a.closest('form').dataset.id, m = mat(fid); m.type = v; m.intervals = v === 'インプット' ? (m.intervals.length ? m.intervals : [1, 7, 30]) : []; save(); render(); return matDrawer(fid); }
    case 'm-toc-edit': ui.tocEdit = !ui.tocEdit; return matDrawer(a.closest('form').dataset.id);
    case 'mat-del': { const s0 = snapshot(); state.materials = state.materials.filter(m => m.id !== id); state.books = state.books.filter(b => b.material !== id); closeDialog(); return commit('削除しました', s0); }

  }
});

/* ---------- 送信 ---------- */
document.addEventListener('submit', e => {
  const f = e.target; e.preventDefault();
  if (f.id === 'done-form') {
    const t = state.tasks.find(x => x.id === f.dataset.id), si = document.querySelector('#score-in');
    let score = null;
    if (si && si.value !== '') { score = Math.round(+si.value); if (!(score >= 0 && score <= +si.max)) return toast(`0〜${si.max}点で入れてください`); }
    closeDialog(); return finish(t, { score, tag: ui.cTag, text: document.querySelector('#ctext').value.trim() });
  }
  if (f.id === 'av-form') {
    const a = state.avail.find(x => x.id === f.dataset.id), s = document.querySelector('#av-s').value, en = document.querySelector('#av-e').value, rep = document.querySelector('#av-rep').checked;
    if (!s || !en || s >= en) return toast('終わりの時刻を始まりより後にしてください');
    const s0 = snapshot(); a.start = s; a.end = en; a.label = ui.avLabel || '';
    if (a.repeat && !rep) { a.repeat = false; a.date = f.dataset.date; delete a.weekday; }
    else if (!a.repeat && rep) { a.repeat = true; a.weekday = dow(a.date); delete a.date; }
    closeDialog(); return commit('保存しました', s0);
  }
  if (f.matches('.chat-in')) { const q = f.q.value.trim(); f.q.value = ''; return sendChat(q); }
  if (f.matches('.reply-in')) {
    const t = state.tasks.find(x => x.id === f.dataset.reply), text = f.querySelector('input').value.trim();
    if (!text) return; t.reply = { text, date: DAY }; ui.replyOpen = null; if (dlg().open) closeDialog(); return commit('返信しました。生徒の「記録」に表示されます');
  }
  if (f.id === 'who-form') {
    const sid = f.dataset.id, c = state.coach[sid], s0 = snapshot();
    f.querySelectorAll('[data-book]').forEach(i => { const b = book(sid, i.dataset.book); if (b && i.value) b.target = i.value; });
    c.message = document.querySelector('#who-msg').value.trim(); c.memo = document.querySelector('#who-memo').value.trim();
    return commit('保存しました', s0);
  }
  if (f.id === 'mat-form') return saveMat(f.dataset.id);
  if (f.id === 'av-add') {
    const d = document.querySelector('#aa-date').value, s = document.querySelector('#aa-s').value, en = document.querySelector('#aa-e').value;
    if (!s || !en || s >= en) return toast('終わりの時刻を始まりより後にしてください');
    closeDialog(); return addAvail(f.dataset.sid, d, s, en);
  }
  if (f.id === 'acc-form') {
    const name = document.querySelector('#acc-name').value.trim(); if (!name) return toast('名前を入れてください');
    const role = document.querySelector('#acc-role').value;
    state.people.push({ id: 'p' + uid(), name, role, grade: document.querySelector('#acc-grade').value.trim(), status: '在籍', ...(role === '生徒' ? { goal: { school: '志望校 未定', faculty: '', date: '2027-02-01' } } : {}) });
    return commit(`${name}さんを追加しました`);
  }
  if (f.id === 'acc-edit') {
    const p = person(f.dataset.id), s0 = snapshot(), role = document.querySelector('#ae-role').value, st = document.querySelector('#ae-status').value;
    if (role === p.role && st === p.status) return closeDialog();
    p.role = role; p.status = st; closeDialog(); return commit(`${p.name}さんを「${role}・${st}」にしました`, s0);
  }
  if (f.id === 'plan-form') return savePlanForm(false);
  if (f.id === 'free-entry') return putFreeEntry();
});

/* ---------- 入力・変更 ---------- */
document.addEventListener('change', async e => {
  const el = e.target;
  if (el.id === 'fe-dur') { ui.feDur = +el.value; return; }
  if (el.id === 'fe-quiz') { ui.feQuiz = el.checked; return; }
  if (el.dataset.fe === 'node') { ui.feNode = el.value; ui.feDur = 0; ui.feQuiz = true; return render(); }
  if (el.dataset.fe === 'other') { ui.feMat = el.value; ui.feNode = null; ui.feDur = 0; ui.feQuiz = true; return render(); }
  if (el.id === 'plan-student') { ui.feMat = ''; ui.feNode = null; ui.feText = ''; ui.planStudent = el.value; ui.picking = null; ui.availEdit = false; return render(); }
  if (el.dataset.files) { const files = [...el.files]; el.value = ''; return onFilesDropped(el.dataset.files, files); }
  if (el.dataset.chatimg) { const f = el.files[0]; if (!f) return; const url = f.size < 1.5e6 ? await readAsDataUrl(f) : URL.createObjectURL(f); const inp = el.closest('form').q; const q = inp.value.trim(); inp.value = ''; el.value = ''; return sendChat(q, url); }
  if (el.dataset.stage != null) { const s = ui.stage[+el.dataset.stage], k = el.dataset.f;
    if (k === 'material') { s.material = el.value || null; s.node = null; s.sure = false; return render(); }
    if (k === 'node') { s.node = el.value || null; s.sure = true; return render(); }
    if (k === 'max') s.max = Math.max(1, +el.value || 20); return; }
  if (el.dataset.toc != null && el.dataset.f === 'subject') ui.toc[+el.dataset.toc].subject = el.value;
  if (el.dataset.pf === 'node') { pfRead(); ui.pf.nid = el.value; ui.pf.quiz = true; dlg().innerHTML = planDialogHtml(); document.querySelector('#pf-node')?.focus(); return; }
  if (el.dataset.pf === 'other') { if (!el.value) return; pfRead(); const pf = ui.pf; pf.mid = el.value; pf.nid = defaultNode(pf.sid, el.value); pf.quiz = true; if (!pf.durTouched) pf.dur = typicalDur(pf.sid, el.value); dlg().innerHTML = planDialogHtml(); return; }
  if (el.dataset.sg) { el.checked ? ui.suggOff.delete(el.dataset.sg) : ui.suggOff.add(el.dataset.sg); return render(); }
});
/* コメントの開閉を覚えておく（描き直しても閉じない） */
document.addEventListener('toggle', e => { const d = e.target; if (d.dataset?.open) ui.open[d.dataset.open] = d.open; if (d.dataset?.cg) d.open ? ui.cmtOpen.add(d.dataset.cg) : ui.cmtOpen.delete(d.dataset.cg); }, true);
document.addEventListener('input', e => {
  const el = e.target;
  if (el.id === 'fe-text') { ui.feText = el.value; ui.feDur = 0; const f = el.closest('form'); const sid = ui.planStudent, g0 = blockGaps(sid, ui.blk)[0]; if (!g0) return;
    const pe = parseFreeEntry(sid, el.value); f.querySelector('.fe-hint').innerHTML = pe ? freeEntryHint(sid, pe) : '<span class="muted">教材の名前を書くと範囲に結びつけて小テストも付きます</span>';
    f.querySelector('button.primary').disabled = !pe;
    const typ = pe?.m ? typicalDur(sid, pe.m.id) : pe?.kind === 'vague' ? pe.v.dur : pe?.kind === 'free' ? 60 : 30, sel = f.querySelector('#fe-dur'); if (sel) sel.value = String(fitDur(g0[1] - g0[0], typ)); return; }
  if (el.dataset.toc != null && el.dataset.f !== 'subject') {
    const x = ui.toc[+el.dataset.toc];
    if (el.dataset.f === 'lines') { x.lines = el.value.split(/\r?\n/); const c = document.querySelector(`[data-count="${el.dataset.toc}"]`); if (c) c.textContent = `${x.lines.filter(s => s.trim()).length}範囲`; }
    else x[el.dataset.f] = el.value;
  }
});
function onFilesDropped(kind, files) {
  if (kind === 'pdf') return stagePdfs(files);
  if (kind === 'res') return addResources(files);
  if (kind === 'toc') return stageToc(files);
}
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && ui.picking) { ui.picking = null; render(); }
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]')) { e.preventDefault(); e.target.click(); }
});

addEventListener('resize', () => { const px = innerWidth <= 600 ? 40 : 48; if (px !== PX) { PX = px; ui.calKey = null; render(); } });
function route() {
  const [r, p] = location.hash.slice(1).split('/');
  if (NAV[r]) { const np = NAV[r].some(n => n[0] === p) ? p : NAV[r][0][0]; if (r !== ui.role || np !== ui.page) ui.week = r === 'teacher' && np === 'plan' ? planWeekDefault() : 0; ui.role = r; ui.page = np; }
  render();
}
window.addEventListener('hashchange', route);
save();
route();
