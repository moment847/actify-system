'use strict';
/* 週カレンダー（生徒の「勉強できる時間」の登録と、講師の計画で同じ部品を使う）
   mode: 'avail' … 勉強できる時間を塗る／直す（生徒の予定、講師が面談で直すとき）
         'plan'  … 講師が学習を置く（空き時間は背景、案は点線） */
const yOf = t => (toMin(t) - H0 * 60) / 60 * PX;
const subjDot = m => `<span class="dot ${m.kind}"></span>`;

/* 時刻の目盛り（6:00 も出す。いちばん上は線の下に置いて切れないようにする） */
const rulerHtml = () => `<div class="ruler" style="height:${(H1 - H0) * PX}px">${Array.from({ length: H1 - H0 }, (_, i) => `<span style="top:${i * PX}px" class="${i ? '' : 'first'}">${H0 + i}:00</span>`).join('')}</div>`;
const dayHead = (d, extra = '') => `<div class="cal-h ${d === DAY ? 'today' : ''} ${d < DAY ? 'past' : ''}"><span>${WD[dow(d)]}</span><strong><b>${+d.slice(8)}</b></strong>${extra}</div>`;
function calendar({ sid, start, mode, sugg = [], gaps = [], blk = null }) {
  const days = weekDays(start);
  return `<div class="cal-wrap card" data-cal="${mode}:${sid}:${start}"><div class="cal" data-mode="${mode}" data-sid="${sid}" style="--px:${PX}px">
    <div class="cal-h corner"></div>
    ${days.map(d => { const am = availOn(sid, d).reduce((a, x) => a + toMin(x.end) - toMin(x.start), 0);
      return dayHead(d, mode === 'avail' ? `<small>${am ? hours(am) : '—'}</small>` : ''); }).join('')}
    ${rulerHtml()}
    ${days.map(d => `<div class="col ${d === DAY ? 'today' : ''} ${d < DAY ? 'past' : ''}" data-date="${d}" style="height:${(H1 - H0) * PX}px">
      ${availOn(sid, d).map(a => { const busy = [...tasksOf(sid).filter(t => t.date === d).map(t => t.time), ...sugg.filter(s => s.date === d).map(s => s.time)].some(x => x >= a.start && x < a.end);
        // 勉強できる時間は背景の色だけ。中に学習が入っていなければ時刻を小さく出す
        return `<div class="av ${mode === 'avail' ? 'edit' : ''}" title="勉強できる時間 ${range(a.start, a.end)}${a.label ? ' ' + esc(a.label) : ''}" ${mode === 'avail' ? `data-act="av-open" data-id="${a.id}" data-date="${d}"` : ''} style="top:${yOf(a.start)}px;height:${yOf(a.end) - yOf(a.start)}px">
        ${busy || mode === 'plan' ? '' : `<span class="av-t">${a.label ? `${esc(a.label)} ` : ''}${range(a.start, a.end)}</span>`}${mode === 'avail' ? `<span class="rs rs-top" data-resize="av:${a.id}"></span><span class="rs" data-resize="av:${a.id}"></span>` : ''}</div>`; }).join('')}
      ${gaps.filter(g => g.date === d).map(g => { const h = (g.e - g.s) / 60 * PX - 2;
        const sel = blk && g.date === blk.date && g.s >= blk.s && g.e <= blk.e;
        return `<div class="gap ${sel ? 'sel' : ''}" role="button" tabindex="0" data-act="gap" data-date="${g.date}" data-s="${g.s}" data-e="${g.e}" style="top:${(g.s - H0 * 60) / 60 * PX + 1}px;height:${h}px" title="${range(toTime(g.s), toTime(g.e))} 空き ${dur(g.e - g.s)}。押すと、この時間に予定を入れられます"><span>空き ${dur(g.e - g.s)}</span></div>`; }).join('')}
      ${blk && blk.date === d ? `<div class="blk-sel" aria-hidden="true" style="top:${(blk.s - H0 * 60) / 60 * PX - 2}px;height:${(blk.e - blk.s) / 60 * PX + 4}px"></div>` : ''}
      ${(() => { const mt = meetingOn(sid, d); return mt ? `<div class="mt" ${mode === 'avail' ? 'data-act="meet-open" role="button" tabindex="0"' : ''} title="面談 ${meetLabel(mt)}" style="top:${yOf(mt.time)}px;height:${Math.max(18, mt.len / 60 * PX - 2)}px"><span>${mt.time} 面談</span></div>` : ''; })()}
      ${tasksOf(sid).filter(t => t.date === d).sort(byTime).map(t => taskBlock(t, mode, blk)).join('')}
      ${sugg.filter(s => s.date === d).map(s => `<div class="sg ${s.mat.kind} ${s.off ? 'off' : ''}" role="button" tabindex="0" draggable="true" data-act="sg-open" data-key="${s.key}" data-drag="sugg:${s.key}" data-hover="sugg:${s.key}" title="押すと入れる／入れないを切り替え" style="top:${yOf(s.time)}px;height:${Math.max(18, s.dur / 60 * PX - 2)}px">
        <span class="sg-t">${s.off ? '' : '✓ '}${esc(s.mat.short)}</span></div>`).join('')}
    </div>`).join('')}
  </div></div>`;
}
/* カレンダーを開いたときの位置：その週でいちばん早い予定・勉強できる時間の少し上へ。
   スマホは3日ずつ見えるので、今日が入っている週は今日の列から見せる */
