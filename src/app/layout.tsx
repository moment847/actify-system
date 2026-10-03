import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = { title: 'Actify', description: '受験生の毎日の自習を、講師が週ごとに計画して見守る学習管理' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
