import type { Metadata } from 'next';
import { Inter } from 'next/font/google';
import type { ReactNode } from 'react';

import { Nav } from '@/components/nav';
import { ProfileProvider } from '@/lib/profile';

import './globals.css';

// Inter: very legible at small sizes, with tabular figures for the number columns.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });

export const metadata: Metadata = {
  title: 'Amazon Dashboard',
  description: 'Upload Amazon Seller / Vendor Central reports and view DSR and DUR.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen font-sans antialiased">
        <ProfileProvider>
          <Nav />
          <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
        </ProfileProvider>
      </body>
    </html>
  );
}
