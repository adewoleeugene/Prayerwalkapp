import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Charis Prayer Walk',
  description: 'Prayer Walk Admin Dashboard',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
