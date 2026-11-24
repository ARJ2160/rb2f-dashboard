import { date, doublePrecision, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * Zepto tables (prefix `zp_`). Same storage model as the other marketplaces:
 * only additive raw numbers; every ratio is derived at query time.
 *
 * Sales & inventory are dated (per-day / per-snapshot, replace-by-date). The ad
 * reports carry no date, so they are stored against the export window
 * (`period_from` … `period_to`) per channel, replace-by-period: re-uploading the
 * same window for the same channel replaces it, so nothing double-counts.
 * Re-exported from db/schema.ts so drizzle-kit sees them.
 */

/** Total Sales (SALES_OVERVIEW): one row per day × city × SKU (GMV + Quantity; no order IDs). */
export const zpSales = pgTable(
  'zp_sales',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    city: text('city').notNull(),
    skuId: text('sku_id').notNull(),
    skuName: text('sku_name').notNull().default(''),
    brand: text('brand').notNull().default(''),
    manufacturerId: text('manufacturer_id').notNull().default(''),
    manufacturerName: text('manufacturer_name').notNull().default(''),
    /** Zepto's own "SKU Category" (top-level: Home Needs / Hair Care …) — the canonical category comes from the SKU mapper. */
    reportCategory: text('report_category').notNull().default(''),
    units: doublePrecision('units').notNull().default(0),
    gmv: doublePrecision('gmv').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'zp_sales_pk', columns: [t.profileId, t.date, t.city, t.skuId] }),
    index('zp_sales_date_idx').on(t.profileId, t.date),
  ]
);

/** Inventory: one row per snapshot × city × SKU (stock Units). */
export const zpInventory = pgTable(
  'zp_inventory',
  {
    profileId: text('profile_id').notNull(),
    snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),
    city: text('city').notNull(),
    skuCode: text('sku_code').notNull(),
    ean: text('ean').notNull().default(''),
    skuName: text('sku_name').notNull().default(''),
    reportCategory: text('report_category').notNull().default(''),
    subCategory: text('sub_category').notNull().default(''),
    brand: text('brand').notNull().default(''),
    manufacturerName: text('manufacturer_name').notNull().default(''),
    manufacturerId: text('manufacturer_id').notNull().default(''),
    units: doublePrecision('units').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'zp_inventory_pk', columns: [t.profileId, t.snapshotDate, t.city, t.skuCode] }),
    index('zp_inventory_snap_idx').on(t.profileId, t.snapshotDate),
  ]
);

/** Common ad-metric columns (additive). Ratios (CPC/CPM/CTR/ROAS/ROBAS) are derived at query time. */
const adMetrics = {
  spend: doublePrecision('spend').notNull().default(0),
  /** Revenue — ad-attributed sales */
  asales: doublePrecision('asales').notNull().default(0),
  /** Orders — ad conversions */
  aunits: doublePrecision('aunits').notNull().default(0),
  atc: doublePrecision('atc').notNull().default(0),
  clicks: doublePrecision('clicks').notNull().default(0),
  impressions: doublePrecision('impressions').notNull().default(0),
  /** Same_skus — advertised-SKU (direct) sales */
  sameSkus: doublePrecision('same_skus').notNull().default(0),
  /** Other_skus — halo sales */
  otherSkus: doublePrecision('other_skus').notNull().default(0),
};

/** Campaign report (SP/SB/SD): 1 row per campaign, no date → keyed by export window + channel. */
export const zpAdCampaign = pgTable(
  'zp_ad_campaign',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    channel: text('channel').notNull(), // sp | sb | sd
    campaignName: text('campaign_name').notNull(),
    campaignType: text('campaign_type').notNull().default(''),
    status: text('status').notNull().default(''),
    brandId: text('brand_id').notNull().default(''),
    brandName: text('brand_name').notNull().default(''),
    dailyBudget: doublePrecision('daily_budget').notNull().default(0),
    uniqueReach: doublePrecision('unique_reach').notNull().default(0),
    uniqueConsiderations: doublePrecision('unique_considerations').notNull().default(0),
    ...adMetrics,
  },
  (t) => [
    primaryKey({
      name: 'zp_ad_campaign_pk',
      columns: [t.profileId, t.periodFrom, t.periodTo, t.channel, t.campaignName],
    }),
    index('zp_ad_campaign_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

/** Keyword report (SP/SB): 1 row per keyword × campaign, no date. */
export const zpAdKeyword = pgTable(
  'zp_ad_keyword',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    channel: text('channel').notNull(),
    keyword: text('keyword').notNull(),
    matchType: text('match_type').notNull().default(''),
    campaignId: text('campaign_id').notNull().default(''),
    campaignName: text('campaign_name').notNull().default(''),
    ...adMetrics,
  },
  (t) => [
    primaryKey({
      name: 'zp_ad_keyword_pk',
      columns: [t.profileId, t.periodFrom, t.periodTo, t.channel, t.campaignId, t.keyword, t.matchType],
    }),
    index('zp_ad_keyword_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

/** Product report (SP/SB/SD): 1 row per SKU × campaign, no date. ProductID == sales SKU ID. */
export const zpAdProduct = pgTable(
  'zp_ad_product',
  {
    profileId: text('profile_id').notNull(),
    periodFrom: date('period_from', { mode: 'string' }).notNull(),
    periodTo: date('period_to', { mode: 'string' }).notNull(),
    channel: text('channel').notNull(),
    productId: text('product_id').notNull(),
    productName: text('product_name').notNull().default(''),
    /** Zepto ad-platform category (Pooja & Worship Needs …) — canonical category via the SKU mapper. */
    reportCategory: text('report_category').notNull().default(''),
    campaignId: text('campaign_id').notNull().default(''),
    campaignName: text('campaign_name').notNull().default(''),
    ...adMetrics,
  },
  (t) => [
    primaryKey({
      name: 'zp_ad_product_pk',
      columns: [t.profileId, t.periodFrom, t.periodTo, t.channel, t.campaignId, t.productId],
    }),
    index('zp_ad_product_period_idx').on(t.profileId, t.periodFrom, t.periodTo),
  ]
);

/** SKU mapper: SKU ID → canonical category (+ name). Re-ingest replaces it. */
export const zpSkuMap = pgTable(
  'zp_sku_map',
  {
    profileId: text('profile_id').notNull(),
    skuId: text('sku_id').notNull(),
    skuName: text('sku_name').notNull().default(''),
    category: text('category').notNull().default(''),
  },
  (t) => [primaryKey({ name: 'zp_sku_map_pk', columns: [t.profileId, t.skuId] })]
);

/** Campaign mapper: campaign name → canonical category. Re-ingest replaces it. */
export const zpCampaignMap = pgTable(
  'zp_campaign_map',
  {
    profileId: text('profile_id').notNull(),
    campaignName: text('campaign_name').notNull(),
    category: text('category').notNull().default(''),
  },
  (t) => [primaryKey({ name: 'zp_campaign_map_pk', columns: [t.profileId, t.campaignName] })]
);
