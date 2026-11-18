import {
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';

/**
 * Seller Central (FBA) fact tables. Tenant key `brand_id`; unit of analysis is
 * MSKU, with ASIN and FNSKU carried along. Counts are additive integers (ledger
 * outflows are negative in the source and stored as-is); every ratio is derived
 * at query time. Re-exported from db/schema.ts so drizzle-kit sees them.
 */

/** Inventory Ledger — Summary view. One row per brand × date × FNSKU × disposition × FC. */
export const scLedgerSummary = pgTable(
  'sc_ledger_summary',
  {
    brandId: text('brand_id').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    fnsku: text('fnsku').notNull(),
    disposition: text('disposition').notNull(),
    location: text('location').notNull(),
    asin: text('asin').notNull().default(''),
    msku: text('msku').notNull().default(''),
    title: text('title'),
    startingBalance: integer('starting_balance').notNull().default(0),
    inTransitBetween: integer('in_transit_between').notNull().default(0),
    receipts: integer('receipts').notNull().default(0),
    customerShipments: integer('customer_shipments').notNull().default(0),
    customerReturns: integer('customer_returns').notNull().default(0),
    vendorReturns: integer('vendor_returns').notNull().default(0),
    warehouseTransfer: integer('warehouse_transfer').notNull().default(0),
    found: integer('found').notNull().default(0),
    lost: integer('lost').notNull().default(0),
    damaged: integer('damaged').notNull().default(0),
    disposed: integer('disposed').notNull().default(0),
    otherEvents: integer('other_events').notNull().default(0),
    endingBalance: integer('ending_balance').notNull().default(0),
    unknownEvents: integer('unknown_events').notNull().default(0),
    uploadId: text('upload_id'),
  },
  (t) => [
    primaryKey({ columns: [t.brandId, t.date, t.fnsku, t.disposition, t.location] }),
    index('sc_ledger_summary_brand_date_idx').on(t.brandId, t.date),
    index('sc_ledger_summary_brand_loc_idx').on(t.brandId, t.location),
  ]
);

/** Inventory Ledger — Detailed view. One row per event; `row_hash` dedupes the full row. */
export const scLedgerDetail = pgTable(
  'sc_ledger_detail',
  {
    brandId: text('brand_id').notNull(),
    rowHash: text('row_hash').notNull(),
    date: date('date', { mode: 'string' }).notNull(),
    fnsku: text('fnsku').notNull().default(''),
    asin: text('asin').notNull().default(''),
    msku: text('msku').notNull().default(''),
    title: text('title'),
    eventType: text('event_type').notNull().default(''),
    referenceId: text('reference_id').notNull().default(''),
    quantity: integer('quantity').notNull().default(0),
    fulfillmentCenter: text('fulfillment_center').notNull().default(''),
    disposition: text('disposition').notNull().default(''),
    reason: text('reason'),
    country: text('country'),
    uploadId: text('upload_id'),
  },
  (t) => [
    primaryKey({ columns: [t.brandId, t.rowHash] }),
    index('sc_ledger_detail_brand_ref_idx').on(t.brandId, t.referenceId),
    index('sc_ledger_detail_brand_date_idx').on(t.brandId, t.date),
  ]
);

/** FBA Inventory snapshot (national per SKU). Unknown columns kept in `extra`. */
export const scFbaInventory = pgTable(
  'sc_fba_inventory',
  {
    brandId: text('brand_id').notNull(),
    snapshotDate: date('snapshot_date', { mode: 'string' }).notNull(),
    sku: text('sku').notNull(),
    fnsku: text('fnsku').notNull().default(''),
    asin: text('asin').notNull().default(''),
    productName: text('product_name'),
    available: integer('available').notNull().default(0),
    inboundQuantity: integer('inbound_quantity').notNull().default(0),
    inboundWorking: integer('inbound_working').notNull().default(0),
    inboundShipped: integer('inbound_shipped').notNull().default(0),
    inboundReceived: integer('inbound_received').notNull().default(0),
    reserved: integer('reserved').notNull().default(0),
    unfulfillable: integer('unfulfillable').notNull().default(0),
    unitsShipped7: integer('units_shipped_7'),
    unitsShipped30: integer('units_shipped_30'),
    unitsShipped60: integer('units_shipped_60'),
    unitsShipped90: integer('units_shipped_90'),
    daysOfSupply: numeric('days_of_supply', { precision: 12, scale: 2, mode: 'number' }),
    weeksOfCoverT30: numeric('weeks_of_cover_t30', { precision: 12, scale: 2, mode: 'number' }),
    sellThrough: numeric('sell_through', { precision: 12, scale: 4, mode: 'number' }),
    recommendedShipInQty: integer('recommended_ship_in_qty'),
    recommendedShipInDate: text('recommended_ship_in_date'),
    alert: text('alert'),
    extra: jsonb('extra').$type<Record<string, unknown>>(),
    uploadId: text('upload_id'),
  },
  (t) => [
    primaryKey({ columns: [t.brandId, t.snapshotDate, t.sku] }),
    index('sc_fba_inventory_brand_snap_idx').on(t.brandId, t.snapshotDate),
  ]
);

/** Shipments list — current state per shipment (UPSERT on brand × shipment ID). */
export const scShipments = pgTable(
  'sc_shipments',
  {
    brandId: text('brand_id').notNull(),
    shipmentId: text('shipment_id').notNull(),
    shipmentName: text('shipment_name').notNull().default(''),
    status: text('status').notNull().default(''),
    created: date('created', { mode: 'string' }),
    lastUpdated: date('last_updated', { mode: 'string' }),
    destination: text('destination').notNull().default(''),
    deliveryWindow: text('delivery_window'),
    skus: integer('skus').notNull().default(0),
    unitsExpected: integer('units_expected').notNull().default(0),
    unitsLocated: integer('units_located').notNull().default(0),
    uploadId: text('upload_id'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.brandId, t.shipmentId] }),
    index('sc_shipments_brand_status_idx').on(t.brandId, t.status),
    index('sc_shipments_brand_dest_idx').on(t.brandId, t.destination),
  ]
);

/** Dated history of each shipment's state (one row per upload date). */
export const scShipmentsHistory = pgTable(
  'sc_shipments_history',
  {
    brandId: text('brand_id').notNull(),
    shipmentId: text('shipment_id').notNull(),
    asOf: date('as_of', { mode: 'string' }).notNull(),
    status: text('status').notNull().default(''),
    unitsExpected: integer('units_expected').notNull().default(0),
    unitsLocated: integer('units_located').notNull().default(0),
    uploadId: text('upload_id'),
  },
  (t) => [primaryKey({ columns: [t.brandId, t.shipmentId, t.asOf] })]
);

/** Shipment contents — SKU-level units shipped vs received, per shipment. */
export const scShipmentContents = pgTable(
  'sc_shipment_contents',
  {
    brandId: text('brand_id').notNull(),
    shipmentId: text('shipment_id').notNull(),
    sku: text('sku').notNull(),
    fnsku: text('fnsku').notNull().default(''),
    asin: text('asin').notNull().default(''),
    unitsShipped: integer('units_shipped').notNull().default(0),
    unitsReceived: integer('units_received').notNull().default(0),
    uploadId: text('upload_id'),
  },
  (t) => [primaryKey({ columns: [t.brandId, t.shipmentId, t.sku] })]
);
