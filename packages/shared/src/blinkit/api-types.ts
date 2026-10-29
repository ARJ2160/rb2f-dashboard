import type { Sums } from './metrics';

/* Blinkit API shapes. MoM / WoW and DUR reuse the Amazon `SummaryResponse` /
   `DurResponse` shapes (see ../api-types.ts) so the same tables render them. */

export type BkReportType =
  | 'bk_sales' // Sales Summary (order lines)
  | 'bk_ads_product_listing' // PRODUCT_LISTING (keyword level)
  | 'bk_ads_product_reco' // PRODUCT_RECOMMENDATION
  | 'bk_ads_banner_listing' // BANNER_LISTING (spotlight)
  | 'bk_inventory' // Inventory / Stock On Hand snapshot
  | 'bk_sku_mapper' // Product Name / Item ID → SKU, Category, Price
  | 'bk_campaign_mapper' // Campaign Name / ID → Category, SKU, City
  | 'unknown';

export const BK_REPORT_LABEL: Record<BkReportType, string> = {
  bk_sales: 'Blinkit Sales',
  bk_ads_product_listing: 'Blinkit Ads · Product Listing',
  bk_ads_product_reco: 'Blinkit Ads · Product Recommendation',
  bk_ads_banner_listing: 'Blinkit Ads · Banner Listing',
  bk_inventory: 'Blinkit Inventory',
  bk_sku_mapper: 'Blinkit SKU mapper',
  bk_campaign_mapper: 'Blinkit Campaign mapper',
  unknown: 'Not recognised',
};

export const AD_TYPE_LABEL: Record<string, string> = {
  PL: 'Product Listing',
  PR: 'Product Recommendation',
  BL: 'Banner Listing',
};

export interface BkMetaResponse {
  profileId: string;
  sales: { from: string | null; to: string | null; rows: number };
  ads: { from: string | null; to: string | null; rows: number };
  inventory: { snapshots: string[] };
  categories: string[];
  skus: string[];
  campaigns: { id: string; name: string; adType: string; category: string; geoKind: string; geoLabel: string }[];
  geoUnits: { key: string; label: string; cities: string[]; kind: 'city' | 'multi' }[];
  unmappedItems: { itemId: string; name: string; revenue: number }[];
  unmappedCampaigns: { id: string; name: string; spend: number }[];
  notes: string[];
}

export interface BkGroupRow {
  key: string;
  sums: Sums;
}

/** Category / SKU performance for one range. */
export interface BkGroupsResponse {
  from: string;
  to: string;
  days: number;
  total: Sums;
  groups: BkGroupRow[];
}

/** DSR — raw sums per day; every ratio is derived on the page. */
export interface BkDailyResponse {
  from: string;
  to: string;
  dates: string[];
  series: Sums[];
  total: Sums;
  /** Spend split by ad type (PL / PR / BL) — the DSR rows combine all three. */
  byAdType: { adType: string; spend: number; asales: number; impr: number; atc: number; aunits: number; days: number }[];
  notes: string[];
}

export interface BkGeoRow {
  key: string;
  state: string;
  sums: Sums;
}
export interface BkGeoResponse {
  states: BkGeoRow[];
  cities: BkGeoRow[];
}

export interface BkCityAdsRow {
  key: string;
  label: string;
  cities: string[];
  kind: 'city' | 'multi';
  campaigns: string[];
  /** Ads of exactly-targeted campaigns + revenue of those cities. */
  sums: Sums;
}
export interface BkCityAdsResponse {
  /** kind=city → shown at city level */
  rows: BkCityAdsRow[];
  /** kind=multi → shown only as a group, never split */
  groups: BkCityAdsRow[];
  notAttributable: { spend: number; asales: number; impr: number; campaigns: number };
  totalSpend: number;
}

export interface BkKeywordRow {
  keyword: string;
  campaign: string | null;
  adType: string;
  campaigns: string[];
  categories: string[];
  sums: Sums;
}
export interface BkKeywordsResponse {
  rows: BkKeywordRow[];
  total: Sums;
  truncated: boolean;
}

export interface BkInventoryRow {
  itemId: string;
  itemName: string;
  sku: string;
  category: string;
  facilityId: string;
  facility: string;
  feederCity: string;
  sellable: number;
  warehouse: number;
  inBetween: number;
  darkstore: number;
  incoming: number;
  unsellable: number;
  nearExpiry: number;
  sold7d: number;
  sold15d: number;
  sold30d: number;
  drr7: number;
  drr30: number;
  doc: number | null;
  docWithIncoming: number | null;
  status: string;
}
export interface BkInventoryResponse {
  snapshot: string | null;
  snapshots: string[];
  rows: BkInventoryRow[];
  bands: { critical: number; low: number; excess: number };
}
export interface BkInventoryTrendResponse {
  points: { snapshot: string; sellable: number; sold7d: number; doc: number | null }[];
}