function calInitScroll() {
  const w = document.querySelector('.cal-wrap'); if (!w) return;
  const key = w.dataset.cal || '';
  if (ui.calKey === key) return; ui.calKey = key;
  const today = w.querySelector('.col.today'), ruler = w.querySelector('.ruler');
  const scrollsX = w.scrollWidth > w.clientWidth + 4;
  w.scrollLeft = today && scrollsX ? today.offsetLeft - (ruler?.offsetWidth || 0) : 0;
  if (w.scrollHeight <= w.clientHeight + 4) return; // パソコンはカレンダー全体を出すので、縦の位置合わせは要らない
  // 見えている列のうち、まだ終わっていない予定 → 勉強できる時間 の順で、いちばん早い所の少し上へ
  const left = w.scrollLeft, right = left + w.clientWidth;
  const cols = [...w.querySelectorAll('.col')].filter(c => c.offsetLeft + c.offsetWidth > left + 4 && c.offsetLeft < right - 4);
  const pick = sel => cols.flatMap(c => [...c.querySelectorAll(sel)]).map(e => e.offsetTop);
  const ys = pick('.ev:not(.done)').length ? pick('.ev:not(.done)') : pick('.av,.ev,.mt,.gap');
  w.scrollTop = ys.length ? Math.max(0, Math.min(...ys) - PX / 2) : (18 - H0) * PX;
}
/* 予定のブロック：文字は教材名だけ（講師）。生徒は高さがあれば範囲も */
function taskBlock(t, mode, blk) {
  const m = mat(t.material), done = t.status === 'done', h = Math.max(18, t.duration / 60 * PX - 2);
  const title = `${range(t.time, toTime(toMin(t.time) + t.duration))} ${t.title || m.name} ${t.title ? '' : node(t.node).label}${t.retest ? '（再テスト）' : ''}`;
  if (mode === 'plan') {
    const warn = !done && (pdfMissing(t) || isMissed(t) || !inAvail(t));
    return `<div class="ev ${t.vague ? 'vague ' + t.vague : m.kind} ${done ? 'done' : ''} ${blk && inBlock(t, blk) ? 'in-sel' : ''}" role="button" tabindex="0" ${done ? '' : 'draggable="true"'} data-drag="task:${t.id}" data-act="task-pop" data-id="${t.id}" data-hover="task:${t.id}" aria-label="${esc(title)}" title="${esc(title)}。端をつかむと長さを変えられます" style="top:${yOf(t.time)}px;height:${h}px">
      <span class="ev-t">${done ? '✓ ' : ''}${esc(t.title || m.short)}</span>${h >= 40 && !t.title ? `<small>${esc(node(t.node).label)}</small>` : ''}${t.pdf ? '<i class="ev-q" title="小テスト付き"></i>' : ''}${warn ? '<i class="ev-dot" title="要確認：小テストなし・勉強できる時間の外・やり残しのどれか"></i>' : ''}${done ? '' : `<span class="rs rs-top" data-resize="task:${t.id}" title="上の端：始まりを変える"></span><span class="rs" data-resize="task:${t.id}" title="下の端：引き伸ばす"></span>`}</div>`;
  }
  return `<div class="ev ${t.vague ? 'vague ' + t.vague : m.kind} ${done ? 'done' : ''}" role="button" tabindex="0" data-act="task-open" data-id="${t.id}" title="${esc(title)}" style="top:${yOf(t.time)}px;height:${h}px"><span class="ev-t">${done ? '✓ ' : ''}${esc(t.title || m.short)}</span>${h >= 40 && !t.title ? `<small>${esc(node(t.node).label)}</small>` : ''}${isMissed(t) ? '<i class="ev-dot"></i>' : ''}</div>`;
}
function timeFromY(col, clientY) {
  const r = col.getBoundingClientRect();
  return clamp(snap(H0 * 60 + (clientY - r.top) / PX * 60), H0 * 60, H1 * 60 - 15);
}

