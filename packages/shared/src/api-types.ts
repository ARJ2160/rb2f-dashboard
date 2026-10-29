import type { AdMetrics, DsrMetrics } from './metrics';
import type { ReportType } from './report-types';

// ── Uploads ──────────────────────────────────────────────────────────

export interface FileUploadResult {
  filename: string;
  status: 'stored' | 'skipped' | 'error';
  reportType?: ReportType;
  /** How the report type was decided. */
  detectedBy?: 'filename' | 'headers';
  /** Dates actually written (min/max of rows stored). */
  from?: string;
  to?: string;
  rowsRead?: number;
  rowsStored?: number;
  message?: string;
  warnings?: string[];
}

export interface UploadResponse {
  profileId: string;
  files: FileUploadResult[];
  /** Set when the post-upload rebuild of campaign filters / search-term classes failed. */
  dimsError?: string;
}

export interface UploadLogEntry {
  id: string;
  filename: string;
  reportType: string | null;
  status: string;
  dateFrom: string | null;
  dateTo: string | null;
  rowsStored: number;
  message: string | null;
  createdAt: string;
}

// ── Coverage ─────────────────────────────────────────────────────────

export interface CoverageResponse {
  profileId: string;
  sources: Array<{ source: string; from: string | null; to: string | null; days: number }>;
  asinMapper: { mappedAsins: number; asinsWithSales: number; matchRatePct: number | null };
}

// ── DSR (rule book §10.1) ────────────────────────────────────────────

export interface DsrRow extends DsrMetrics {
  date: string;
}

export interface DsrResponse {
  profileId: string;
  from: string;
  to: string;
  days: number;
  total: DsrMetrics;
  avg: DsrMetrics;
  rows: DsrRow[];
  /** Ad totals per channel for the range — lets you see SP vs SB vs SD at a glance. */
  byChannel: Array<{
    channel: 'sp' | 'sb' | 'sd';
    days: number;
    /** Days sourced from the ASIN-level report (Advertised Product / SB Attributed Purchases). */
    asinDays: number;
    /** Days that fell back to the campaign report because the ASIN-level one was missing. */
    campaignDays: number;
    spend: number;
    adSales: number;
    adUnits: number;
    impressions: number;
    clicks: number;
  }>;
  /** Category filter applied (null = all) and the categories available to pick. */
  category: string | null;
  categories: string[];
  notes: string[];
}

// ── DUR (rule book §10.2) ────────────────────────────────────────────

/**
 * units  = Units Ordered (Seller) + Ordered Units (Vendor)
 * orders = Total Order Items (Seller Central only — Vendor has no order count)
 */
export type DurMetric = 'units' | 'orders';

export interface DurRow {
  /** null = source rows whose ASIN was blank (distinct from "Unmapped"). */
  asin: string | null;
  itemName: string | null;
  /** ASIN-mapper category; "Unmapped" when the ASIN isn't in the mapper. */
  category: string;
  totals: number | null;
  avg: number | null;
  /** date → value; null = no data for that ASIN/date. */
  values: Record<string, number | null>;
}

export interface DurResponse {
  profileId: string;
  from: string;
  to: string;
  days: number;
  metric: DurMetric;
  dates: string[];
  rows: DurRow[];
  category: string | null;
  categories: string[];
  notes: string[];
}

// ── Category view (rule book §10.4) ─────────────────────────────────

export interface CategoryRow extends DsrMetrics {
  /** ASIN-mapper category; "Unmapped" = ASIN not in the mapper; "(missing ASIN)" = blank ASIN in the source. */
  category: string;
  asins: number;
  /** Share of total Sales, %. */
  salesSharePct: number | null;
}

export interface CategoryAsinRow extends DsrMetrics {
  /** '' = source rows with no ASIN. */
  asin: string;
  title: string | null;
  category: string;
}

export interface CategoryResponse {
  profileId: string;
  from: string;
  to: string;
  days: number;
  total: DsrMetrics;
  rows: CategoryRow[];
  /** ASIN-level rows (filtered by `category` when given), top by Sales then Spend. */
  asinRows: CategoryAsinRow[];
  asinTotal: number;
  categories: string[];
  notes: string[];
}

