import type { Metadata } from 'next';
import { Inter, IBM_Plex_Mono } from 'next/font/google';
import type { ReactNode } from 'react';

import { Nav } from '@/components/nav';

import './globals.css';

// Inter: very legible at small sizes, with tabular figures for the number columns.
const inter = Inter({ subsets: ['latin'], display: 'swap', variable: '--font-inter' });
// IBM Plex Mono: unambiguous, tabular digits for every number column and KPI value.
const plexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  display: 'swap',
  variable: '--font-plex-mono',
});

export const metadata: Metadata = {
  title: 'RB2F Dashboard',
  description: 'Marketplace analytics from the GCS warehouse — Amazon, Blinkit, Swiggy Instamart, Zepto.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${plexMono.variable}`}>
      <body className="min-h-screen font-sans antialiased">
        <Nav />
        <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
      </body>
    </html>
  );
}
