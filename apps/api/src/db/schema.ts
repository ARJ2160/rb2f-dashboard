import {
  pgTable,
  text,
  date,
  integer,
  numeric,
  timestamp,
  uuid,
  primaryKey,
  index,
  boolean,
  jsonb,
} from 'drizzle-orm/pg-core';

/**
 * Storage model: one row per (profile, date, grain-key, source).
 *
 * Only additive raw numbers are stored. Every ratio (AOV, CTR, ACoS…) is
 * derived at query time from sums, so any date range aggregates correctly.
 *
 * Re-uploading a report REPLACES that source's rows for the dates the file
 * contains (delete + insert in one transaction) — uploads are idempotent and
 * a corrected re-export simply overwrites the old numbers.
 *
 * `profile_id` partitions data per brand / seller account.
 */

/** Seller Central Business Report + Vendor Central sales, per ASIN per day. */
export const dailyAsinSales = pgTable(
  'daily_asin_sales',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    /** '' = the source row had no ASIN (kept, never dropped — rule book §10.2). */
    asin: text('asin').notNull(),
    /** 'seller' (Business Report) | 'vendor' (Vendor Central). */
    source: text('source').notNull(),
    /** Seller: Ordered Product Sales · Vendor: Ordered Revenue */
    sales: numeric('sales', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    /** Seller: Units Ordered · Vendor: Ordered Units */
    units: integer('units').notNull().default(0),
    /** Seller: Total Order Items · Vendor: null (not reported) */
    orderItems: integer('order_items'),
    /** Seller: Sessions - Total · Vendor: null (never backfilled — rule book §4) */
    sessions: integer('sessions'),
    /** Seller: Page Views - Total · Vendor: Glance Views (null if column absent) */
    pageViews: integer('page_views'),
    /** Vendor shipped units reported with ₹0 revenue — valued at query time × products.selling_price. */
    unpricedUnits: integer('unpriced_units'),
    uploadId: uuid('upload_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.date, t.asin, t.source] }),
    index('daily_asin_sales_profile_date_idx').on(t.profileId, t.date),
  ]
);

/** SP / SB / SD campaign reports, per campaign per day. */
export const dailyCampaignAds = pgTable(
  'daily_campaign_ads',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    /** 'sp' | 'sb' | 'sd' */
    channel: text('channel').notNull(),
    campaignName: text('campaign_name').notNull(),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    spend: numeric('spend', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    adSales: numeric('ad_sales', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    adUnits: integer('ad_units').notNull().default(0),
    uploadId: uuid('upload_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.date, t.channel, t.campaignName] }),
    index('daily_campaign_ads_profile_date_idx').on(t.profileId, t.date),
  ]
);

/**
 * SP / SD Advertised Product reports, per day × campaign × ASIN (summed over
 * ad groups). The ASIN-level ad source the rule book's Main View / DSR use
 * (§7, §10.1). Keeping the campaign lets campaign-level views (Ads analysis,
 * filters) inherit the advertised ASIN's category (§3). SB has no ASIN-level
 * spend — see sbAttributedDaily.
 */
export const dailyAsinAds = pgTable(
  'daily_asin_campaign_ads',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    /** 'sp' | 'sd' */
    channel: text('channel').notNull(),
    campaignName: text('campaign_name').notNull(),
    asin: text('asin').notNull(),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    spend: numeric('spend', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    adSales: numeric('ad_sales', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    adUnits: integer('ad_units').notNull().default(0),
    uploadId: uuid('upload_id'),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.date, t.channel, t.campaignName, t.asin] }),
    index('daily_asin_campaign_ads_profile_date_idx').on(t.profileId, t.date),
  ]
);

/** Hour-of-day campaign rows (campaign reports exported with "Start Time"). */
export const dailyHourlyAds = pgTable(
  'daily_hourly_ads',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    hour: integer('hour').notNull(),
    channel: text('channel').notNull(),
    campaignName: text('campaign_name').notNull(),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    spend: numeric('spend', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    adSales: numeric('ad_sales', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    adUnits: integer('ad_units').notNull().default(0),
    uploadId: uuid('upload_id'),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.date, t.hour, t.channel, t.campaignName] }),
    index('daily_hourly_ads_profile_date_idx').on(t.profileId, t.date),
  ]
);

/**
 * Per-campaign signals seen in reports (not date-dependent): the channel and
 * whether it is a video campaign (SBV / SDV) — from "SBV"/"SDV"/"video" in
 * campaign or ad-group names, or video-view metrics in the SB campaign report.
 */
