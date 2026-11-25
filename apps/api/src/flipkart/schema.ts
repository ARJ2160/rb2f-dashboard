import { date, doublePrecision, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * Flipkart tables (prefix `fk_`). Same storage model as every other
 * marketplace: only additive raw numbers; every ratio is derived at query time.
 *
 * Sales-side reports are dated (replace-by-date): Traffic (FSN × day, gross
 * rev/units + combined ads+organic impr/clicks) and Earn More (FSN × day,
 * returns / cancellations / net). The five ad reports carry no date, so they are
 * stored against the export window (`period_from`…`period_to`),
 * replace-by-period. Re-exported from db/schema.ts so drizzle-kit sees them.
 */

/** Traffic / Total Sales: one row per day × FSN. `impressions_total`/`clicks_total` are ADS + ORGANIC combined. */
export const fkDailyFsnSales = pgTable(
  'fk_daily_fsn_sales',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    fsn: text('fsn').notNull(),
    title: text('title').notNull().default(''),
    revenueGross: doublePrecision('revenue_gross').notNull().default(0),
    units: doublePrecision('units').notNull().default(0),
    impressionsTotal: doublePrecision('impressions_total').notNull().default(0),
    clicksTotal: doublePrecision('clicks_total').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'fk_daily_fsn_sales_pk', columns: [t.profileId, t.date, t.fsn] }),
    index('fk_daily_fsn_sales_date_idx').on(t.profileId, t.date),
  ]
);

/** Earn More: one row per day × FSN — returns, cancellations, net revenue, net units. */
export const fkDailyFsnReturns = pgTable(
  'fk_daily_fsn_returns',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    fsn: text('fsn').notNull(),
    returnsUnits: doublePrecision('returns_units').notNull().default(0),
    cancellationsUnits: doublePrecision('cancellations_units').notNull().default(0),
    netRevenue: doublePrecision('net_revenue').notNull().default(0),
    netUnits: doublePrecision('net_units').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'fk_daily_fsn_returns_pk', columns: [t.profileId, t.date, t.fsn] }),
    index('fk_daily_fsn_returns_date_idx').on(t.profileId, t.date),
  ]
);

/** Common ad-metric columns (additive). Ratios (CTR/CPC/CPM/ACoS/ROAS) derived at query time. */
const adMetrics = {
  impressions: doublePrecision('impressions').notNull().default(0),
  clicks: doublePrecision('clicks').notNull().default(0),
  spend: doublePrecision('spend').notNull().default(0),
  adSales: doublePrecision('ad_sales').notNull().default(0),
  adUnits: doublePrecision('ad_units').notNull().default(0),
};

/** Campaign report: 1 row per campaign, no date → keyed by export window. */
export const fkAdCampaign = pgTable(
  'fk_ad_campaign',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    campaignId: text('campaign_id').notNull().default(''),
    campaignName: text('campaign_name').notNull(),
    campaignType: text('campaign_type').notNull().default(''),
    status: text('status').notNull().default(''),
    ...adMetrics,
  },
  (t) => [
    primaryKey({
      name: 'fk_ad_campaign_pk',
      columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.campaignName],
    }),
    index('fk_ad_campaign_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

/** Consolidated FSN (= Advertised Product): 1 row per campaign × FSN, no date. */
export const fkAdFsn = pgTable(
  'fk_ad_fsn',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    campaignId: text('campaign_id').notNull().default(''),
    campaignName: text('campaign_name').notNull().default(''),
    fsn: text('fsn').notNull(),
    title: text('title').notNull().default(''),
    ...adMetrics,
  },
  (t) => [
    primaryKey({
      name: 'fk_ad_fsn_pk',
      columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.fsn],
    }),
    index('fk_ad_fsn_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

/** Placement performance: 1 row per campaign × placement, no date. */
export const fkAdPlacement = pgTable(
  'fk_ad_placement',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    campaignId: text('campaign_id').notNull().default(''),
    campaignName: text('campaign_name').notNull().default(''),
    placement: text('placement').notNull(),
    ...adMetrics,
  },
  (t) => [
    primaryKey({
      name: 'fk_ad_placement_pk',
      columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.placement],
    }),
    index('fk_ad_placement_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

/** Search term report: 1 row per campaign × search term, no date. */
export const fkAdSearchTerm = pgTable(
  'fk_ad_search_term',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    campaignId: text('campaign_id').notNull().default(''),
    campaignName: text('campaign_name').notNull().default(''),
    searchTerm: text('search_term').notNull(),
    matchType: text('match_type').notNull().default(''),
    ...adMetrics,
  },
  (t) => [
    primaryKey({
      name: 'fk_ad_search_term_pk',
      columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.searchTerm, t.matchType],
    }),
    index('fk_ad_search_term_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

/** Keyword report: 1 row per campaign × keyword, no date. */
export const fkAdKeyword = pgTable(
  'fk_ad_keyword',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    campaignId: text('campaign_id').notNull().default(''),
    campaignName: text('campaign_name').notNull().default(''),
    keyword: text('keyword').notNull(),
    matchType: text('match_type').notNull().default(''),
    ...adMetrics,
  },
  (t) => [
    primaryKey({
      name: 'fk_ad_keyword_pk',
      columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.keyword, t.matchType],
    }),
    index('fk_ad_keyword_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

/** FSN mapper: FSN → canonical category (+ title, selling price). Re-ingest replaces it. */
export const fkFsnMap = pgTable(
  'fk_fsn_map',
  {
    profileId: text('profile_id').notNull(),
    fsn: text('fsn').notNull(),
    title: text('title').notNull().default(''),
    category: text('category').notNull().default(''),
    sellingPrice: doublePrecision('selling_price').notNull().default(0),
  },
  (t) => [primaryKey({ name: 'fk_fsn_map_pk', columns: [t.profileId, t.fsn] })]
);

/** Campaign mapper: campaign name → category (+ optional SKU/city). Re-ingest replaces it. */
export const fkCampaignMap = pgTable(
  'fk_campaign_map',
  {
    profileId: text('profile_id').notNull(),
    campaignName: text('campaign_name').notNull(),
    category: text('category').notNull().default(''),
    sku: text('sku').notNull().default(''),
    city: text('city').notNull().default(''),
  },
  (t) => [primaryKey({ name: 'fk_campaign_map_pk', columns: [t.profileId, t.campaignName] })]
);
