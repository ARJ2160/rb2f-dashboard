import type { DurResponse, SummaryResponse } from '@dash/shared';
import type {
  BkCityAdsResponse,
  BkDailyResponse,
  BkGeoResponse,
  BkGroupsResponse,
  BkInventoryResponse,
  BkInventoryTrendResponse,
  BkKeywordsResponse,
  BkMetaResponse,
} from '@dash/shared/blinkit';

import { API_URL } from './api';

/* Quick-commerce report endpoints (/api/blinkit/*, /api/instamart/*) — same conventions as lib/api.ts. */

async function get<T>(base: string, path: string, p: Record<string, string | number | undefined>): Promise<T> {
  const q = new URLSearchParams(
    Object.entries(p)
      .filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '')
      .map(([k, v]) => [k, String(v)])
  ).toString();
  const res = await fetch(`${API_URL}${base}${path}?${q}`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export interface BkRange {
  from: string;
  to: string;
  category?: string | undefined;
  /** Ad-type code (Blinkit PL / PR / BL, Instamart KW / SIB / AS) — filters the ads side of /dsr */
  adType?: string | undefined;
}

/**
 * Quick-commerce report client for one API mount: `/api/blinkit` or
 * `/api/instamart` — both return the same response shapes.
 */
export function qcApi(base: string) {
  return {
    meta: (profileId: string) => get<BkMetaResponse>(base, '/meta', { profileId }),
    mom: (profileId: string, f: { asOf?: string; category?: string } = {}) => get<SummaryResponse>(base, '/mom', { profileId, ...f }),
    dsr: (profileId: string, r: BkRange) => get<BkDailyResponse>(base, '/dsr', { profileId, ...r }),
    dur: (profileId: string, r: BkRange, metric: 'units' | 'orders' | 'revenue') => get<DurResponse>(base, '/dur', { profileId, ...r, metric }),
    groups: (profileId: string, r: BkRange, groupBy: 'category' | 'sku') => get<BkGroupsResponse>(base, '/groups', { profileId, ...r, groupBy }),
    geo: (profileId: string, r: BkRange) => get<BkGeoResponse>(base, '/geo', { profileId, ...r }),
    cityAds: (profileId: string, r: BkRange) => get<BkCityAdsResponse>(base, '/city-ads', { profileId, ...r }),
    keywords: (profileId: string, r: BkRange, f: Record<string, string | number | undefined>) =>
      get<BkKeywordsResponse>(base, '/keywords', { profileId, ...r, ...f }),
    inventory: (profileId: string, f: { snapshot?: string; category?: string }) => get<BkInventoryResponse>(base, '/inventory', { profileId, ...f }),
    inventoryTrend: (profileId: string, f: { category?: string }) => get<BkInventoryTrendResponse>(base, '/inventory/trend', { profileId, ...f }),
  };
}
export type QcApi = ReturnType<typeof qcApi>;

/* Blinkit shorthands (kept for existing callers). */
const blinkit = qcApi('/api/blinkit');
export const bkMeta = blinkit.meta;
export const bkMom = blinkit.mom;
export const bkDsr = blinkit.dsr;
export const bkDur = blinkit.dur;
export const bkGroups = blinkit.groups;
export const bkGeo = blinkit.geo;
export const bkCityAds = blinkit.cityAds;
export const bkKeywords = blinkit.keywords;
export const bkInventory = blinkit.inventory;
export const bkInventoryTrend = blinkit.inventoryTrend;
