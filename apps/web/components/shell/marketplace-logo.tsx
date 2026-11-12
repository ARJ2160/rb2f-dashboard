'use client';

import { useEffect, useRef, useState } from 'react';

/* Marketplace mark for the sidebar and the Amazon | Blinkit switch.
   Official logos are not bundled: put the files you're licensed to use at
   apps/web/public/logos/amazon.svg, blinkit.svg, swiggy_instamart.svg and zepto.svg (.png also works) and they are
   picked up automatically. Until then a neutral built-in mark is shown. */

export type LogoMarketplace = 'amazon' | 'blinkit' | 'swiggy_instamart' | 'zepto';

const SOURCES = (id: LogoMarketplace) => [`/logos/${id}.svg`, `/logos/${id}.png`];

/** Per marketplace: index of the first file that loaded, or SOURCES.length = none (built-in mark). */
const resolved = new Map<LogoMarketplace, number>();

const FALLBACK: Record<LogoMarketplace, { bg: string; fg: string; path: string; label: string }> = {
  // parcel box — "marketplace"
  amazon: {
    bg: '#232f3e',
    fg: '#ffffff',
    path: 'M12 3 20 7v10l-8 4-8-4V7l8-4zM4 7l8 4 8-4M12 11v10M8 5l8 4',
    label: 'Amazon',
  },
  // lightning bolt — "quick commerce"
  blinkit: {
    bg: '#f8cb46',
    fg: '#1c1c1c',
    path: 'M13.5 2.5 5.5 13.5h6l-1 8 8-11h-6l1-8z',
    label: 'Blinkit',
  },
  // shopping bag — Swiggy Instamart
  swiggy_instamart: {
    bg: '#fc8019',
    fg: '#ffffff',
    path: 'M6 2h12l1 5H5L6 2zM5 7l1 13h12l1-13H5zM9 11v4M15 11v4',
    label: 'Swiggy Instamart',
  },
  // Z-mark — Zepto
  zepto: {
    bg: '#8b2fc9',
    fg: '#ffffff',
    path: 'M5 5h14L5 19h14',
    label: 'Zepto',
  },
};

export function MarketplaceLogo({ id, size = 36, className = '' }: { id: LogoMarketplace; size?: number; className?: string }) {
  const sources = SOURCES(id);
  const [idx, setIdx] = useState(() => resolved.get(id) ?? 0);
  // hidden until it has loaded, so a missing file never flashes a broken-image icon
  const [loaded, setLoaded] = useState(() => resolved.has(id));
  const radius = Math.round(size * 0.26);
  const ref = useRef<HTMLImageElement>(null);

  // The image may finish (or fail) before React hydrates and attaches onLoad / onError — check once mounted.
  useEffect(() => {
    const el = ref.current;
    if (!el || !el.complete) return;
    if (el.naturalWidth > 0) {
      resolved.set(id, idx);
      setLoaded(true);
    } else {
      const next = idx + 1;
      if (next >= sources.length) resolved.set(id, next);
      setIdx(next);
    }
  }, [id, idx, sources.length]);

  if (idx < sources.length) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- tiny local asset, may be missing
      <img
        ref={ref}
        src={sources[idx]}
        alt={`${FALLBACK[id].label} logo`}
        width={size}
        height={size}
        onLoad={() => {
          resolved.set(id, idx);
          setLoaded(true);
        }}
        onError={() => {
          const next = idx + 1;
          if (next >= sources.length) resolved.set(id, next);
          setIdx(next);
        }}
        className={`shrink-0 border border-line bg-white object-contain ${className}`}
        style={{ width: size, height: size, borderRadius: radius, padding: Math.round(size * 0.12), opacity: loaded ? 1 : 0 }}
      />
    );
  }

  const f = FALLBACK[id];
  return (
    <span
      role="img"
      aria-label={f.label}
      className={`grid shrink-0 place-items-center ${className}`}
      style={{ width: size, height: size, borderRadius: radius, background: f.bg, color: f.fg }}
    >
      <svg viewBox="0 0 24 24" width={Math.round(size * 0.58)} height={Math.round(size * 0.58)} fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinejoin="round" strokeLinecap="round" aria-hidden>
        <path d={f.path} fill={id === 'blinkit' ? 'currentColor' : 'none'} />
      </svg>
    </span>
  );
}
