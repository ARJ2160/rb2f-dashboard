import { date, doublePrecision, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/** Nykaa tables (prefix `nk_`). Two sales sources keyed by `source`
    (mis | seller), deduped by precedence at query time. Ad reports period-level. */

export const nkDailySkuSales = pgTable(
  'nk_daily_sku_sales',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    sku: text('sku').notNull(),
    source: text('source').notNull(), // mis | seller
    title: text('title').notNull().default(''),
    revenue: doublePrecision('revenue').notNull().default(0),
    units: doublePrecision('units').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'nk_daily_sku_sales_pk', columns: [t.profileId, t.date, t.sku, t.source] }),
    index('nk_daily_sku_sales_date_idx').on(t.profileId, t.date),
  ]
);

const adMetrics = {
  impressions: doublePrecision('impressions').notNull().default(0),
  clicks: doublePrecision('clicks').notNull().default(0),
  spend: doublePrecision('spend').notNull().default(0),
  adSales: doublePrecision('ad_sales').notNull().default(0),
  adUnits: doublePrecision('ad_units').notNull().default(0),
};

export const nkAdCampaign = pgTable('nk_ad_campaign', {
  profileId: text('profile_id').notNull(), periodFrom: date('period_from', { mode: 'string' }).notNull(), periodTo: date('period_to', { mode: 'string' }).notNull(),
  campaignId: text('campaign_id').notNull().default(''), campaignName: text('campaign_name').notNull(), status: text('status').notNull().default(''), ...adMetrics,
}, (t) => [primaryKey({ name: 'nk_ad_campaign_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.campaignName] }), index('nk_ad_campaign_period_idx').on(t.profileId, t.periodFrom, t.periodTo)]);

export const nkAdSku = pgTable('nk_ad_sku', {
  profileId: text('profile_id').notNull(), periodFrom: date('period_from', { mode: 'string' }).notNull(), periodTo: date('period_to', { mode: 'string' }).notNull(),
  campaignId: text('campaign_id').notNull().default(''), campaignName: text('campaign_name').notNull().default(''), sku: text('sku').notNull(), title: text('title').notNull().default(''), ...adMetrics,
}, (t) => [primaryKey({ name: 'nk_ad_sku_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.sku] }), index('nk_ad_sku_period_idx').on(t.profileId, t.periodFrom, t.periodTo)]);

export const nkAdPlacement = pgTable('nk_ad_placement', {
  profileId: text('profile_id').notNull(), periodFrom: date('period_from', { mode: 'string' }).notNull(), periodTo: date('period_to', { mode: 'string' }).notNull(),
  campaignId: text('campaign_id').notNull().default(''), campaignName: text('campaign_name').notNull().default(''), placement: text('placement').notNull(), ...adMetrics,
}, (t) => [primaryKey({ name: 'nk_ad_placement_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.placement] }), index('nk_ad_placement_period_idx').on(t.profileId, t.periodFrom, t.periodTo)]);

export const nkAdSearchTerm = pgTable('nk_ad_search_term', {
  profileId: text('profile_id').notNull(), periodFrom: date('period_from', { mode: 'string' }).notNull(), periodTo: date('period_to', { mode: 'string' }).notNull(),
  campaignId: text('campaign_id').notNull().default(''), campaignName: text('campaign_name').notNull().default(''), searchTerm: text('search_term').notNull(), matchType: text('match_type').notNull().default(''), ...adMetrics,
}, (t) => [primaryKey({ name: 'nk_ad_search_term_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.searchTerm, t.matchType] }), index('nk_ad_search_term_period_idx').on(t.profileId, t.periodFrom, t.periodTo)]);

export const nkSkuSov = pgTable('nk_sku_sov', {
  profileId: text('profile_id').notNull(), periodFrom: date('period_from', { mode: 'string' }).notNull(), periodTo: date('period_to', { mode: 'string' }).notNull(),
  sku: text('sku').notNull(), sov: doublePrecision('sov').notNull().default(0), rank: doublePrecision('rank'),
}, (t) => [primaryKey({ name: 'nk_sku_sov_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.sku] }), index('nk_sku_sov_period_idx').on(t.profileId, t.periodFrom, t.periodTo)]);

export const nkSkuMap = pgTable('nk_sku_map', {
  profileId: text('profile_id').notNull(), sku: text('sku').notNull(), title: text('title').notNull().default(''), category: text('category').notNull().default(''), sellingPrice: doublePrecision('selling_price').notNull().default(0),
}, (t) => [primaryKey({ name: 'nk_sku_map_pk', columns: [t.profileId, t.sku] })]);

export const nkCampaignMap = pgTable('nk_campaign_map', {
  profileId: text('profile_id').notNull(), campaignName: text('campaign_name').notNull(), category: text('category').notNull().default(''),
}, (t) => [primaryKey({ name: 'nk_campaign_map_pk', columns: [t.profileId, t.campaignName] })]);