/* ---------- 勉強できる時間：なぞって作る・端を引っぱって長さを変える ---------- */
let press = null;
document.addEventListener('pointerdown', e => {
  const rs = e.target.closest('[data-resize]');
  if (rs) { // 端をつかんで引き伸ばす（下の端＝終わりを変える、上の端＝始まりを変える）
    e.preventDefault(); e.stopPropagation();
    const el = rs.parentElement, [k, id] = rs.dataset.resize.split(':'), edge = rs.classList.contains('rs-top') ? 'top' : 'bottom';
    el.setAttribute('draggable', 'false'); el.classList.add('resizing');
    let lbl = el.querySelector('.rs-lbl'); if (!lbl) { lbl = document.createElement('span'); lbl.className = 'rs-lbl'; el.appendChild(lbl); }
    press = { type: 'resize', k, id, el, edge, y0: e.clientY, h0: el.offsetHeight, top0: el.offsetTop, lbl };
    rs.setPointerCapture(e.pointerId); return;
  }
  const col = e.target.closest('.cal[data-mode="avail"] .col, .cal[data-mode="coach"] .col');
  if (col && !e.target.closest('.av,.ev,.mt') && e.button === 0) {
    press = { type: 'paint', col, y0: e.clientY, x0: e.clientX, m0: timeFromY(col, e.clientY), touch: e.pointerType !== 'mouse', moved: false };
    if (!press.touch) e.preventDefault();
  }
  // 講師の計画：空いている所をドラッグ（クリック）して予定を追加
  const pcol = e.target.closest('.cal[data-mode="plan"] .col');
  if (pcol && !e.target.closest('.ev,.sg,.gap') && e.button === 0 && !ui.picking) {
    press = { type: 'create', col: pcol, y0: e.clientY, x0: e.clientX, m0: timeFromY(pcol, e.clientY), touch: e.pointerType !== 'mouse', moved: false };
    if (!press.touch) e.preventDefault();
  }
  // 長押しでコメントを見る（タッチ端末）
  const hv = e.target.closest('[data-hover]');
  if (hv && e.pointerType !== 'mouse') { clearTimeout(ui.lpTimer); ui.lpTimer = setTimeout(() => { ui.suppressClick = true; showPop(hv); }, 450); }
});
document.addEventListener('pointermove', e => {
  if (ui.lpTimer && e.pointerType !== 'mouse' && press?.type !== 'resize') { /* 動かしたら長押しではない */ }
  if (!press) return;
  if (press.type === 'resize') {
    const dy = e.clientY - press.y0, step = press.k === 'task' ? 5 : 15;
    let top = press.top0, h = press.h0;
    if (press.edge === 'top') { const nt = snap((press.top0 + dy) / PX * 60, step) / 60 * PX; top = Math.max(0, Math.min(nt, press.top0 + press.h0 - PX / 4)); h = press.top0 + press.h0 - top; }
    else h = Math.max(PX / 4, snap((press.h0 + dy) / PX * 60, step) / 60 * PX);
    press.el.style.top = top + 'px'; press.el.style.height = h + 'px';
    const a = H0 * 60 + Math.round(top / PX * 60), b = a + Math.round(h / PX * 60);
    press.lbl.textContent = `${range(toTime(a), toTime(b))} · ${dur(b - a)}`; return;
  }
  if (press.touch) { if (Math.abs(e.clientY - press.y0) > 8 || Math.abs(e.clientX - press.x0) > 8) { press.moved = true; } return; } // スクロール
  if (Math.abs(e.clientY - press.y0) < 6) return;
  press.moved = true;
  const m1 = timeFromY(press.col, e.clientY), a = Math.min(press.m0, m1), b = Math.max(press.m0, m1) + 15;
  let g = press.col.querySelector('.av-ghost'); if (!g) { g = document.createElement('div'); g.className = 'av-ghost' + (press.type === 'create' ? ' new' : ''); press.col.appendChild(g); }
  g.style.top = (a - H0 * 60) / 60 * PX + 'px'; g.style.height = (b - a) / 60 * PX + 'px'; g.textContent = range(toTime(a), toTime(b));
});
document.addEventListener('pointerup', e => {
  clearTimeout(ui.lpTimer);
  if (!press) return;
  const p = press; press = null;
  if (p.type === 'resize') {
    p.el.classList.remove('resizing'); p.lbl?.remove();
    const st = p.k === 'task' ? 5 : 15, start = H0 * 60 + snap(p.el.offsetTop / PX * 60, st), minutes = Math.max(p.k === 'task' ? 10 : 15, snap(p.el.offsetHeight / PX * 60, st)), end = Math.min(H1 * 60, start + minutes);
    if (p.k === 'task') { const t = state.tasks.find(x => x.id === p.id), snap0 = snapshot();
      if (t.duration !== end - start || toMin(t.time) !== start) { t.time = toTime(start); t.duration = end - start; return commit(`${t.time}〜 ${dur(t.duration)}にしました`, snap0); } }
    else if (p.k === 'co') { const o = state.coachOpen.find(x => x.id === p.id), snap0 = snapshot();
      if (o.start !== toTime(start) || o.end !== toTime(end)) { o.start = toTime(start); o.end = toTime(end); return commit(`${range(o.start, o.end)} にしました`, snap0); } }
    else { const a = state.avail.find(x => x.id === p.id), snap0 = snapshot();
      if (a.start !== toTime(start) || a.end !== toTime(end)) { a.start = toTime(start); a.end = toTime(end); return commit(`${range(a.start, a.end)} にしました${a.repeat ? '（毎週）' : ''}`, snap0); } }
    return render();
  }
  if (p.type === 'create') {
    p.col.querySelector('.av-ghost')?.remove();
    if (p.touch && p.moved) return;
    let a = p.m0, len = null;
    if (p.moved) { const m1 = timeFromY(p.col, e.clientY); a = Math.min(p.m0, m1); len = Math.max(15, Math.max(p.m0, m1) + 15 - a); }
    return openPlanDialog({ sid: p.col.closest('.cal').dataset.sid, date: p.col.dataset.date, time: toTime(a), dur: len });
  }
  if (p.type === 'paint') {
    p.col.querySelector('.av-ghost')?.remove();
    if (p.touch && p.moved) return; // スクロールしただけ
    let a = p.m0, b = p.m0 + 60;
    if (p.moved) { const m1 = timeFromY(p.col, e.clientY); a = Math.min(p.m0, m1); b = Math.max(p.m0, m1) + 15; }
    if (p.col.closest('.cal').dataset.mode === 'coach') return addCoachOpen(p.col.dataset.date, toTime(a), toTime(Math.min(b, H1 * 60)));
    addAvail(p.col.closest('.cal').dataset.sid, p.col.dataset.date, toTime(a), toTime(Math.min(b, H1 * 60)));
  }
});
function addAvail(sid, date, start, end) {
  // 同じ日の重なる枠はまとめる。登録は「この週だけ」（毎週にしたいときは通知のボタンか、枠を押して切り替え）
  const same = state.avail.filter(a => a.student === sid && !a.repeat && a.date === date && toMin(a.start) <= toMin(end) && toMin(a.end) >= toMin(start)), s0 = snapshot();
  let s = start, e = end, label = '';
  same.forEach(a => { if (a.start < s) s = a.start; if (a.end > e) e = a.end; label ||= a.label; });
  state.avail = state.avail.filter(a => !same.includes(a));
  const a = { id: uid(), student: sid, date, start: s, end: e, label };
  state.avail.push(a);
  save(); render();
  toast(`${mdw(date)} ${range(s, e)} を勉強できる時間にしました`, { label: '毎週にする', fn: () => { a.repeat = true; a.weekday = dow(date); delete a.date; save(); render(); toast(`毎週${WD[a.weekday]}曜 ${range(s, e)} にしました（枠を押せば戻せます）`); } });
}