/** Values for the shared ad-view filters (from campaign_dims). */
export interface AdFilterOptions {
  categories: string[];
  adTypes: string[];
  targetings: string[];
  brandings: string[];
}

// ── Search terms ────────────────────────────────────────────────────

export type AdChannelFilter = 'all' | 'sp' | 'sb' | 'sd';

export interface SearchTermRow extends AdMetrics {
  searchTerm: string;
  /** "SP", "SB", "SD", "SP & SB", … — never "Both" (rule book §8). */
  channels: string;
  /** Branded / Competitor / Generic. */
  branding: string;
  /** Targeting types that triggered the term (Keyword, Product, Auto…). */
  targetTypes: string[];
  /** Targeted keyword / ASIN expressions that triggered this term (by spend, max 10). */
  targets: string[];
  targetCount: number;
  /** Campaigns the term was triggered in (by spend, max 10). */
  campaignNames: string[];
  campaigns: number;
}

export interface SearchTermResponse {
  profileId: string;
  from: string;
  to: string;
  total: AdMetrics;
  totalTerms: number;
  rows: SearchTermRow[];
  truncated: boolean;
  filterOptions: AdFilterOptions;
  notes: string[];
}

// ── Placements ──────────────────────────────────────────────────────

export interface PlacementRow extends AdMetrics {
  channel: 'sp' | 'sb';
  /** TOS / ROS / PDP, or Amazon's own label when it doesn't map. */
  placement: string;
  spendSharePct: number | null;
  campaigns: number;
}

export interface PlacementResponse {
  profileId: string;
  from: string;
  to: string;
  total: AdMetrics;
  rows: PlacementRow[];
  filterOptions: AdFilterOptions;
  notes: string[];
}

// ── State Wise Data (rule book §8 naming; §2 order report) ──────────

export interface StateRow {
  state: string;
  units: number;
  sales: number;
  orders: number | null;
  asins: number;
  unitsSharePct: number | null;
  salesSharePct: number | null;
}

export interface StateResponse {
  profileId: string;
  from: string;
  to: string;
  total: { units: number; sales: number; orders: number | null; asins: number };
  rows: StateRow[];
  sources: Array<{ source: 'seller' | 'vendor'; days: number }>;
  categories: string[];
  notes: string[];
}

// ── Ads analysis ────────────────────────────────────────────────────

export interface AdGroupRow extends AdMetrics {
  /** The group value: an ad type, targeting type, or Branded/Competitor/Generic. */
  key: string;
  spendSharePct: number | null;
  /** Campaigns (ad types) or search terms (targeting / branding). */
  count: number;
}

export interface AdsResponse {
  profileId: string;
  from: string;
  to: string;
  /** Campaign-level: SP / SB / SBV / SD / SDV. */
  adTypes: { total: AdMetrics; rows: AdGroupRow[] };
  /** Search-term level: Keyword / Product / Category / Auto / Audience / Other. */
  targeting: { total: AdMetrics; rows: AdGroupRow[] };
  /** Search-term level: Branded / Competitor / Generic. */
  branding: { total: AdMetrics; rows: AdGroupRow[] };
  brandTerms: string[];
  filterOptions: AdFilterOptions;
  notes: string[];
}

// ── Hour-wise ───────────────────────────────────────────────────────

export interface HourRow extends AdMetrics {
  hour: number;
  spendSharePct: number | null;
}

export interface HourlyResponse {
  profileId: string;
  from: string;
  to: string;
  total: AdMetrics;
  rows: HourRow[];
  channels: Array<{ channel: 'sp' | 'sb' | 'sd'; days: number }>;
  filterOptions: AdFilterOptions;
  notes: string[];
}

// ── GCS warehouse (read-only sync, /gcs page) ──

export type GcsFileStatus = 'stored' | 'skipped' | 'error' | 'unchanged';

