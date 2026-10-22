'use client';

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * The active brand / account ("profile"). Every upload and report is scoped
 * to it on the API side. Persisted per browser.
 */
const KEY = 'dash.profileId';
const ProfileCtx = createContext<{ profileId: string; setProfileId: (p: string) => void }>({
  profileId: 'default',
  setProfileId: () => {},
});

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [profileId, setState] = useState('default');

  useEffect(() => {
    try {
      const saved = localStorage.getItem(KEY);
      if (saved) setState(saved);
    } catch {
      /* storage unavailable */
    }
  }, []);

  const setProfileId = useCallback((p: string) => {
    const clean = p.trim().replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 64) || 'default';
    setState(clean);
    try {
      localStorage.setItem(KEY, clean);
    } catch {
      /* ignore */
    }
  }, []);

  return <ProfileCtx.Provider value={{ profileId, setProfileId }}>{children}</ProfileCtx.Provider>;
}

export const useProfile = () => useContext(ProfileCtx);
