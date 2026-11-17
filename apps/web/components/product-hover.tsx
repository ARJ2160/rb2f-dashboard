'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

/**
 * ASIN hover preview — a reusable <AsinCell> that shows a small Amazon product
 * card (image + title + category + price + listing link) on hover, anywhere in
 * the app. The active profile comes from <ProfileProvider>; the product image
 * is loaded straight from Amazon's public image host by ASIN, with a graceful
 * fallback when it doesn't resolve.
 */

export interface ProductCard {
  asin: string;
  title: string | null;
  category: string | null;
  sellingPrice: number | null;
}

const ProfileContext = createContext<string | null>(null);

/** Wrap any subtree that renders ASINs so its <AsinCell>s know which profile to query. */
export function ProfileProvider({ profileId, children }: { profileId: string; children: React.ReactNode }) {
  return <ProfileContext.Provider value={profileId}>{children}</ProfileContext.Provider>;
}

/** Amazon.in listing + public product image (01 variant, large). */
const amazonListingUrl = (asin: string) => `https://www.amazon.in/dp/${asin}`;
const amazonImageUrl = (asin: string) => `https://images-na.ssl-images-amazon.com/images/P/${asin}.01._SCLZZZZZZZ_.jpg`;

// Tiny module-level cache so re-hovering the same ASIN doesn't refetch.
const cache = new Map<string, ProductCard | 'missing'>();

async function fetchProduct(profileId: string, asin: string): Promise<ProductCard | 'missing'> {
  const key = `${profileId}:${asin}`;
  const hit = cache.get(key);
  if (hit) return hit;
  try {
    const res = await fetch(`/api/products/${asin}?profileId=${encodeURIComponent(profileId)}`, { cache: 'no-store' });
    if (!res.ok) {
      cache.set(key, 'missing');
      return 'missing';
    }
    const card = (await res.json()) as ProductCard;
    cache.set(key, card);
    return card;
  } catch {
    return 'missing';
  }
}

const inr = (v: number | null) =>
  v == null ? null : new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(v);

/** An ASIN rendered as monospace text that reveals a product card on hover/focus. */
export function AsinCell({ asin }: { asin: string | null | undefined }) {
  const profileId = useContext(ProfileContext);
  const [open, setOpen] = useState(false);
  const [card, setCard] = useState<ProductCard | 'missing' | null>(null);
  const [imgOk, setImgOk] = useState(true);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  if (!asin) return <span className="text-muted">—</span>;

  const load = () => {
    if (!profileId || card) return;
    fetchProduct(profileId, asin).then(setCard);
  };

  const show = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 120); // small delay so quick passes don't flash
    load();
  };
  const hide = () => {
    if (timer.current) clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  return (
    <span
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      <a
        href={amazonListingUrl(asin)}
        target="_blank"
        rel="noopener noreferrer"
        className="font-mono underline decoration-dotted underline-offset-2 hover:text-brand"
        tabIndex={0}
      >
        {asin}
      </a>

      {open && (
        <span
          role="tooltip"
          className="absolute left-0 top-full z-50 mt-1 w-64 rounded-lg border border-line bg-surface p-3 text-left shadow-lg"
        >
          <span className="flex gap-3">
            {imgOk ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={amazonImageUrl(asin)}
                alt=""
                width={56}
                height={56}
                className="h-14 w-14 shrink-0 rounded border border-line object-contain bg-white"
                onError={() => setImgOk(false)}
              />
            ) : (
              <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded border border-line bg-side text-[10px] text-muted">
                no image
              </span>
            )}
            <span className="min-w-0 flex-1">
              {card === null ? (
                <span className="text-xs text-muted">Loading…</span>
              ) : card === 'missing' ? (
                <>
                  <span className="block font-mono text-xs">{asin}</span>
                  <span className="block text-xs text-muted">Not in the product mapper yet.</span>
                </>
              ) : (
                <>
                  <span className="block line-clamp-2 text-xs font-medium">{card.title ?? asin}</span>
                  {card.category && <span className="mt-0.5 block text-[11px] text-muted">{card.category}</span>}
                  {inr(card.sellingPrice) && <span className="mt-0.5 block text-[11px] font-semibold">{inr(card.sellingPrice)}</span>}
                </>
              )}
              <span className="mt-1 block font-mono text-[10px] text-muted">{asin}</span>
            </span>
          </span>
        </span>
      )}
    </span>
  );
}
