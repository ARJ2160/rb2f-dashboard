'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';

import { useProfile } from '@/lib/profile';

const LINKS = [
  { href: '/reports', label: 'Reports' },
  { href: '/upload', label: 'Upload' },
  { href: '/gcs', label: 'GCS' },
];

export function Nav() {
  const pathname = usePathname();
  const { profileId, setProfileId } = useProfile();
  const [draft, setDraft] = useState(profileId);
  useEffect(() => setDraft(profileId), [profileId]);

  return (
    <header className="border-b border-line bg-surface">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 sm:px-6">
        <span className="text-sm font-semibold tracking-tight">Amazon Dashboard</span>
        <nav className="flex gap-1">
          {LINKS.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-3 py-1.5 text-sm ${active ? 'bg-accent-soft font-medium text-accent' : 'text-muted hover:text-ink'}`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        {/* The GCS page picks its brand itself — the manual profile box doesn't apply there. */}
        {!pathname.startsWith('/gcs') && (
          <form
            className="ml-auto flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              setProfileId(draft);
            }}
          >
            <label htmlFor="profile" className="text-xs text-muted">
              Brand / profile
            </label>
            <input
              id="profile"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => setProfileId(draft)}
              className="h-8 w-40 rounded-md border border-line bg-surface px-2 text-sm outline-none focus:border-accent"
            />
          </form>
        )}
      </div>
    </header>
  );
}