/* ---------- 講師の計画：ドラッグで置く ---------- */
let dragging = null;
document.addEventListener('dragstart', e => {
  const d = e.target.closest('[data-drag]'); if (!d) return;
  hidePop();
  const i = d.dataset.drag.indexOf(':'); dragging = { k: d.dataset.drag.slice(0, i), id: d.dataset.drag.slice(i + 1) };
  e.dataTransfer.setData('text/plain', d.dataset.drag); e.dataTransfer.effectAllowed = 'move';
});
document.addEventListener('dragend', () => { dragging = null; document.querySelectorAll('.col.drop').forEach(c => c.classList.remove('drop')); document.querySelector('.drop-ghost')?.remove(); });
function dragMinutes(k, id) {
  if (k === 'task') return state.tasks.find(t => t.id === id)?.duration || 30;
  if (k === 'sugg') return ui.sugg.find(s => s.key === id)?.dur || 30;
  if (k === 'review') { const r = reviewQueue(ui.planStudent).find(x => x.key === id); return r ? typicalDur(ui.planStudent, r.mat.id) : 30; }
  if (k === 'node') return typicalDur(ui.planStudent, node(id).m.id);
  return 30;
}
document.addEventListener('dragover', e => {
  const dz = e.target.closest('[data-dropzone]');
  if (dz) { e.preventDefault(); dz.classList.add('over'); return; }
  const col = e.target.closest('.cal[data-mode="plan"] .col');
  if (!col || !dragging) return;
  e.preventDefault();
  document.querySelectorAll('.col.drop').forEach(c => c !== col && c.classList.remove('drop')); col.classList.add('drop');
  let m = timeFromY(col, e.clientY), len = dragMinutes(dragging.k, dragging.id);
  const fit = gapAt(ui.planStudent, col.dataset.date, m);
  if (fit) { m = fit.s; len = fitDur(fit.e - fit.s, len); }   // 空きの上なら、空きの頭にそろえて枠の長さに合わせる
  let g = document.querySelector('.drop-ghost'); if (!g) { g = document.createElement('div'); g.className = 'drop-ghost'; }
  if (g.parentElement !== col) col.appendChild(g);
  g.style.top = (m - H0 * 60) / 60 * PX + 'px'; g.style.height = len / 60 * PX + 'px'; g.textContent = `${toTime(m)}〜 ${dur(len)}${fit ? '（枠に合わせる）' : ''}`;
});
document.addEventListener('dragleave', e => { const dz = e.target.closest?.('[data-dropzone]'); if (dz && !dz.contains(e.relatedTarget)) dz.classList.remove('over'); });
document.addEventListener('drop', e => {
  const dz = e.target.closest('[data-dropzone]');
  if (dz) { e.preventDefault(); dz.classList.remove('over'); if (e.dataTransfer.files.length) onFilesDropped(dz.dataset.dropzone, [...e.dataTransfer.files], dz); return; }
  const col = e.target.closest('.cal[data-mode="plan"] .col'); if (!col || !dragging) return;
  e.preventDefault(); const d = dragging; dragging = null; document.querySelector('.drop-ghost')?.remove();
  place(d.k, d.id, col.dataset.date, toTime(timeFromY(col, e.clientY)));
});
window.addEventListener('dragover', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });
window.addEventListener('drop', e => { if (e.dataTransfer?.types?.includes('Files')) e.preventDefault(); });

