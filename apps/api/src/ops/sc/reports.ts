import { sql } from 'drizzle-orm';

import { db } from '../../db/client';
import { getBrandSettings } from '../settings';
import { buildScViews, type FbaRow, type LedgerRow, type ScViews, type ShipmentRow } from './build';
import type { ScThresholds } from './metrics';

/**
 * Seller Central reports. SQL loads the brand's rows (filtered to the window);
 * all metric derivation happens in build.ts so every view shows identical,
 * unit-tested numbers.
 */

export interface ScFilters {
  from?: string | undefined;
  to?: string | undefined;
}

type Raw = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const s = (v: unknown) => (v == null ? '' : String(v));
const sOrNull = (v: unknown) => (v == null || v === '' ? null : String(v));

async function loadScData(brandId: string, f: ScFilters) {
  const fromCond = f.from ? sql` and date >= ${f.from}` : sql``;
  const toCond = f.to ? sql` and date <= ${f.to}` : sql``;

  const ledgerRows = await db.execute<Raw>(sql`
    select date::text as date, fnsku, msku, asin, title, location, disposition,
           ending_balance, customer_shipments, customer_returns, receipts,
           warehouse_transfer, lost, damaged, disposed
    from sc_ledger_summary
    where brand_id = ${brandId}${fromCond}${toCond}`);

  const fbaRows = await db.execute<Raw>(sql`
    select distinct on (sku) sku, inbound_working, inbound_shipped, inbound_received, inbound_quantity
    from sc_fba_inventory
    where brand_id = ${brandId}
    order by sku, snapshot_date desc`);

  const shipmentRows = await db.execute<Raw>(sql`
    select shipment_id, shipment_name, status, created::text as created, last_updated::text as last_updated,
           destination, skus, units_expected, units_located
    from sc_shipments
    where brand_id = ${brandId}`);

  // DUR units per ASIN per date (Seller + Vendor), used as the DRR numerator for
  // the inventory views. brandId === profileId in this app, so daily_asin_sales
  // for the same id is this brand's sales. Only the last 30 ledger dates matter
  // (filtered in build.ts), so load the whole brand's rows and let build slice.
  const durRows = await db.execute<Raw>(sql`
    select date::text as date, asin, coalesce(sum(units), 0) as units
    from daily_asin_sales
    where profile_id = ${brandId} and asin <> ''
    group by date, asin`);

  // ASIN mapper category / title per ASIN (products.mapper_category), display only.
  const productRows = await db.execute<Raw>(sql`
    select asin, mapper_category, mapper_title, report_title
    from products
    where profile_id = ${brandId}`);

  const geoRows = await db.execute<Raw>(sql`select code, city, state from dim_warehouse`);

  const ledger: LedgerRow[] = ledgerRows.map((r) => ({
    date: s(r.date),
    fnsku: s(r.fnsku),
    msku: s(r.msku),
    asin: s(r.asin),
    title: sOrNull(r.title),
    location: s(r.location),
    disposition: s(r.disposition),
    endingBalance: n(r.ending_balance),
    customerShipments: n(r.customer_shipments),
    customerReturns: n(r.customer_returns),
    receipts: n(r.receipts),
    warehouseTransfer: n(r.warehouse_transfer),
    lost: n(r.lost),
    damaged: n(r.damaged),
    disposed: n(r.disposed),
  }));
  const fba: FbaRow[] = fbaRows.map((r) => ({
    sku: s(r.sku),
    inboundWorking: n(r.inbound_working),
    inboundShipped: n(r.inbound_shipped),
    inboundReceived: n(r.inbound_received),
    inboundQuantity: n(r.inbound_quantity),
  }));
  const shipments: ShipmentRow[] = shipmentRows.map((r) => ({
    shipmentId: s(r.shipment_id),
    shipmentName: s(r.shipment_name),
    status: s(r.status),
    created: sOrNull(r.created),
    lastUpdated: sOrNull(r.last_updated),
    destination: s(r.destination),
    skus: n(r.skus),
    unitsExpected: n(r.units_expected),
    unitsLocated: n(r.units_located),
  }));
  const geo = new Map<string, { city: string | null; state: string | null }>();
  for (const r of geoRows) geo.set(s(r.code), { city: sOrNull(r.city), state: sOrNull(r.state) });

  // DUR units per (asin, date) — the DRR numerator source.
  const durUnits: Array<{ asin: string; date: string; units: number }> = durRows.map((r) => ({
    asin: s(r.asin),
    date: s(r.date),
    units: n(r.units),
  }));
  // ASIN → mapper category (falls back to 'Unmapped' in build when an ASIN exists but has no mapper row).
  const asinCategory = new Map<string, string | null>();
  for (const r of productRows) asinCategory.set(s(r.asin), sOrNull(r.mapper_category));

  return { ledger, fba, shipments, geo, durUnits, asinCategory };
}

/** Build every Seller Central view for a brand (the frontend slices what it needs). */
export async function getScViews(brandId: string, f: ScFilters = {}): Promise<ScViews> {
  const settings = await getBrandSettings(brandId);
  const thresholds: ScThresholds = {
    criticalDays: settings.criticalDays,
    excessDays: settings.excessDays,
    returnRateBad: settings.returnRateBad,
    agedShareBad: settings.agedShareBad,
    demandChangeAlert: settings.demandChangeAlert,
    stuckReceivingDays: settings.stuckReceivingDays,
    workingTooLongDays: settings.workingTooLongDays,
    inTransitTooLongDays: settings.inTransitTooLongDays,
  };
  const { ledger, fba, shipments, geo, durUnits, asinCategory } = await loadScData(brandId, f);
  return buildScViews({ ledger, fba, shipments, geo, durUnits, asinCategory, thresholds });
}
