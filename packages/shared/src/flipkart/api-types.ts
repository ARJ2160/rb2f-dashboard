import type { Sums } from '../blinkit/metrics';

/* Flipkart API shapes. Sales/units + combined traffic impr/clicks come from the
   Traffic report (per day); returns / net come from Earn More (per day); ad
   metrics come from the period-level ad reports (a period is included when it
   falls inside the dashboard range). Only additive numbers travel; ratios are
   derived on the page from `@dash/shared/flipkart` METRICS. */

export interface FkAdPeriod {
  from: string;
  to: string;
  rows: number;
}
export interface FkCampaignInfo {
  name: string;
  category: string;
}

export interface FkMetaResponse {
  profileId: string;
  sales: { from: string | null; to: string | null; rows: number };
  earnMore: { from: string | null; to: string | null; rows: number };
  ads: { periods: FkAdPeriod[] };
  categories: string[];
  campaigns: FkCampaignInfo[];
  unmappedFsns: { fsn: string; name: string; rev: number }[];
  unmappedCampaigns: { name: string; spend: number }[];
  notes: string[];
}

export interface FkGroupRow {
  key: string;
  sums: Sums;
}
export interface FkGroupsResponse {
  from: string;
  to: string;
  days: number;
  total: Sums;
  groups: FkGroupRow[];
}

/** DSR — per-day sales/traffic (gross + net); ads are period-level so the ad + organic
    funnel is a range total, not per-day. Organic impr/clicks = traffic (total) − ad. */
export interface FkDailyRow {
  date: string;
  grossRev: number;
  grossUnits: number;
  netRev: number;
  netUnits: number;
  returnsUnits: number;
  cancellationsUnits: number;
  /** combined ads+organic, from the Traffic report (daily) */
  trafficImpr: number;
  trafficClicks: number;
}
export interface FkDailyTotals {
  grossRev: number;
  grossUnits: number;
  netRev: number;
  netUnits: number;
  returnsUnits: number;
  cancellationsUnits: number;
  trafficImpr: number;
  trafficClicks: number;
  adImpr: number;
  adClicks: number;
  adSpend: number;
  adSales: number;
  adUnits: number;
  /** traffic − ad (range level; never negative-clamped so a mismatch is visible) */
  organicImpr: number;
  organicClicks: number;
  /** grossRev − adSales */
  organicSales: number;
}
export interface FkDailyResponse {
  from: string;
  to: string;
  dates: string[];
  rows: FkDailyRow[];
  totals: FkDailyTotals;
  notes: string[];
}

export interface FkDurRow {
  fsn: string;
  name: string;
  category: string;
  values: number[];
  total: number;
}
export interface FkDurResponse {
  dates: string[];
  metric: 'units' | 'rev' | 'net_units';
  rows: FkDurRow[];
}

/** Consolidated-FSN (ASIN-level): ad metrics per FSN + revenue from Traffic. */
export interface FkAsinRow {
  fsn: string;
  name: string;
  category: string;
  sums: Sums;
}
export interface FkAsinResponse {
  rows: FkAsinRow[];
  total: Sums;
  truncated: boolean;
}

export interface FkKeywordRow {
  keyword: string;
  matchType: string;
  campaign: string | null;
  campaigns: string[];
  category: string;
  sums: Sums;
}
export interface FkKeywordsResponse {
  rows: FkKeywordRow[];
  total: Sums;
  truncated: boolean;
}

export interface FkSearchTermRow {
  searchTerm: string;
  campaign: string | null;
  category: string;
  sums: Sums;
}
export interface FkSearchTermsResponse {
  rows: FkSearchTermRow[];
  total: Sums;
  truncated: boolean;
}

export interface FkPlacementRow {
  placement: string;
  category: string;
  sums: Sums;
}
export interface FkPlacementsResponse {
  rows: FkPlacementRow[];
  total: Sums;
}

export interface FkCatAdvRow {
  category: string;
  sums: Sums;
}
export interface FkCatAdvResponse {
  rows: FkCatAdvRow[];
  total: Sums;
}

export interface FkCampaignRow {
  name: string;
  category: string;
  sums: Sums;
}
export interface FkCampaignsResponse {
  rows: FkCampaignRow[];
  total: Sums;
}
