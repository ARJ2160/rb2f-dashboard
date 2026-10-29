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

/* Blinkit report endpoints (/api/blinkit/*) — same conventions as lib/api.ts. */

async function get<T>(path: string, p: Record<string, string | number | undefined>): Promise<T> {
  const q = new URLSearchParams(
    Object.entries(p)
      .filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '')
      .map(([k, v]) => [k, String(v)])
  ).toString();
  const res = await fetch(`${API_URL}/api/blinkit${path}?${q}`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export interface BkRange {
  from: string;
  to: string;
  category?: string | undefined;
}

export const bkMeta = (profileId: string) => get<BkMetaResponse>('/meta', { profileId });
export const bkMom = (profileId: string, f: { asOf?: string; category?: string } = {}) =>
  get<SummaryResponse>('/mom', { profileId, ...f });
export const bkDsr = (profileId: string, r: BkRange) => get<BkDailyResponse>('/dsr', { profileId, ...r });
export const bkDur = (profileId: string, r: BkRange, metric: 'units' | 'orders' | 'revenue') =>
  get<DurResponse>('/dur', { profileId, ...r, metric });
export const bkGroups = (profileId: string, r: BkRange, groupBy: 'category' | 'sku') =>
  get<BkGroupsResponse>('/groups', { profileId, ...r, groupBy });
export const bkGeo = (profileId: string, r: BkRange) => get<BkGeoResponse>('/geo', { profileId, ...r });
export const bkCityAds = (profileId: string, r: BkRange) => get<BkCityAdsResponse>('/city-ads', { profileId, ...r });
export const bkKeywords = (profileId: string, r: BkRange, f: Record<string, string | number | undefined>) =>
  get<BkKeywordsResponse>('/keywords', { profileId, ...r, ...f });
export const bkInventory = (profileId: string, f: { snapshot?: string; category?: string }) =>
  get<BkInventoryResponse>('/inventory', { profileId, ...f });
export const bkInventoryTrend = (profileId: string, f: { category?: string }) =>
  get<BkInventoryTrendResponse>('/inventory/trend', { profileId, ...f });