/** Outcome of one bucket object in a sync run. */
export interface GcsFileResult {
  /** Path below the marketplace folder, e.g. `campaign/eatopia_sp_campaign.csv`. */
  file: string;
  status: GcsFileStatus;
  reportTypes: string[];
  rowsStored: number;
  from?: string;
  to?: string;
  message?: string;
}

export interface GcsSyncJob {
  brand: string;
  /** 'amazon' (default) or 'blinkit' — which `<brand>/<marketplace>/` folder is being synced. */
  marketplace?: 'amazon' | 'blinkit';
  profileId: string;
  state: 'running' | 'done' | 'error';
  /** true = re-ingest every file, even unchanged ones. */
  force: boolean;
  startedAt: string;
  finishedAt: string | null;
  filesTotal: number;
  filesDone: number;
  /** File being processed right now. */
  current: string | null;
  stored: number;
  skipped: number;
  unchanged: number;
  failed: number;
  /** Fatal error (listing / auth) or campaign-filter rebuild failure. */
  message: string | null;
  results: GcsFileResult[];
}

export interface GcsBrand {
  /** URL-safe id ("milkitbaby"). */
  brand: string;
  /** Folder name in the bucket, as-is. */
  folder: string;
  /** Profile the brand's data is stored under (`gcs_<brand>`). */
  profileId: string;
  lastSyncedAt: string | null;
  filesSynced: number;
  job: GcsSyncJob | null;
}

export interface GcsBrandsResponse {
  bucket: string;
  marketplace: string;
  configured: boolean;
  brands: GcsBrand[];
  /** Why the brand list could not be read (not configured, auth, permissions…). */
  error?: string;
}

/** A synced object as recorded in the ledger. */
export interface GcsFileEntry {
  file: string;
  objectName: string;
  generation: string;
  size: number;
  updated: string | null;
  status: string;
  reportTypes: string[];
  rowsStored: number;
  dateFrom: string | null;
  dateTo: string | null;
  message: string | null;
  syncedAt: string;
}

// ── MoM / WoW summary (default screen) ──────────────────────────────

export interface SummaryPeriod {
  from: string;
  to: string;
  /** "1-21 Oct" */
  label: string;
  /** MTD | PMTD | L7D | P7D */
  short: string;
  days: number;
  missingSalesDays: number;
  missingAdDays: number;
}

export interface SummaryRow {
  key: string;
  label: string;
  format: 'money' | 'int' | 'pct' | 'ratio';
  /** Which direction is good — colours the change %. */
  better: 'up' | 'down' | 'none';
  mtd: number | null;
  pmtd: number | null;
  /** % change MTD vs PMTD */
  mom: number | null;
  l7d: number | null;
  p7d: number | null;
  /** % change L7D vs P7D */
  wow: number | null;
}

export interface SummaryResponse {
  profileId: string;
  /** Date the windows end on (null = no data). */
  asOf: string | null;
  /** The automatic "latest update" date, so the UI can offer "back to latest". */
  autoAsOf: string | null;
  latest: { sales: string | null; ads: string | null };
  category: string | null;
  categories: string[];
  periods: { mtd: SummaryPeriod; pmtd: SummaryPeriod; l7d: SummaryPeriod; p7d: SummaryPeriod } | null;
  rows: SummaryRow[];
  notes: string[];
}

// ── SQP (Brand Analytics Search Query Performance, Brand View) ─────

/** What a query is currently targeted in (matched on the targeted keyword, never the triggered search term). */
export type SqpTargeted = 'Not Targeted' | 'SP' | 'SB' | 'SP & SB';
/** Channels a query is still missing from — null when it's already in both. */
export type SqpLaunch = 'SP' | 'SB' | 'SP & SB' | null;
export type SqpView = 'opportunities' | 'report';
/** How many of CTR / add-to-cart % / purchase % beat the category: 1 = Low, 2 = Medium, 3 = Strong. */
export type SqpStrength = 'Strong' | 'Medium' | 'Low';
export type SqpSort =
  | 'strength'
  | 'volume'
  | 'acos'
  | 'spend'
  | 'impressionShare'
  | 'clickShare'
  | 'cartAddShare'
  | 'purchaseShare'
  | 'purchasesBrand';

