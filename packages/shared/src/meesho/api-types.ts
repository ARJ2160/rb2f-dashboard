import type { Sums } from '../blinkit/metrics';
export interface MeMetaResponse {
  profileId: string;
  sales: { from: string | null; to: string | null; rows: number };
  orders: { from: string | null; to: string | null; rows: number };
  manualAds: { rows: number; spend: number };
  categories: string[];
  states: string[];
  unmappedSkus: { sku: string; name: string; rev: number }[];
  notes: string[];
}
export interface MeGroupRow { key: string; sums: Sums }
export interface MeGroupsResponse { from: string; to: string; days: number; total: Sums; groups: MeGroupRow[] }
export interface MeDailyRow {
  date: string; grossRev: number; grossUnits: number;
  netRev: number; netUnits: number; returnsUnits: number; rtoUnits: number; cancellationsUnits: number;
}
export interface MeDailyTotals {
  grossRev: number; grossUnits: number; netRev: number; netUnits: number;
  returnsUnits: number; rtoUnits: number; cancellationsUnits: number;
  adSpend: number; adSales: number; adUnits: number;
}
export interface MeDailyResponse { from: string; to: string; dates: string[]; rows: MeDailyRow[]; totals: MeDailyTotals; adsEntered: boolean; notes: string[] }
export interface MeDurRow { sku: string; name: string; category: string; values: number[]; total: number }
export interface MeDurResponse { dates: string[]; metric: 'units' | 'rev' | 'net_units'; rows: MeDurRow[] }
export interface MeAsinRow { sku: string; name: string; category: string; sums: Sums }
export interface MeAsinResponse { rows: MeAsinRow[]; total: Sums; truncated: boolean }
export interface MeGeoRow { state: string; sums: Sums }
export interface MeGeoResponse { states: MeGeoRow[] }
export interface MeManualAdRow { date: string; campaign: string; spend: number; adSales: number; adUnits: number; impressions: number; clicks: number }
export interface MeManualAdsResponse { rows: MeManualAdRow[]; total: { spend: number; adSales: number; adUnits: number } }
