import { date, doublePrecision, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * Swiggy Instamart tables (prefix `im_`). Same storage model as Blinkit and
 * Amazon: only additive raw numbers, keyed by day; every ratio is derived at
 * query time. Re-ingesting a file replaces the rows for the dates it contains.
 * Re-exported from db/schema.ts so drizzle-kit sees them.
 */

/** Sales: one row per day × city × area × dark store × item (the export is already aggregated — no order IDs). */
export const imSales = pgTable(
  'im_sales',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    city: text('city').notNull(),
    area: text('area').notNull().default(''),
    storeId: text('store_id').notNull().default(''),
    itemCode: text('item_code').notNull(),
    comboItemCode: text('combo_item_code').notNull().default(''),
    productName: text('product_name').notNull().default(''),
    variant: text('variant').notNull().default(''),
    l1Category: text('l1_category').notNull().default(''),
    l3Category: text('l3_category').notNull().default(''),
    mrp: doublePrecision('mrp').notNull().default(0),
    units: doublePrecision('units').notNull().default(0),
    /** GMV (= units × base MRP in the export) */
    gmv: doublePrecision('gmv').notNull().default(0),
  },
  (t) => [
    primaryKey({ name: 'im_sales_pk', columns: [t.profileId, t.date, t.city, t.area, t.storeId, t.itemCode, t.comboItemCode] }),
    index('im_sales_date_idx').on(t.profileId, t.date),
  ]
);

/** Ads: one row per day × campaign × ad property × keyword × match type × product × city (rows of the same key are summed). */
export const imAds = pgTable(
  'im_ads',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    campaignId: text('campaign_id').notNull(),
    campaignName: text('campaign_name').notNull().default(''),
    /** KW = Keyword Based Ads · SIB = Search Inline Banner · AS = Auto Suggest */
    adType: text('ad_type').notNull(),
    keyword: text('keyword').notNull().default(''),
    matchType: text('match_type').notNull().default(''),
    /** Lower-case product name as the ads report writes it ('' for banner / auto-suggest rows). */
    productName: text('product_name').notNull().default(''),
    city: text('city').notNull().default(''),
    impressions: doublePrecision('impressions').notNull().default(0),
    clicks: doublePrecision('clicks').notNull().default(0),
    a2c: doublePrecision('a2c').notNull().default(0),
    conversions: doublePrecision('conversions').notNull().default(0),
    /** TOTAL_GMV — ad-attributed GMV */
    gmv: doublePrecision('gmv').notNull().default(0),
    directGmv7: doublePrecision('direct_gmv_7').notNull().default(0),
    directGmv14: doublePrecision('direct_gmv_14').notNull().default(0),
    /** TOTAL_BUDGET_BURNT */
    spend: doublePrecision('spend').notNull().default(0),
    brandedClicks: doublePrecision('branded_clicks').notNull().default(0),
    /** Σ AD_RANK × impressions, and the impressions that carry a rank (avg rank re-weighted at query time) */
    rankWeighted: doublePrecision('rank_weighted').notNull().default(0),
    rankImpr: doublePrecision('rank_impr').notNull().default(0),
  },
  (t) => [
    primaryKey({
      name: 'im_ads_pk',
      columns: [t.profileId, t.date, t.campaignId, t.adType, t.keyword, t.matchType, t.productName, t.city],
    }),
    index('im_ads_date_idx').on(t.profileId, t.date),
  ]
);

/** SKU mapper: "item:<code>" (Item Code block) or "name:<normalised product / campaign name>". Re-ingest replaces it. */
export const imSkuMap = pgTable(
  'im_sku_map',
  {
    profileId: text('profile_id').notNull(),
    key: text('key').notNull(),
    productName: text('product_name').notNull().default(''),
    sku: text('sku').notNull().default(''),
    category: text('category').notNull().default(''),
    price: doublePrecision('price'),
  },
  (t) => [primaryKey({ name: 'im_sku_map_pk', columns: [t.profileId, t.key] })]
);
