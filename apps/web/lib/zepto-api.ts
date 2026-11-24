import type {
  ZpAsinResponse,
  ZpCampaignsResponse,
  ZpCatAdvResponse,
  ZpDailyResponse,
  ZpDurResponse,
  ZpGeoResponse,
  ZpGroupsResponse,
  ZpInventoryResponse,
  ZpKeywordsResponse,
  ZpMetaResponse,
} from '@dash/shared/zepto';

import { API_URL } from './api';

/* Zepto report endpoints (/api/zepto/*). Same conventions as lib/blinkit-api.ts. */

async function get<T>(path: string, p: Record<string, string | number | undefined>): Promise<T> {
  const q = new URLSearchParams(
    Object.entries(p)
      .filter((e): e is [string, string | number] => e[1] !== undefined && e[1] !== '')
      .map(([k, v]) => [k, String(v)])
  ).toString();
  const res = await fetch(`${API_URL}/api/zepto${path}?${q}`, { cache: 'no-store' });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export interface ZpRange {
  from: string;
  to: string;
  /** csv of canonical categories */
  category?: string | undefined;
  /** csv of sp|sb|sd */
  channel?: string | undefined;
}

export const zeptoApi = {
  meta: (profileId: string) => get<ZpMetaResponse>('/meta', { profileId }),
  summary: (profileId: string, r: ZpRange, groupBy: 'category' | 'sku') =>
    get<ZpGroupsResponse>('/summary', { profileId, ...r, groupBy }),
  dsr: (profileId: string, r: ZpRange) => get<ZpDailyResponse>('/dsr', { profileId, ...r }),
  dur: (profileId: string, r: ZpRange, metric: 'units' | 'rev') =>
    get<ZpDurResponse>('/dur', { profileId, ...r, metric }),
  geo: (profileId: string, r: ZpRange) => get<ZpGeoResponse>('/geo', { profileId, ...r }),
  keywords: (profileId: string, r: ZpRange, f: Record<string, string | number | undefined>) =>
    get<ZpKeywordsResponse>('/keywords', { profileId, ...r, ...f }),
  categoryAdvertised: (profileId: string, r: ZpRange) =>
    get<ZpCatAdvResponse>('/category-advertised', { profileId, ...r }),
  asin: (profileId: string, r: ZpRange, f: Record<string, string | number | undefined>) =>
    get<ZpAsinResponse>('/asin', { profileId, ...r, ...f }),
  campaigns: (profileId: string, r: ZpRange) => get<ZpCampaignsResponse>('/campaigns', { profileId, ...r }),
  inventory: (profileId: string, f: { snapshot?: string; category?: string }) =>
    get<ZpInventoryResponse>('/inventory', { profileId, ...f }),
};
export type ZeptoApi = typeof zeptoApi;