export interface SqpPeriod {
  from: string;
  to: string;
  /** Queries stored for the period. */
  queries: number;
}

export interface SqpRow {
  query: string;
  volume: number;
  brandClicks: number;
  /** Clicks ÷ impressions (%). null when the denominator is 0. */
  ctrBrandPct: number | null;
  ctrCategoryPct: number | null;
  /** Cart adds ÷ clicks (%). */
  atcBrandPct: number | null;
  atcCategoryPct: number | null;
  /** Purchases ÷ cart adds (%). */
  purchaseBrandPct: number | null;
  purchaseCategoryPct: number | null;
  targeted: SqpTargeted;
  launchIn: SqpLaunch;
  /** Spend / ACoS of this query's OWN targeting; null when it isn't targeted. */
  spend: number | null;
  acosPct: number | null;
  acosVsAccount: 'better' | 'worse' | null;
  isOpportunity: boolean;
  /** Set for opportunities only. */
  strength: SqpStrength | null;
  /** How many of the three rates beat the category (0–3). */
  wins: number;
  /** One sentence per clause behind the verdict. */
  basis: string;
  // Raw funnel counts (Total = whole category for the query, Brand = this brand) and brand share in %.
  impressionsTotal: number;
  impressionsBrand: number;
  impressionShare: number | null;
  clicksTotal: number;
  clicksBrand: number;
  clickShare: number | null;
  cartAddsTotal: number;
  cartAddsBrand: number;
  cartAddShare: number | null;
  purchasesTotal: number;
  purchasesBrand: number;
  purchaseShare: number | null;
}

export interface SqpResponse {
  profileId: string;
  /** Every period stored for the profile, newest first. */
  periods: SqpPeriod[];
  /** The period shown; null when no SQP report has been stored. */
  period: SqpPeriod | null;
  /** Blended ACoS of all search-term data in the period — what each query's ACoS is coloured against. */
  accountAcosPct: number | null;
  minBrandClicks: number;
  /** Counted over the whole period, not the filtered list. */
  kpis: { opportunities: number; strong: number; medium: number; low: number; launchSp: number; launchSb: number; launchBoth: number; queries: number };
  rows: SqpRow[];
  /** Rows matching the filters before the row limit. */
  totalRows: number;
  truncated: boolean;
  notes: string[];
}

// ── Keyword harvesting (SP + SB search-term reports) ──────────────

export type HarvestChannel = 'SP' | 'SB' | 'SP & SB';
export type HarvestSort = 'orders' | 'adSales' | 'spend' | 'acos' | 'cvr';

export interface HarvestRow {
  searchTerm: string;
  /** "ASIN" when the customer's search term is a product ID (harvest as a product target). */
  kind: 'Keyword' | 'ASIN';
  orders: number;
  spOrders: number;
  sbOrders: number;
  impressions: number;
  clicks: number;
  spend: number;
  adSales: number;
  acosPct: number | null;
  /** Orders ÷ clicks (%). */
  cvrPct: number | null;
  /** Channels where the term got orders. */
  performingIn: HarvestChannel;
  /** Whether the term is already a manual target (keyword / ASIN) in each channel. */
  manualSp: boolean;
  manualSb: boolean;
  /** Channels it's missing from as a manual target — where to add it. */
  harvestInto: HarvestChannel;
  /** How it was found, e.g. "SP · Auto", "SB · Broad". */
  foundVia: string[];
  /** Top campaigns by orders. */
  campaigns: string[];
  campaignCount: number;
}

export interface HarvestResponse {
  profileId: string;
  days: number;
  /** Window ends on the latest day with SP / SB search-term data. */
  from: string | null;
  to: string | null;
  minOrders: number;
  /** Over every qualifying term, not the filtered list. */
  kpis: { terms: number; intoBoth: number; intoSp: number; intoSb: number; orders: number; adSales: number };
  rows: HarvestRow[];
  totalRows: number;
  truncated: boolean;
  /** True when some search-term rows have no Targeting column (GCS warehouse), so "manual" is inferred from campaign names. */
  approximateTargeting: boolean;
  notes: string[];
}
