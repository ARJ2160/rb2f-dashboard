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
    <header className="sticky top-0 z-40 border-b border-line bg-surface/95 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center gap-6 px-4 sm:px-6">
        <span className="text-sm font-semibold tracking-tight">Amazon Dashboard</span>
        <nav className="flex gap-1">
          {LINKS.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`btn btn-sm ${active ? 'btn-soft btn-primary' : 'btn-ghost font-normal text-muted'}`}
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
              className="input input-sm w-40"
            />
          </form>
        )}
      </div>
    </header>
  );
}
