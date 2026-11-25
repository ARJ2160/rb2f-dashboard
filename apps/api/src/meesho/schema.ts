import { date, doublePrecision, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';
/** Meesho tables (prefix `me_`). BR = gross (sku × day × state); Orders → net
    buckets per day × sku; manual ads entered by hand. */
export const meDailySkuSales = pgTable('me_daily_sku_sales', {
  profileId: text('profile_id').notNull(), date: date('date', { mode: 'string' }).notNull(), sku: text('sku').notNull(), state: text('state').notNull().default(''),
  title: text('title').notNull().default(''), revenue: doublePrecision('revenue').notNull().default(0), units: doublePrecision('units').notNull().default(0),
}, (t) => [primaryKey({ name: 'me_daily_sku_sales_pk', columns: [t.profileId, t.date, t.sku, t.state] }), index('me_daily_sku_sales_date_idx').on(t.profileId, t.date)]);

/** Order status aggregated per day × sku → net. */
export const meOrderAgg = pgTable('me_order_agg', {
  profileId: text('profile_id').notNull(), date: date('date', { mode: 'string' }).notNull(), sku: text('sku').notNull(),
  deliveredUnits: doublePrecision('delivered_units').notNull().default(0), returnedUnits: doublePrecision('returned_units').notNull().default(0),
  rtoUnits: doublePrecision('rto_units').notNull().default(0), cancelledUnits: doublePrecision('cancelled_units').notNull().default(0),
  netRevenue: doublePrecision('net_revenue').notNull().default(0), netUnits: doublePrecision('net_units').notNull().default(0),
}, (t) => [primaryKey({ name: 'me_order_agg_pk', columns: [t.profileId, t.date, t.sku] }), index('me_order_agg_date_idx').on(t.profileId, t.date)]);

/** Manually entered ad spend (no marketplace ad feed). */
export const meManualAds = pgTable('me_manual_ads', {
  profileId: text('profile_id').notNull(), date: date('date', { mode: 'string' }).notNull(), campaign: text('campaign').notNull().default(''),
  spend: doublePrecision('spend').notNull().default(0), adSales: doublePrecision('ad_sales').notNull().default(0), adUnits: doublePrecision('ad_units').notNull().default(0),
  impressions: doublePrecision('impressions').notNull().default(0), clicks: doublePrecision('clicks').notNull().default(0),
}, (t) => [primaryKey({ name: 'me_manual_ads_pk', columns: [t.profileId, t.date, t.campaign] }), index('me_manual_ads_date_idx').on(t.profileId, t.date)]);

export const meSkuMap = pgTable('me_sku_map', {
  profileId: text('profile_id').notNull(), sku: text('sku').notNull(), title: text('title').notNull().default(''), category: text('category').notNull().default(''), sellingPrice: doublePrecision('selling_price').notNull().default(0),
}, (t) => [primaryKey({ name: 'me_sku_map_pk', columns: [t.profileId, t.sku] })]);
