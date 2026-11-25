import { date, doublePrecision, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/** Myntra tables (prefix `my_`). Only additive raw numbers; ratios derived at
    query time. Total Sales is dated (replace-by-date) + carries state; ad
    reports are period-level (replace-by-period). Re-exported from db/schema.ts. */

/** Total Sales: one row per day × style × state. */
export const myDailyStyleSales = pgTable(
  'my_daily_style_sales',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    styleId: text('style_id').notNull(),
    state: text('state').notNull().default(''),
    title: text('title').notNull().default(''),
    revenue: doublePrecision('revenue').notNull().default(0),
    units: doublePrecision('units').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'my_daily_style_sales_pk', columns: [t.profileId, t.date, t.styleId, t.state] }),
    index('my_daily_style_sales_date_idx').on(t.profileId, t.date),
  ]
);

const adMetrics = {
  impressions: doublePrecision('impressions').notNull().default(0),
  clicks: doublePrecision('clicks').notNull().default(0),
  spend: doublePrecision('spend').notNull().default(0),
  adSales: doublePrecision('ad_sales').notNull().default(0),
  adUnits: doublePrecision('ad_units').notNull().default(0),
};

export const myAdCampaign = pgTable(
  'my_ad_campaign',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    campaignId: text('campaign_id').notNull().default(''),
    campaignName: text('campaign_name').notNull(),
    status: text('status').notNull().default(''),
    ...adMetrics,
  },
  (t) => [
    primaryKey({ name: 'my_ad_campaign_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.campaignName] }),
    index('my_ad_campaign_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

export const myAdProduct = pgTable(
  'my_ad_product',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    campaignId: text('campaign_id').notNull().default(''),
    campaignName: text('campaign_name').notNull().default(''),
    styleId: text('style_id').notNull(),
    title: text('title').notNull().default(''),
    ...adMetrics,
  },
  (t) => [
    primaryKey({ name: 'my_ad_product_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.styleId] }),
    index('my_ad_product_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

export const myAdPlacement = pgTable(
  'my_ad_placement',
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
    primaryKey({ name: 'my_ad_placement_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.placement] }),
    index('my_ad_placement_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

export const myAdSearchTerm = pgTable(
  'my_ad_search_term',
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
    primaryKey({ name: 'my_ad_search_term_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.searchTerm, t.matchType] }),
    index('my_ad_search_term_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

/** Product Targeting + Keyword Targeting merged — target_type distinguishes them. */
export const myAdTargeting = pgTable(
  'my_ad_targeting',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    campaignId: text('campaign_id').notNull().default(''),
    campaignName: text('campaign_name').notNull().default(''),
    targetType: text('target_type').notNull(), // product | keyword
    target: text('target').notNull(),
    ...adMetrics,
  },
  (t) => [
    primaryKey({ name: 'my_ad_targeting_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.targetType, t.target] }),
    index('my_ad_targeting_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

/** Platform top search terms (SOV / demand) — not tied to a campaign. */
export const myTopSearchTerms = pgTable(
  'my_top_search_terms',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    term: text('term').notNull(),
    volume: doublePrecision('volume').notNull().default(0),
    yourImpressions: doublePrecision('your_impressions').notNull().default(0),
    yourClicks: doublePrecision('your_clicks').notNull().default(0),
    rank: doublePrecision('rank'),
  },
  (t) => [
    primaryKey({ name: 'my_top_search_terms_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.term] }),
    index('my_top_search_terms_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

export const myStyleMap = pgTable(
  'my_style_map',
  {
    profileId: text('profile_id').notNull(),
    styleId: text('style_id').notNull(),
    title: text('title').notNull().default(''),
    category: text('category').notNull().default(''),
    sellingPrice: doublePrecision('selling_price').notNull().default(0),
  },
  (t) => [primaryKey({ name: 'my_style_map_pk', columns: [t.profileId, t.styleId] })]
);

export const myCampaignMap = pgTable(
  'my_campaign_map',
  {
    profileId: text('profile_id').notNull(),
    campaignName: text('campaign_name').notNull(),
    category: text('category').notNull().default(''),
  },
  (t) => [primaryKey({ name: 'my_campaign_map_pk', columns: [t.profileId, t.campaignName] })]
);
