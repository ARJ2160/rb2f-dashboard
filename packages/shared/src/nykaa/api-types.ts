import type { Sums } from '../blinkit/metrics';

export interface NkAdPeriod { from: string; to: string; rows: number }
export interface NkCampaignInfo { name: string; category: string }
export interface NkMetaResponse {
  profileId: string;
  sales: { from: string | null; to: string | null; rows: number };
  sources: { mis: number; seller: number };
  ads: { periods: NkAdPeriod[] };
  categories: string[];
  campaigns: NkCampaignInfo[];
  unmappedSkus: { sku: string; name: string; rev: number }[];
  unmappedCampaigns: { name: string; spend: number }[];
  notes: string[];
}
export interface NkGroupRow { key: string; sums: Sums }
export interface NkGroupsResponse { from: string; to: string; days: number; total: Sums; groups: NkGroupRow[] }
export interface NkDailyRow { date: string; sums: Sums }
export interface NkDailyResponse { from: string; to: string; dates: string[]; rows: NkDailyRow[]; total: Sums; notes: string[] }
export interface NkDurRow { sku: string; name: string; category: string; values: number[]; total: number }
export interface NkDurResponse { dates: string[]; metric: 'units' | 'rev'; rows: NkDurRow[] }
export interface NkAsinRow { sku: string; name: string; category: string; sums: Sums }
export interface NkAsinResponse { rows: NkAsinRow[]; total: Sums; truncated: boolean }
export interface NkSearchTermRow { searchTerm: string; campaign: string | null; category: string; sums: Sums }
export interface NkSearchTermsResponse { rows: NkSearchTermRow[]; total: Sums; truncated: boolean }
export interface NkPlacementRow { placement: string; sums: Sums }
export interface NkPlacementsResponse { rows: NkPlacementRow[]; total: Sums }
export interface NkCatAdvRow { category: string; sums: Sums }
export interface NkCatAdvResponse { rows: NkCatAdvRow[]; total: Sums }
export interface NkCampaignRow { name: string; category: string; sums: Sums }
export interface NkCampaignsResponse { rows: NkCampaignRow[]; total: Sums }
/** SKU SOV — your share of voice per SKU. */
export interface NkSovRow { sku: string; name: string; category: string; sov: number; rank: number | null }
export interface NkSovResponse { rows: NkSovRow[] }
