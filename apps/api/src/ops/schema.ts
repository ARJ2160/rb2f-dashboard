import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/**
 * Amazon Inventory / PO / Shipment module tables.
 *
 * Tenant key is `brand_id` (the ops brand registry), the counterpart to the
 * ads module's `profile_id`. Shared dimensions (brands, FC warehouses) have no
 * prefix; per-channel fact tables added in later phases use `vc_` / `sc_`.
 *
 * Re-exported from db/schema.ts so drizzle-kit sees them.
 */

/** Ops brand registry. `id` is a short slug used as the tenant key on every ops row. */
export const brands = pgTable('brands', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  logoUrl: text('logo_url'),
  /** Vendor Central vendor code(s). */
  vendorCodes: text('vendor_codes')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  /** Seller Central seller / merchant ID(s). */
  sellerIds: text('seller_ids')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  marketplace: text('marketplace').notNull().default('Amazon.in'),
  active: boolean('active').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Which channels a brand actually uses, recomputed after every upload. Drives
 * adaptive navigation: a VC-only brand never sees Seller Central pages.
 */
export const brandChannels = pgTable('brand_channels', {
  brandId: text('brand_id').primaryKey(),
  hasVendorCentral: boolean('has_vendor_central').notNull().default(false),
  hasSellerCentral: boolean('has_seller_central').notNull().default(false),
  lastVcUpload: date('last_vc_upload', { mode: 'string' }),
  lastScUpload: date('last_sc_upload', { mode: 'string' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/** Per-brand thresholds and metric choices; null columns fall back to the global defaults. */
export const brandSettings = pgTable('brand_settings', {
  brandId: text('brand_id').primaryKey(),
  criticalDays: integer('critical_days').notNull().default(12),
  excessDays: integer('excess_days').notNull().default(60),
  dueSoonDays: integer('due_soon_days').notNull().default(3),
  vcSalesMetric: text('vc_sales_metric').notNull().default('Shipped Units'),
  vcRevenueMetric: text('vc_revenue_metric').notNull().default('Shipped Revenue'),
  stuckReceivingDays: integer('stuck_receiving_days').notNull().default(14),
  workingTooLongDays: integer('working_too_long_days').notNull().default(5),
  inTransitTooLongDays: integer('in_transit_too_long_days').notNull().default(10),
  fillGood: integer('fill_good').notNull().default(85),
  fillBad: integer('fill_bad').notNull().default(60),
  notAcceptedBad: integer('not_accepted_bad').notNull().default(20),
  demandChangeAlert: integer('demand_change_alert').notNull().default(30),
  noPoAlertDays: integer('no_po_alert_days').notNull().default(21),
  returnRateBad: integer('return_rate_bad').notNull().default(5),
  agedShareBad: integer('aged_share_bad').notNull().default(20),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Amazon's FC network — shared by every brand and both channels (a code means
 * the same place for all). `network`: 'Core' (regular FCs) or 'Amazon Now'
 * (quick-commerce nodes). A code first seen in any upload is inserted
 * automatically and flagged `needs_review` until city/state are filled in.
 */
export const dimWarehouse = pgTable('dim_warehouse', {
  code: text('code').primaryKey(),
  network: text('network').notNull().default('Core'),
  city: text('city'),
  state: text('state'),
  needsReview: boolean('needs_review').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Product catalogue per brand, built automatically from uploads. Keyed on the
 * three Amazon identifiers (any may be '' depending on the channel): VC rows
 * carry an ASIN, SC rows an MSKU + FNSKU. `short_name` = title up to the first
 * '|', capped at 70 chars.
 */
export const dimProduct = pgTable(
  'dim_product',
  {
    brandId: text('brand_id').notNull(),
    asin: text('asin').notNull().default(''),
    msku: text('msku').notNull().default(''),
    fnsku: text('fnsku').notNull().default(''),
    modelNumber: text('model_number'),
    title: text('title'),
    shortName: text('short_name'),
    extra: jsonb('extra').$type<Record<string, unknown>>(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.brandId, t.asin, t.msku, t.fnsku] }),
    index('dim_product_brand_idx').on(t.brandId),
  ]
);

/** Ops upload audit trail — one row per uploaded file (the counterpart to `uploads` in the ads module). */
export const importBatches = pgTable(
  'import_batches',
  {
    id: text('id').primaryKey(),
    brandId: text('brand_id').notNull(),
    filename: text('filename').notNull(),
    fileType: text('file_type'),
    channel: text('channel'),
    status: text('status').notNull(),
    rows: integer('rows').notNull().default(0),
    headersFound: integer('headers_found'),
    dateFrom: date('date_from', { mode: 'string' }),
    dateTo: date('date_to', { mode: 'string' }),
    identifierWarning: text('identifier_warning'),
    message: text('message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('import_batches_brand_created_idx').on(t.brandId, t.createdAt)]
);
