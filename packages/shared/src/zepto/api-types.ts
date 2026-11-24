import type { Sums } from '../blinkit/metrics';
import type { ZpChannel } from './report-types';

/* Zepto API shapes. Sales/units come from Total Sales; ad metrics from the
   SP/SB/SD campaign/keyword/product reports (period-level). Only additive sums
   travel; ratios are derived on the page from `@dash/shared/zepto` METRICS. */

export interface ZpAdPeriod {
  channel: ZpChannel;
  from: string;
  to: string;
  rows: number;
}

export interface ZpCampaignInfo {
  name: string;
  channel: ZpChannel;
  category: string;
  campaignType: string;
}

export interface ZpMetaResponse {
  profileId: string;
  sales: { from: string | null; to: string | null; rows: number };
  ads: { periods: ZpAdPeriod[] };
  inventory: { snapshots: string[] };
  /** Canonical categories (from the SKU mapper), sorted. */
  categories: string[];
  channels: ZpChannel[];
  cities: string[];
  campaigns: ZpCampaignInfo[];
  unmappedSkus: { skuId: string; name: string; gmv: number }[];
  unmappedCampaigns: { name: string; channel: ZpChannel; spend: number }[];
  notes: string[];
}

export interface ZpGroupRow {
  key: string;
  sums: Sums;
}
export interface ZpGroupsResponse {
  from: string;
  to: string;
  days: number;
  total: Sums;
  groups: ZpGroupRow[];
}

/** DSR — daily SALES sums (ads are period-level, so the ad side is a period total, not per-day). */
export interface ZpDailyResponse {
  from: string;
  to: string;
  dates: string[];
  /** per-day sales sums (rev/units; ad fields 0 — ads have no daily grain) */
  series: Sums[];
  /** sales total + ad total for the whole range (ad periods within the range) */
  total: Sums;
  /** ad spend/sales by channel for the range */
  byChannel: { channel: ZpChannel; spend: number; asales: number; impr: number; clicks: number }[];
  notes: string[];
}

export interface ZpGeoRow {
  key: string;
  state: string;
  sums: Sums;
}
export interface ZpGeoResponse {
  states: ZpGeoRow[];
  cities: ZpGeoRow[];
}

export interface ZpKeywordRow {
  keyword: string;
  matchType: string;
  channel: ZpChannel;
  campaign: string | null;
  campaigns: string[];
  category: string;
  sums: Sums;
}
export interface ZpKeywordsResponse {
  rows: ZpKeywordRow[];
  total: Sums;
  truncated: boolean;
}

/** ASIN / SKU-level: category → SKU, ad metrics compiled from the Product reports + revenue from Total Sales. */
export interface ZpAsinRow {
  skuId: string;
  name: string;
  category: string;
  /** channels that advertised this SKU in the range */
  channels: ZpChannel[];
  sums: Sums;
}
export interface ZpAsinResponse {
  rows: ZpAsinRow[];
  total: Sums;
  truncated: boolean;
}

/** Category-advertised: the advertised category (from the product/campaign mapper) with its ad metrics. */
export interface ZpCatAdvRow {
  category: string;
  sums: Sums;
}
export interface ZpCatAdvResponse {
  rows: ZpCatAdvRow[];
  total: Sums;
}

export interface ZpInventoryRow {
  skuCode: string;
  skuName: string;
  category: string;
  city: string;
  units: number;
  /** daily run rate (units/day) from Total Sales over the last 7 data days, when the SKU code matches a sales SKU. */
  drr: number | null;
  /** days of cover = units ÷ drr */
  doc: number | null;
  status: string;
}
export interface ZpInventoryResponse {
  snapshot: string | null;
  snapshots: string[];
  rows: ZpInventoryRow[];
  cities: string[];
}

export interface ZpDurRow {
  skuId: string;
  name: string;
  category: string;
  values: number[];
  total: number;
}
export interface ZpDurResponse {
  dates: string[];
  metric: 'units' | 'rev';
  rows: ZpDurRow[];
}

export interface ZpCampaignRow {
  name: string;
  channel: ZpChannel;
  category: string;
  campaignType: string;
  status: string;
  sums: Sums;
}
export interface ZpCampaignsResponse {
  rows: ZpCampaignRow[];
  total: Sums;
}