/* 置く（ドラッグ・押して置く・案の✓・案をすべて置く が全部ここを通る） */
function doPlace(k, id, date, time, suggList = ui.sugg) {
  const sid = ui.planStudent;
  const newTask = (nid, extra = {}) => {
    const n = node(nid), p = freePdf(sid, nid);
    const x = { id: uid(), student: sid, date, time, duration: extra.duration || typicalDur(sid, n.m.id), material: n.m.id, node: nid, status: 'todo', pdf: p?.id || null, ...(p ? { max: p.max } : {}),
      retest: state.tasks.some(o => o.student === sid && o.node === nid && o.status === 'done') };
    state.tasks.push(x); return x;
  };
  if (k === 'sugg') {
    const s = suggList.find(x => x.key === id); if (!s) return null;
    if (s.kind === 'move') { s.task.date = date; s.task.time = time; return state.tasks.find(x => x.id === s.task.id) || null; }
    return newTask(s.node, { duration: s.dur });
  }
  if (k === 'review') { const r = reviewQueue(sid).find(x => x.key === id); return r ? newTask(r.node) : null; }
  if (k === 'node') return newTask(id);
  if (k === 'task') { const t = state.tasks.find(x => x.id === id); if (!t || t.status === 'done') return null; t.date = date; t.time = time; return t; }
  return null;
}
/* その時刻を含む空き。空きの頭から20分以内なら頭にそろえる */
function gapAt(sid, date, m) {
  if (date <= DAY) return null;
  const g = freeGaps(sid, date, {}).find(([s, e]) => m >= s && m < e && e - s >= MIN_GAP);
  if (!g) return null;
  const s = m - g[0] < 20 ? g[0] : Math.ceil(m / 5) * 5;
  return g[1] - s >= MIN_GAP ? { date, s, e: g[1] } : { date, s: g[0], e: g[1] };
}
function place(k, id, date, time) {
  const sid = ui.planStudent, fit = (k === 'node' || k === 'review' || k === 'task') && gapAt(sid, date, toMin(time));
  if (fit) { // 空きに落としたら枠に合わせて入れる
    const s0 = snapshot(), t = fillGap(sid, fit, k, id); ui.picking = null; if (!t) return render();
    ui.blk = blockAt(sid, t.date, toMin(t.time)) || ui.blk;
    return commit(`${mdw(t.date)} ${t.time}〜 ${dur(t.duration)} ${mat(t.material).short} ${node(t.node).label}${t.pdf ? ` · 小テスト第${pdfOf(t).version}版` : pdfMissing(t) ? ' · 使える小テストなし' : ''}`, s0);
  }
  const snap0 = snapshot(), t = doPlace(k, id, date, time);
  ui.picking = null;
  if (!t) return render();
  let msg = `${mdw(date)} ${time} ${mat(t.material).short} ${node(t.node).label}`;
  if (pdfMissing(t)) msg += ' · この生徒が使っていない小テストがありません（小テスト画面で追加）';
  else if (!inAvail(t)) msg += ' · 勉強できる時間の外です';
  else if (t.pdf) msg += ` · 小テスト第${pdfOf(t).version}版を付けました`;
  commit(msg, snap0);
}

