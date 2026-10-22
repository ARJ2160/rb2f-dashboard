import type { Metadata } from 'next';
import type { ReactNode } from 'react';

import { Nav } from '@/components/nav';
import { ProfileProvider } from '@/lib/profile';

import './globals.css';

export const metadata: Metadata = {
  title: 'Amazon Dashboard',
  description: 'Upload Amazon Seller / Vendor Central reports and view DSR and DUR.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen font-sans antialiased">
        <ProfileProvider>
          <Nav />
          <main className="mx-auto max-w-[1600px] px-4 py-6 sm:px-6">{children}</main>
        </ProfileProvider>
      </body>
    </html>
  );
}
