'use client';

import { useEffect, useState } from 'react';

/** Run `load` whenever `deps` change; keeps the last data while reloading. */
export function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    load()
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading };
}

/** Days in an inclusive ISO range, and the equal-length range just before it. */
export const spanDays = (p: { from: string; to: string }) => Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
export function previousRange(p: { from: string; to: string }) {
  const n = spanDays(p);
  const shift = (iso: string, d: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * 86_400_000).toISOString().slice(0, 10);
  return { from: shift(p.from, -n), to: shift(p.from, -1) };
}

/** "Showing data from last 7 days" / "Showing 3 Feb – 16 Feb 2026 (14 days)". */
export function periodSentence(p: { from: string; to: string }, latest: string | null) {
  const n = spanDays(p);
  const d = (iso: string, y = false) =>
    new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', ...(y ? { year: 'numeric' } : {}), timeZone: 'UTC' });
  if (latest && p.to === latest) return `Showing data from last ${n} day${n === 1 ? '' : 's'} (${d(p.from)} – ${d(p.to, true)})`;
  return `Showing ${d(p.from)} – ${d(p.to, true)} (${n} day${n === 1 ? '' : 's'})`;
}
