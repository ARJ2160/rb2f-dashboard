import type { Sums } from '../blinkit/metrics';
import type { MyTargetType } from './report-types';

/* Myntra API shapes. Sales/units + state come from Total Sales (per day); ad
   metrics from the period-level ad reports. Only additive numbers travel. */

export interface MyAdPeriod {
  from: string;
  to: string;
  rows: number;
}
export interface MyCampaignInfo {
  name: string;
  category: string;
}
export interface MyMetaResponse {
  profileId: string;
  sales: { from: string | null; to: string | null; rows: number };
  ads: { periods: MyAdPeriod[] };
  categories: string[];
  states: string[];
  campaigns: MyCampaignInfo[];
  unmappedStyles: { style: string; name: string; rev: number }[];
  unmappedCampaigns: { name: string; spend: number }[];
  notes: string[];
}

export interface MyGroupRow {
  key: string;
  sums: Sums;
}
export interface MyGroupsResponse {
  from: string;
  to: string;
  days: number;
  total: Sums;
  groups: MyGroupRow[];
}

export interface MyDailyRow {
  date: string;
  sums: Sums;
}
export interface MyDailyResponse {
  from: string;
  to: string;
  dates: string[];
  rows: MyDailyRow[];
  total: Sums;
  notes: string[];
}

export interface MyDurRow {
  style: string;
  name: string;
  category: string;
  values: number[];
  total: number;
}
export interface MyDurResponse {
  dates: string[];
  metric: 'units' | 'rev';
  rows: MyDurRow[];
}

export interface MyAsinRow {
  style: string;
  name: string;
  category: string;
  sums: Sums;
}
export interface MyAsinResponse {
  rows: MyAsinRow[];
  total: Sums;
  truncated: boolean;
}

export interface MyTargetingRow {
  target: string;
  targetType: MyTargetType;
  campaign: string | null;
  category: string;
  sums: Sums;
}
export interface MyTargetingResponse {
  rows: MyTargetingRow[];
  total: Sums;
  truncated: boolean;
}

export interface MySearchTermRow {
  searchTerm: string;
  campaign: string | null;
  category: string;
  sums: Sums;
}
export interface MySearchTermsResponse {
  rows: MySearchTermRow[];
  total: Sums;
  truncated: boolean;
}

export interface MyPlacementRow {
  placement: string;
  sums: Sums;
}
export interface MyPlacementsResponse {
  rows: MyPlacementRow[];
  total: Sums;
}

export interface MyCatAdvRow {
  category: string;
  sums: Sums;
}
export interface MyCatAdvResponse {
  rows: MyCatAdvRow[];
  total: Sums;
}

export interface MyCampaignRow {
  name: string;
  category: string;
  sums: Sums;
}
export interface MyCampaignsResponse {
  rows: MyCampaignRow[];
  total: Sums;
}

export interface MyGeoRow {
  state: string;
  sums: Sums;
}
export interface MyGeoResponse {
  states: MyGeoRow[];
}

/** Platform top search terms — demand + your share (SOV). Not tied to campaigns. */
export interface MyTopTermRow {
  term: string;
  volume: number;
  yourImpr: number;
  yourClicks: number;
  rank: number | null;
}
export interface MyTopTermsResponse {
  rows: MyTopTermRow[];
}
