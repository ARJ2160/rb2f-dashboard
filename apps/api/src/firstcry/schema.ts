import { date, doublePrecision, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
/** Firstcry tables (prefix `fc_`). Sales dated; performance reports period-level.
    Performance Category is stored pre-rolled (category key, no product). */
export const fcDailySkuSales = pgTable('fc_daily_sku_sales', {
  profileId: text('profile_id').notNull(), date: date('date', { mode: 'string' }).notNull(), sku: text('sku').notNull(), title: text('title').notNull().default(''),
  revenue: doublePrecision('revenue').notNull().default(0), units: doublePrecision('units').notNull().default(0),
}, (t) => [primaryKey({ name: 'fc_daily_sku_sales_pk', columns: [t.profileId, t.date, t.sku] }), index('fc_daily_sku_sales_date_idx').on(t.profileId, t.date)]);
const adMetrics = { impressions: doublePrecision('impressions').notNull().default(0), clicks: doublePrecision('clicks').notNull().default(0), spend: doublePrecision('spend').notNull().default(0), adSales: doublePrecision('ad_sales').notNull().default(0), adUnits: doublePrecision('ad_units').notNull().default(0) };
export const fcAdProduct = pgTable('fc_ad_product', {
  profileId: text('profile_id').notNull(), periodFrom: date('period_from', { mode: 'string' }).notNull(), periodTo: date('period_to', { mode: 'string' }).notNull(),
  campaignId: text('campaign_id').notNull().default(''), campaignName: text('campaign_name').notNull().default(''), sku: text('sku').notNull(), title: text('title').notNull().default(''), ...adMetrics,
}, (t) => [primaryKey({ name: 'fc_ad_product_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.sku] }), index('fc_ad_product_period_idx').on(t.profileId, t.periodFrom, t.periodTo)]);
export const fcAdCategory = pgTable('fc_ad_category', {
  profileId: text('profile_id').notNull(), periodFrom: date('period_from', { mode: 'string' }).notNull(), periodTo: date('period_to', { mode: 'string' }).notNull(),
  category: text('category').notNull(), ...adMetrics,
}, (t) => [primaryKey({ name: 'fc_ad_category_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.category] }), index('fc_ad_category_period_idx').on(t.profileId, t.periodFrom, t.periodTo)]);
export const fcAdKeyword = pgTable('fc_ad_keyword', {
  profileId: text('profile_id').notNull(), periodFrom: date('period_from', { mode: 'string' }).notNull(), periodTo: date('period_to', { mode: 'string' }).notNull(),
  campaignId: text('campaign_id').notNull().default(''), campaignName: text('campaign_name').notNull().default(''), keyword: text('keyword').notNull(), matchType: text('match_type').notNull().default(''), ...adMetrics,
}, (t) => [primaryKey({ name: 'fc_ad_keyword_pk', columns: [t.profileId, t.periodFrom, t.periodTo, t.campaignId, t.keyword, t.matchType] }), index('fc_ad_keyword_period_idx').on(t.profileId, t.periodFrom, t.periodTo)]);
export const fcSkuMap = pgTable('fc_sku_map', {
  profileId: text('profile_id').notNull(), sku: text('sku').notNull(), title: text('title').notNull().default(''), category: text('category').notNull().default(''), sellingPrice: doublePrecision('selling_price').notNull().default(0),
}, (t) => [primaryKey({ name: 'fc_sku_map_pk', columns: [t.profileId, t.sku] })]);
export const fcCampaignMap = pgTable('fc_campaign_map', {
  profileId: text('profile_id').notNull(), campaignName: text('campaign_name').notNull(), category: text('category').notNull().default(''),
}, (t) => [primaryKey({ name: 'fc_campaign_map_pk', columns: [t.profileId, t.campaignName] })]);
