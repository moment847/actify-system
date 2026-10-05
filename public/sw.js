// Actify の Service Worker：端末への通知（Web Push）を出し、押したらその画面を開く。
// オフラインのキャッシュはしない（予定や記録は毎回サーバから読む）
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: 'Actify', body: e.data ? e.data.text() : '' }; }
  // 同じサイトの中だけ開く（'/\t/evil' のような書き方もブラウザは別サイトと読むので、origin で確かめる）
  let url = '/';
  try { const u = new URL(typeof d.url === 'string' ? d.url : '/', self.location.origin); if (u.origin === self.location.origin) url = u.pathname + u.search; } catch { url = '/'; }
  e.waitUntil(self.registration.showNotification(d.title || 'Actify', {
    body: d.body || '', tag: d.tag, data: { url }, icon: '/icons/icon-192.png', badge: '/icons/icon-192.png', lang: 'ja',
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/', self.location.origin).href;
  e.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const same = wins.find(w => w.url.startsWith(self.location.origin));
    if (same) { await same.focus(); return same.navigate(url).catch(() => self.clients.openWindow(url)); }
    return self.clients.openWindow(url);
  })());
});
