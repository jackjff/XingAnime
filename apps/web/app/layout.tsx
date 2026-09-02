import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Xing Anime — Anime Indonesia',
  description: 'Temukan anime favoritmu dengan subtitle Bahasa Indonesia.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="id">
      <body>{children}</body>
    </html>
  );
}