export const campaignAttrs = pgTable(
  'campaign_attrs',
  {
    profileId: text('profile_id').notNull(),
    campaignKey: text('campaign_key').notNull(),
    campaignName: text('campaign_name').notNull(),
    channel: text('channel').notNull(),
    isVideo: boolean('is_video').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.campaignKey] })]
);

/**
 * Resolved campaign dimensions used by every campaign-level filter, rebuilt
 * after each upload (see refreshCampaignDims):
 *   ad_type   — SP / SB / SBV / SD / SDV
 *   category  — Campaign mapper Category, else the category of the ASINs the
 *               campaign advertises (Advertised Product / SB Attributed
 *               Purchases, by sales+spend) — rule book §3: a property of what
 *               is advertised, never of what is targeted. Else "Unmapped".
 *   targeting — Keyword / Product / Category / Auto / Audience
 *   branding  — Branded / Competitor / Generic (mapper "Branded" wins, else
 *               the campaign's dominant search-term class by spend)
 */
export const campaignDims = pgTable(
  'campaign_dims',
  {
    profileId: text('profile_id').notNull(),
    campaignKey: text('campaign_key').notNull(),
    campaignName: text('campaign_name').notNull(),
    channel: text('channel'),
    adType: text('ad_type').notNull(),
    category: text('category').notNull(),
    categorySource: text('category_source').notNull(),
    targeting: text('targeting').notNull(),
    branding: text('branding').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.campaignKey] })]
);

/** Search term → Branded / Competitor / Generic, rebuilt with campaign_dims (brand terms + ASIN mapper). */
export const searchTermClasses = pgTable(
  'search_term_classes',
  {
    profileId: text('profile_id').notNull(),
    searchTerm: text('search_term').notNull(),
    branding: text('branding').notNull(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.searchTerm] })]
);

/** Per-profile settings: brand terms used to classify search terms as Branded (rule book §6: stored as data, editable). */
export const profileSettings = pgTable('profile_settings', {
  profileId: text('profile_id').primaryKey(),
  brandTerms: jsonb('brand_terms').$type<string[]>().notNull().default([]),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * SB Attributed Purchases, per campaign × purchased ASIN per day. Ad Sales and
 * Ad Units come straight from here (never prorated); SB Spend / Impressions /
 * Clicks are prorated from daily_campaign_ads (channel 'sb') at QUERY time by
 * each ASIN's share of its campaign-day's attributed sales (rule book §5) —
 * so uploading either report later re-computes the split automatically.
 */
export const sbAttributedDaily = pgTable(
  'sb_attributed_daily',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    campaignName: text('campaign_name').notNull(),
    asin: text('asin').notNull(),
    adSales: numeric('ad_sales', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    adUnits: integer('ad_units').notNull().default(0),
    uploadId: uuid('upload_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.date, t.campaignName, t.asin] }),
    index('sb_attributed_daily_profile_date_idx').on(t.profileId, t.date),
  ]
);

/**
 * SP / SB Search Term reports and SD Targeting report, per day per campaign ×
 * target × search term (summed over ad groups). Category comes from the
 * Campaign mapper (rule book §3). For SD there is no customer search term, so
 * search_term = the targeting expression.
 */
export const dailySearchTerms = pgTable(
  'daily_search_terms',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    /** 'sp' | 'sb' | 'sd' */
    channel: text('channel').notNull(),
    campaignName: text('campaign_name').notNull(),
    /** Targeted keyword / ASIN expression ("Targeting" column). */
    target: text('target').notNull(),
    matchType: text('match_type').notNull(),
    /** Customer search term, lower-cased and trimmed. */
    searchTerm: text('search_term').notNull(),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    spend: numeric('spend', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    adSales: numeric('ad_sales', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    adUnits: integer('ad_units').notNull().default(0),
    uploadId: uuid('upload_id'),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.date, t.channel, t.campaignName, t.target, t.matchType, t.searchTerm] }),
    index('daily_search_terms_profile_date_idx').on(t.profileId, t.date),
  ]
);

/** SP / SB Placement reports, per day per campaign × placement. */
export const dailyPlacements = pgTable(
  'daily_placements',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    /** 'sp' | 'sb' */
    channel: text('channel').notNull(),
    campaignName: text('campaign_name').notNull(),
    /** Normalised: TOS / ROS / PDP, else Amazon's label. */
    placement: text('placement').notNull(),
    rawPlacement: text('raw_placement').notNull(),
    impressions: integer('impressions').notNull().default(0),
    clicks: integer('clicks').notNull().default(0),
    spend: numeric('spend', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    adSales: numeric('ad_sales', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    adUnits: integer('ad_units').notNull().default(0),
    uploadId: uuid('upload_id'),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.date, t.channel, t.campaignName, t.rawPlacement] }),
    index('daily_placements_profile_date_idx').on(t.profileId, t.date),
  ]
);

