import type { Sums } from '../blinkit/metrics';
export interface FcAdPeriod { from: string; to: string; rows: number }
export interface FcMetaResponse {
  profileId: string;
  sales: { from: string | null; to: string | null; rows: number };
  ads: { periods: FcAdPeriod[] };
  categories: string[];
  unmappedSkus: { sku: string; name: string; rev: number }[];
  notes: string[];
}
export interface FcGroupRow { key: string; sums: Sums }
export interface FcGroupsResponse { from: string; to: string; days: number; total: Sums; groups: FcGroupRow[] }
export interface FcDailyRow { date: string; sums: Sums }
export interface FcDailyResponse { from: string; to: string; dates: string[]; rows: FcDailyRow[]; total: Sums; notes: string[] }
export interface FcDurRow { sku: string; name: string; category: string; values: number[]; total: number }
export interface FcDurResponse { dates: string[]; metric: 'units' | 'rev'; rows: FcDurRow[] }
export interface FcAsinRow { sku: string; name: string; category: string; sums: Sums }
export interface FcAsinResponse { rows: FcAsinRow[]; total: Sums; truncated: boolean }
export interface FcKeywordRow { keyword: string; campaign: string | null; category: string; sums: Sums }
export interface FcKeywordsResponse { rows: FcKeywordRow[]; total: Sums; truncated: boolean }
export interface FcCatAdvRow { category: string; sums: Sums }
export interface FcCatAdvResponse { rows: FcCatAdvRow[]; total: Sums }