/* ---------- ふれると出る小窓（講師）：その教材の生徒のコメント ---------- */
document.addEventListener('mouseover', e => {
  const hv = e.target.closest('[data-hover]');
  if (!hv || dragging || press) return;
  if (ui.popFor === hv) return;
  clearTimeout(ui.popTimer); ui.popTimer = setTimeout(() => showPop(hv), 280);
});
document.addEventListener('mouseout', e => {
  const hv = e.target.closest('[data-hover]'); if (!hv) return;
  if (hv.contains(e.relatedTarget) || e.relatedTarget?.closest?.('#pop')) return;
  clearTimeout(ui.popTimer); ui.popHide = setTimeout(hidePop, 200);
});
function hidePop() { clearTimeout(ui.popTimer); const p = document.querySelector('#pop'); p.classList.remove('show'); ui.popFor = null; }
function showPop(hv) {
  const [k, ...rest] = hv.dataset.hover.split(':'), id = rest.join(':'), sid = ui.planStudent;
  let nid, t, head = '';
  if (k === 'task') { t = state.tasks.find(x => x.id === id); if (!t) return; nid = t.node; }
  else if (k === 'sugg') { const s = ui.sugg.find(x => x.key === id); if (!s) return; nid = s.node; head = `<p class="pop-m">自動の案：${esc(s.why)} · ${dur(s.dur)}</p>`; }
  else if (k === 'review') { const r = reviewQueue(sid).find(x => x.key === id); if (!r) return; nid = r.node; }
  else if (k === 'node') nid = id;
  const n = node(nid), hist = tasksOf(sid).filter(x => x.node === nid && x.status === 'done').sort(byTime);
  const p = t?.pdf ? pdfOf(t) : freePdf(sid, nid);
  const cm = commentsOf(sid, n.m.id).slice(0, 5);
  const pop = document.querySelector('#pop');
  const pdfText = t?.status === 'done' ? `完了${t.score != null ? ` ${t.score}/${t.max}` : ''}` : p ? `小テスト 第${p.version}版` : needsPdf(nid) ? '<span class="amber-t">使っていない小テストなし</span>' : '小テストなし';
  pop.innerHTML = `<p class="pop-t">${esc(n.m.short)} ${esc(n.label)}</p>
    <p class="pop-m">${t ? `${mdw(t.date)} ${t.time}〜 ${dur(t.duration)} · ` : ''}${pdfText}${hist.length ? ` · 前回 ${hist.at(-1).score != null ? pct(hist.at(-1).score, hist.at(-1).max) + '%' : md(hist.at(-1).date)}` : ' · 初めて'}</p>${head}
    <div class="pop-c">${cm.slice(0, 3).map(x => `<div class="cmt"><p class="pop-m">${md(x.date)} · ${esc(node(x.node).label)}</p><p><span class="tag t${TAGS.indexOf(x.comment.tag)}">${esc(x.comment.tag)}</span> ${esc(x.comment.text)}</p></div>`).join('') || '<p class="pop-m">この教材へのコメントはまだありません</p>'}</div>`;
  const r = hv.getBoundingClientRect(), w = 300;
  let x = r.right + 10; if (x + w > innerWidth - 8) x = Math.max(8, r.left - w - 10);
  pop.style.left = x + 'px'; pop.style.top = clamp(r.top, 8, innerHeight - 340) + 'px';
  pop.classList.add('show'); ui.popFor = hv;
}