/**
 * Sales per ship-to state, per day per ASIN. Seller: Order report (shipped /
 * shipping lines only). Vendor: Vendor Central "View By = State" export, same
 * Ordered/Shipped rules and unpriced-unit valuation as daily_asin_sales.
 */
export const dailyStateSales = pgTable(
  'daily_state_sales',
  {
    profileId: text('profile_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    /** 'seller' | 'vendor' */
    source: text('source').notNull(),
    state: text('state').notNull(),
    asin: text('asin').notNull(),
    units: integer('units').notNull().default(0),
    sales: numeric('sales', { precision: 14, scale: 2, mode: 'number' }).notNull().default(0),
    /** Seller order lines; null for Vendor. */
    orders: integer('orders'),
    unpricedUnits: integer('unpriced_units'),
    uploadId: uuid('upload_id'),
  },
  (t) => [
    primaryKey({ columns: [t.profileId, t.date, t.source, t.state, t.asin] }),
    index('daily_state_sales_profile_date_idx').on(t.profileId, t.date),
  ]
);

/**
 * Campaign mapper (Campaign Name → Category, Type, Targeting, Branded…).
 * A mapper upload replaces the previous one for the profile.
 */
export const campaignMapper = pgTable(
  'campaign_mapper',
  {
    profileId: text('profile_id').notNull(),
    /** lower-cased, whitespace-collapsed campaign name — the join key. */
    campaignKey: text('campaign_key').notNull(),
    campaignName: text('campaign_name').notNull(),
    category: text('category'),
    type: text('type'),
    targeting: text('targeting'),
    branded: text('branded'),
    autoManual: text('auto_manual'),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.campaignKey] })]
);

/**
 * Product catalogue per profile. Category comes ONLY from the ASIN mapper
 * (rule book §3); titles come from the mapper or, failing that, the most
 * recent report that carried one.
 */
export const products = pgTable(
  'products',
  {
    profileId: text('profile_id').notNull(),
    asin: text('asin').notNull(),
    mapperCategory: text('mapper_category'),
    mapperTitle: text('mapper_title'),
    reportTitle: text('report_title'),
    /** From the ASIN mapper (Selling Price / Price / BAU / Event Price). */
    sellingPrice: numeric('selling_price', { precision: 12, scale: 2, mode: 'number' }),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.asin] })]
);

/** One row per uploaded file/sheet — the audit trail behind every number. */
export const uploads = pgTable(
  'uploads',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    profileId: text('profile_id').notNull(),
    filename: text('filename').notNull(),
    sheet: text('sheet'),
    reportType: text('report_type'),
    status: text('status').notNull(),
    dateFrom: date('date_from', { mode: 'string' }),
    dateTo: date('date_to', { mode: 'string' }),
    rowsRead: integer('rows_read').notNull().default(0),
    rowsStored: integer('rows_stored').notNull().default(0),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('uploads_profile_created_idx').on(t.profileId, t.createdAt)]
);

/**
 * GCS warehouse sync ledger: one row per bucket object ingested for a GCS
 * profile (`gcs_<brand>`). `generation` changes whenever the object is
 * overwritten, so unchanged files are skipped on the next sync.
 */
export const gcsObjects = pgTable(
  'gcs_objects',
  {
    profileId: text('profile_id').notNull(),
    /** Full object path in the bucket, e.g. `eatopia/amazon/campaign/x.csv`. */
    objectName: text('object_name').notNull(),
    generation: text('generation').notNull(),
    size: integer('size').notNull().default(0),
    objectUpdated: timestamp('object_updated', { withTimezone: true }),
    /** 'stored' | 'skipped' | 'error' */
    status: text('status').notNull(),
    /** Comma-separated report types detected in the file. */
    reportTypes: text('report_types'),
    rowsStored: integer('rows_stored').notNull().default(0),
    dateFrom: date('date_from', { mode: 'string' }),
    dateTo: date('date_to', { mode: 'string' }),
    message: text('message'),
    syncedAt: timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.profileId, t.objectName] })]
);
