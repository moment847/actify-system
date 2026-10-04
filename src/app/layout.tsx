import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Actify',
  description: '受験生の毎日の自習を、講師が週ごとに計画して見守る学習管理',
  icons: { apple: '/icons/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Actify', statusBarStyle: 'default' },
};
export const viewport: Viewport = { themeColor: '#f2f2f7', viewportFit: 'cover' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
