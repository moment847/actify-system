'use strict';
/* ---------- 運営の画面 ---------- */

/* 教材：目次の写真から登録（まとめてOK）→ 一覧 → 押すと詳細 */
function aMaterials() {
  return `<div class="head"><h1>教材</h1></div>
  <section class="card upl"><label class="dropzone" data-dropzone="toc"><span class="dz-ic">${ic('image', 24)}</span><strong>目次ページの写真をまとめて置く</strong>
      <span class="muted">1枚につき1冊。スマホで撮った写真やスキャンで大丈夫です。文字を読み取って、範囲の一覧にします。</span>
      <span class="btn primary">写真を選ぶ</span><input type="file" accept="image/*" multiple hidden data-files="toc"></label>
    <div class="upl-side"><button class="btn sm" data-act="toc-sample">サンプルの目次で試す</button>
      <details class="plain"><summary>Excelの表から貼り付ける</summary><p class="muted">「教材名」「範囲」の2列をコピーして貼り付けてください。何冊分でも一度に入ります。</p><textarea id="paste-books" placeholder="英熟語1000	Part 1 001–100&#10;英熟語1000	Part 1 101–200"></textarea><button class="btn sm" data-act="paste-books">読み込む</button></details></div></section>
  ${tocStage()}
  <section class="card sec"><div class="ch"><h2>登録済みの教材 <span class="count">${visibleMats().length}冊</span></h2></div>
    <div class="scroll"><table class="mats cardify"><thead><tr><th>教材</th><th>種類</th><th>範囲</th><th>小テストの登録</th><th>使っている生徒</th><th></th></tr></thead><tbody>
    ${visibleMats().map(m => { const cov = m.nodes.filter(n => pdfsOf(n.id).length).length, us = students().filter(p => book(p.id, m.id)).length;
      return `<tr class="click" data-act="mat-open" data-id="${m.id}"><td><div class="mat-name"><span class="subj ${m.kind}"></span><div><strong>${esc(m.name)}</strong><div class="muted">${m.subject}</div></div></div></td>
        <td data-label="種類">${m.type}</td><td class="num" data-label="範囲">${m.nodes.length}</td>
        <td data-label="小テスト"><span class="num">${cov}/${m.nodes.length}範囲</span></td><td class="num" data-label="生徒">${us}人</td><td class="chev-cell">${ic('right', 16)}</td></tr>`; }).join('')}
    </tbody></table></div></section>`;
}
function tocStage() {
  if (!ui.toc.length) return '';
  return `<section class="card sec"><div class="ch"><h2>読み取った目次の確認</h2><span class="muted">${ui.toc.length}冊 · 直してから登録してください</span></div>
    <div class="toc-list">${ui.toc.map((e, i) => `<div class="toc-item">
      ${e.img ? `<a class="toc-img" href="${esc(e.imgUrl)}" target="_blank" rel="noopener"><img src="${esc(e.imgUrl)}" alt="目次の写真"></a>` : '<div class="toc-img none">表から</div>'}
      <div class="toc-f">
        <div class="toc-row"><label>教材名<input data-toc="${i}" data-f="name" value="${esc(e.name)}"></label>
          <label>科目<select data-toc="${i}" data-f="subject">${Object.keys(SUBJECTS).map(s => `<option ${e.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
          <div class="lbl">種類<div class="typeseg">${['インプット', '演習'].map(x => `<button type="button" data-act="toc-type" data-i="${i}" data-v="${x}" class="${e.type === x ? 'on' : ''}">${x}</button>`).join('')}</div></div></div>
        <label>目次（1行＝1範囲）<span class="muted" data-count="${i}">${e.lines.filter(Boolean).length}範囲</span>
          <textarea data-toc="${i}" data-f="lines" rows="6" placeholder="${e.unread ? '範囲を1行ずつ入れてください' : ''}">${esc(e.lines.join('\n'))}</textarea></label>
        ${e.unread ? '<p class="amber-t">この試作版では、サンプル以外の写真の文字はまだ読めません</p>' : ''}
      </div><button class="icon-btn" data-act="toc-del" data-i="${i}" aria-label="外す">${ic('close', 15)}</button></div>`).join('')}</div>
    <div class="dl-foot pad2"><button class="btn ghost" data-act="toc-clear">やめる</button><button class="btn primary" data-act="toc-save">${ui.toc.length}冊を登録</button></div></section>`;
}
async function stageToc(files, samples) {
  if (samples) { ui.toc.push(...samples.map(f => { const s = TOC_SAMPLES[f]; return { img: true, imgUrl: fileUrl('assets/' + f), src: 'assets/' + f, name: s.name, subject: s.subject, type: s.type, lines: [...s.lines] }; })); return render(); }
  for (const f of files.filter(f => /^image\//.test(f.type))) {
    const s = TOC_SAMPLES[f.name], data = f.size <= 1.5 * 1024 * 1024 ? await readAsDataUrl(f) : null;
    const url = data || URL.createObjectURL(f);
    ui.toc.push(s ? { img: true, imgUrl: url, src: data, name: s.name, subject: s.subject, type: s.type, lines: [...s.lines] }
      : { img: true, imgUrl: url, src: data, name: f.name.replace(/\.[^.]+$/, ''), subject: '英語', type: 'インプット', lines: [], unread: true });
  }
  render();
}
function pasteBooks(text) {
  const by = new Map();
  text.split(/\r?\n/).map(l => l.split('\t')).filter(c => c[0]?.trim() && c[1]?.trim()).forEach(([n, r]) => { n = n.trim(); if (!by.has(n)) by.set(n, []); by.get(n).push(r.trim()); });
  if (!by.size) return toast('「教材名」「範囲」の2列を貼り付けてください');
  by.forEach((lines, name) => ui.toc.push({ img: false, name, subject: '英語', type: 'インプット', lines }));
  render();
}
function saveToc() {
  const bad = ui.toc.find(e => !e.name.trim() || !e.lines.filter(Boolean).length);
  if (bad) return toast(`「${bad.name || '名前なし'}」の教材名か目次が空です`);
  const snap0 = snapshot();
  ui.toc.forEach(e => {
    const id = 'm' + uid();
    state.materials.push({ id, name: e.name.trim(), short: e.name.trim().slice(0, 8), subject: e.subject, kind: SUBJECTS[e.subject], type: e.type, intervals: e.type === 'インプット' ? [1, 7, 30] : [], keys: [], toc: e.src ? { image: e.src } : null,
      nodes: e.lines.map(s => s.trim()).filter(Boolean).map((label, i) => ({ id: `${id}-${i + 1}`, label })) });
  });
  const n = ui.toc.length; ui.toc = []; commit(`${n}冊を登録しました。講師の計画と小テストの振り分けで使えます`, snap0);
}
function matDrawer(id) {
  const m = mat(id), used = state.tasks.some(t => t.material === id) || state.pdfs.some(p => node(p.node).m.id === id);
  const cov = m.nodes.filter(n => pdfsOf(n.id).length).length, us = students().filter(p => book(p.id, m.id));
  openDialog(`<form class="dl" id="mat-form" data-id="${id}"><div class="dl-h"><div><h2>${esc(m.name)}</h2><p class="muted">${m.subject} · ${m.nodes.length}範囲</p></div>${closeBtn}</div>
    <div class="toc-row two"><label>教材名<input id="m-name" value="${esc(m.name)}"></label><label>略称（一覧で使う）<input id="m-short" value="${esc(m.short)}"></label></div>
    <div class="toc-row"><label>科目<select id="m-subject">${Object.keys(SUBJECTS).map(s => `<option ${m.subject === s ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <div class="lbl">種類<div class="typeseg">${['インプット', '演習'].map(x => `<button type="button" data-act="m-type" data-v="${x}" class="${m.type === x ? 'on' : ''}">${x}</button>`).join('')}</div></div>
      <label>再テストの間隔（日）<input id="m-int" value="${m.intervals.join(', ')}" ${m.type === '演習' ? 'disabled placeholder="演習は出しません"' : ''}></label></div>
    <p class="muted">インプットは覚える教材で、点数から再テストの時期を出します。演習は解く教材で、再テストは出しません。</p>
    <div><div class="section-t split">目次 <button type="button" class="link" data-act="m-toc-edit">${ui.tocEdit ? '一覧に戻す' : '目次を直す'}</button></div>
      ${ui.tocEdit ? `<textarea id="m-lines" rows="12">${esc(m.nodes.map(n => n.label).join('\n'))}</textarea><p class="muted">1行＝1範囲。予定や小テストで使っている範囲は、行を消せません（名前は直せます）。</p>`
        : `<div class="toc-view">${m.toc?.image ? `<a href="${esc(fileUrl(m.toc.image))}" target="_blank" rel="noopener"><img src="${esc(fileUrl(m.toc.image))}" alt="目次の写真"></a>` : ''}<ol>${m.nodes.map(n => `<li>${esc(n.label)}${pdfsOf(n.id).length ? ` <span class="muted">PDF${pdfsOf(n.id).length}</span>` : ''}</li>`).join('')}</ol></div>`}</div>
    <p class="sub">小テスト：${cov}/${m.nodes.length}範囲に登録済み（登録は講師の「小テスト」画面）· 使っている生徒：${us.map(p => esc(p.name)).join('、') || 'なし'}</p>
    <div class="dl-foot">${used ? '' : `<button type="button" class="btn danger" data-act="mat-del" data-id="${id}">削除</button>`}<button class="btn primary">保存</button></div></form>`, true);
}
function saveMat(id) {
  const m = mat(id), snap0 = snapshot();
  m.name = document.querySelector('#m-name').value.trim() || m.name;
  m.short = document.querySelector('#m-short').value.trim() || m.short;
  m.subject = document.querySelector('#m-subject').value; m.kind = SUBJECTS[m.subject];
  if (m.type === 'インプット') m.intervals = document.querySelector('#m-int').value.split(/[,、\s]+/).map(Number).filter(n => n > 0);
  const ta = document.querySelector('#m-lines');
  if (ta) {
    const lines = ta.value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
    const removed = m.nodes.slice(lines.length);
    const blocked = removed.find(n => state.tasks.some(t => t.node === n.id) || pdfsOf(n.id).length);
    if (blocked) return toast(`「${blocked.label}」は使われているので消せません`);
    m.nodes = lines.map((label, i) => m.nodes[i] ? { ...m.nodes[i], label } : { id: `${id}-${uid()}`, label });
  }
  ui.tocEdit = false; closeDialog(); commit('保存しました', snap0);
}

function aAccounts() {
  return `<div class="head"><h1>アカウント</h1></div>
  <section class="card"><div class="scroll"><table class="accounts cardify"><thead><tr><th>名前</th><th>役割</th><th>学年・担当</th><th>状態</th><th></th></tr></thead><tbody>
  ${state.people.map(p => `<tr><td><strong>${esc(p.name)}</strong></td><td>${esc(p.role)}</td><td>${esc(p.grade || '—')}</td>
    <td>${p.status === '在籍' ? '在籍' : `<span class="amber-t">${esc(p.status)}</span>`}</td><td class="r"><button class="btn sm ghost" data-act="acc-edit" data-id="${p.id}">変更</button></td></tr>`).join('')}
  </tbody></table></div>
  <form class="acc-add" id="acc-form"><label>名前<input id="acc-name" placeholder="山田 太郎"></label><label>役割<select id="acc-role"><option>生徒</option><option>講師</option><option>運営</option></select></label><label>学年・担当<input id="acc-grade" placeholder="高校2年"></label><button class="btn primary">追加</button></form></section>`;
}
function accDialog(id) {
  const p = person(id);
  openDialog(`<form class="dl" id="acc-edit" data-id="${id}"><div class="dl-h"><div><h2>${esc(p.name)}</h2><p class="muted">役割と状態を変えます</p></div>${closeBtn}</div>
    <label>役割<select id="ae-role">${['生徒', '講師', '運営', '保護者'].map(r => `<option ${p.role === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <label>状態<select id="ae-status">${['在籍', '休会', '退会'].map(r => `<option ${p.status === r ? 'selected' : ''}>${r}</option>`).join('')}</select></label>
    <p class="muted">役割を変えると、その人が見られる画面が変わります。退会にすると、講師の担当一覧から外れます。</p>
    <div class="dl-foot"><button type="button" class="btn ghost" data-act="close">やめる</button><button class="btn primary">保存</button></div></form>`);
}
