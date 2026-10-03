'use strict';
/* Actify モック v17 — 共通の小道具
   日付は 2026-10-02（金）に固定。データはブラウザ内（localStorage）だけに保存する。 */
const DAY = '2026-10-02', STORAGE = 'actify-mock-v8', ME = 's1';
const H0 = 6, H1 = 24; // カレンダー: 6:00〜24:00
let PX = innerWidth <= 600 ? 40 : 48; // 1時間の高さ（スマホでも30分の枠に1行の文字が入る高さ）
const asset = p => window.ACTIFY_ASSETS?.[p] || p;

const P = {
  home: 'M3 10l9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z',
  cal: 'M8 2v4m8-4v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2',
  chart: 'M4 3v17h17M8 15v-4m5 4V7m5 8v-6', folder: 'M3 5h6l2 3h10v12H3z',
  book: 'M12 6C8 3 5 3 2 4v15c4-1 7 0 10 2 3-2 6-3 10-2V4c-3-1-6-1-10 2zm0 0v15',
  users: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2m20 0v-2a4 4 0 0 0-3-3.9M13 4a4 4 0 0 1 0 8M13 8a4 4 0 1 1-8 0 4 4 0 0 1 8 0',
  pause: 'M9 5v14M15 5v14', stop: 'M7 7h10v10H7z', download: 'M12 3v12m-5-5 5 5 5-5M4 20h16', link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
  swap: 'M4 8h15m-4-4 4 4-4 4M20 16H5m4-4-4 4 4 4', check: 'm5 12 4 4L19 6', play: 'm8 4 12 8-12 8z', plus: 'M12 5v14M5 12h14', close: 'm6 6 12 12M6 18 18 6',
  left: 'm15 5-7 7 7 7', right: 'm9 5 7 7-7 7', file: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zm0 0v6h6',
  clock: 'M12 8v5l3 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0',
  grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01', upload: 'M12 16V3m-5 5 5-5 5 5M3 16v5h18v-5',
  alert: 'M12 9v4m0 4h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0',
  msg: 'M21 15a3 3 0 0 1-3 3H7l-5 4V5a3 3 0 0 1 3-3h13a3 3 0 0 1 3 3z', next: 'M5 12h14m-6-6 6 6-6 6',
  trash: 'M3 6h18M8 6V4h8v2m-9 0 1 15h8l1-15', send: 'm22 2-7 20-4-9-9-4zM22 2 11 13',
  image: 'M3 5h18v14H3zm0 11 5-5 4 4 3-3 6 6M15 9h.01', spark: 'm12 3 2.2 6.8L21 12l-6.8 2.2L12 21l-2.2-6.8L3 12l6.8-2.2z',
  edit: 'm16 3 5 5M4 20l4-1L21 6a2 2 0 0 0-3-3L5 16z', print: 'M6 9V2h12v7M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2M6 14h12v8H6z',
  chev: 'm6 9 6 6 6-6',
  target: 'M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0m-5 0a5 5 0 1 1-10 0 5 5 0 0 1 10 0',
};
const ic = (n, s = 18) => `<svg width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${P[n]}"/></svg>`;
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let uidN = 0;
const uid = () => Date.now().toString(36) + (uidN++).toString(36) + Math.random().toString(36).slice(2, 5);
const dateAdd = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dow = d => (new Date(d + 'T12:00:00Z').getUTCDay() + 6) % 7; // 0=月
const WD = '月火水木金土日';
const md = d => `${+d.slice(5, 7)}/${+d.slice(8, 10)}`;
const mdw = d => `${md(d)}（${WD[dow(d)]}）`;
const toMin = t => +t.slice(0, 2) * 60 + +t.slice(3, 5);
const toTime = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const dur = n => n >= 60 ? `${Math.floor(n / 60)}時間${n % 60 ? (n % 60) + '分' : ''}` : `${n}分`;
/* 時間の書き方は「3時間54分」に統一する（「3.9時間」のような小数は使わない） */
const hours = n => dur(Math.round(n));
const range = (a, b) => `${a}〜${b}`;
const pct = (a, b) => b ? Math.round(a / b * 100) : 0;
const level = p => p >= 80 ? 'good' : p >= 60 ? 'mid' : 'low';
const tone = p => ({ good: 'green', mid: 'amber', low: 'red' }[level(p)]);
const weekStart = d => dateAdd(d, -dow(d));
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00Z') - new Date(a + 'T12:00:00Z')) / 864e5);
const weekDays = start => Array.from({ length: 7 }, (_, i) => dateAdd(start, i));
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const snap = (m, s = 15) => Math.round(m / s) * s;
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ t >>> 15, t | 1); t ^= t + Math.imul(t ^ t >>> 7, t | 61); return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];

/* Actifyくん（受験AI）の表情 */
const BOT_NAME = 'Actifyくん';
/* 頭だけのアイコン。顔はSVGで描く（js/bot.js） */
const botImg = (mood = 'support', cls = 'bot-av') => botHtml({ mood, cls, head: true });

/* data: のURLは新しいタブで開けない（Chromeが止める）ので、開くときに blob: に直す */
const memFiles = {}, blobCache = {};
function fileUrl(u) {
  const x = memFiles[u] || asset(u);
  if (!x || !x.startsWith('data:')) return x;
  if (!blobCache[x]) {
    const [h, b64] = x.split(','), bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    blobCache[x] = URL.createObjectURL(new Blob([arr], { type: h.slice(5).split(';')[0] }));
  }
  return blobCache[x];
}
function readAsDataUrl(f) { return new Promise(res => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); }); }
/* 1.5MB までは保存、それ以上はこのページを開いている間だけ */
async function storeFile(f) {
  if (f.src) return f.src; // サンプル（同梱ファイル）
  if (f.size <= 1.5 * 1024 * 1024) { const d = await readAsDataUrl(f); if (d) return d; }
  const key = 'mem:' + uid() + ':' + f.name; memFiles[key] = URL.createObjectURL(f); return key;
}

let toastTimer;
function toast(msg, undo, mood) {
  const el = document.querySelector('#toast');
  el.innerHTML = `${mood ? botImg(mood, 'toast-bot') : ''}<span>${esc(msg)}</span>${undo ? `<button data-act="undo">${esc(undo.label || '取り消す')}</button>` : ''}`;
  ui.undo = undo?.fn || null; el.classList.toggle('with-bot', !!mood); el.classList.add('show'); clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), undo ? 6500 : 3400);
}
