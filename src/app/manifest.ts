import type { MetadataRoute } from 'next';

// ホーム画面に追加したときのアプリの情報。iPhone で端末への通知を受け取るには、ホーム画面に追加して開く必要がある（iOS 16.4 以降）
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Actify',
    short_name: 'Actify',
    description: '受験生の毎日の自習を、講師が週ごとに計画して見守る学習管理',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: '#f2f2f7',
    theme_color: '#f2f2f7',
    lang: 'ja',
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
