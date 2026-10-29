import { date, doublePrecision, index, pgTable, primaryKey, text } from 'drizzle-orm/pg-core';

/**
 * Blinkit tables (prefix `bk_`). Same storage model as Amazon: only additive
 * raw numbers, keyed by day; every ratio is derived at query time. Re-ingesting
 * a file replaces the rows for the dates it contains.
 * Re-exported from db/schema.ts so drizzle-kit sees them.
 */

/** One row per order line (Order Id × Item Id) — orders must be a DISTINCT count across any city / category slice. */
export const bkSalesLines = pgTable(
  'bk_sales_lines',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    orderId: text('order_id').notNull(),
    itemId: text('item_id').notNull(),
    productName: text('product_name').notNull().default(''),
    customerCity: text('customer_city').notNull().default(''),
    customerState: text('customer_state').notNull().default(''),
    supplyCity: text('supply_city').notNull().default(''),
    supplyState: text('supply_state').notNull().default(''),
    status: text('status').notNull().default(''),
    quantity: doublePrecision('quantity').notNull().default(0),
    mrp: doublePrecision('mrp').notNull().default(0),
    sellingPrice: doublePrecision('selling_price').notNull().default(0),
    /** Total Gross Bill Amount */
    revenue: doublePrecision('revenue').notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.orderId, t.itemId] }), index('bk_sales_date_idx').on(t.profileId, t.date)]
);

/** Ads: one row per day × ad type (PL / PR / BL) × campaign × targeting. */
export const bkDailyAds = pgTable(
  'bk_daily_ads',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    adType: text('ad_type').notNull(),
    campaignId: text('campaign_id').notNull(),
    campaignName: text('campaign_name').notNull(),
    targetingType: text('targeting_type').notNull().default(''),
    targetingValue: text('targeting_value').notNull().default(''),
    matchType: text('match_type').notNull().default(''),
    impressions: doublePrecision('impressions').notNull().default(0),
    directAtc: doublePrecision('direct_atc').notNull().default(0),
    indirectAtc: doublePrecision('indirect_atc').notNull().default(0),
    directQty: doublePrecision('direct_qty').notNull().default(0),
    indirectQty: doublePrecision('indirect_qty').notNull().default(0),
    directSales: doublePrecision('direct_sales').notNull().default(0),
    indirectSales: doublePrecision('indirect_sales').notNull().default(0),
    newUsers: doublePrecision('new_users').notNull().default(0),
    /** Estimated Budget Consumed */
    spend: doublePrecision('spend').notNull().default(0),
    /** Σ Most Viewed Position × Impressions (re-averaged at query time) */
    mvpWeighted: doublePrecision('mvp_weighted').notNull().default(0),
    mvpImpr: doublePrecision('mvp_impr').notNull().default(0),
    reach: doublePrecision('reach').notNull().default(0),
    uniqueClicks: doublePrecision('unique_clicks').notNull().default(0),
  },
  (t) => [
    primaryKey({
      name: 'bk_daily_ads_pk',
      columns: [t.profileId, t.date, t.adType, t.campaignId, t.targetingType, t.targetingValue, t.matchType],
    }),
    index('bk_ads_date_idx').on(t.profileId, t.date),
  ]
);

/** Inventory snapshot: item × warehouse facility (feeder), one snapshot per day. */
export const bkInventory = pgTable(
  'bk_inventory',
  {
    profileId: text('profile_id').notNull(),
    snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),
    itemId: text('item_id').notNull(),
    facilityId: text('facility_id').notNull(),
    itemName: text('item_name').notNull().default(''),
    facilityName: text('facility_name').notNull().default(''),
    uom: text('uom').notNull().default(''),
    netScheduled: doublePrecision('net_scheduled').notNull().default(0),
    incoming: doublePrecision('incoming').notNull().default(0),
    recalled: doublePrecision('recalled').notNull().default(0),
    sellable: doublePrecision('sellable').notNull().default(0),
    warehouse: doublePrecision('warehouse').notNull().default(0),
    inBetween: doublePrecision('in_between').notNull().default(0),
    darkstore: doublePrecision('darkstore').notNull().default(0),
    unsellable: doublePrecision('unsellable').notNull().default(0),
    damaged: doublePrecision('damaged').notNull().default(0),
    lost: doublePrecision('lost').notNull().default(0),
    expired: doublePrecision('expired').notNull().default(0),
    nearExpiry: doublePrecision('near_expiry').notNull().default(0),
    sold7d: doublePrecision('sold_7d').notNull().default(0),
    sold15d: doublePrecision('sold_15d').notNull().default(0),
    sold30d: doublePrecision('sold_30d').notNull().default(0),
    generatedAt: text('generated_at').notNull().default(''),
  },
  (t) => [primaryKey({ name: 'bk_inventory_pk', columns: [t.profileId, t.snapshotDate, t.itemId, t.facilityId] })]
);

/** SKU mapper: keyed by Item ID when present, else the normalised product name. */
export const bkSkuMap = pgTable(
  'bk_sku_map',
  {
    profileId: text('profile_id').notNull(),
    /** "id:10205042" | "name:eatopia choco nut spread" */
    key: text('key').notNull(),
    productName: text('product_name').notNull().default(''),
    sku: text('sku').notNull().default(''),
    category: text('category').notNull().default(''),
    price: doublePrecision('price'),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.key] })]
);

/** Campaign mapper(s). `source` lets a category mapper and a city mapper coexist; each re-ingest replaces only its own source. */
export const bkCampaignMap = pgTable(
  'bk_campaign_map',
  {
    profileId: text('profile_id').notNull(),
    source: text('source').notNull(),
    /** "id:511834" | "name:honey fh sp top city h wes" */
    key: text('key').notNull(),
    campaignId: text('campaign_id').notNull().default(''),
    campaignName: text('campaign_name').notNull().default(''),
    category: text('category').notNull().default(''),
    sku: text('sku').notNull().default(''),
    city: text('city').notNull().default(''),
    targeting: text('targeting').notNull().default(''),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.source, t.key] })]
);
