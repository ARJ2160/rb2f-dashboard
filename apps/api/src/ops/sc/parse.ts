import { createHash } from 'node:crypto';

import { parseDateCell, plausible } from '../../lib/dates';
import { hasColumn, num, pick, str, type Row } from '../../lib/values';
import type { ParseContext } from '../../ingestion/parsers/types';

/**
 * Seller Central parsers. Each maps raw rows to records that match the sc_*
 * table shapes (store.ts inserts them directly). Columns are read by header
 * name, never position; the ledger `Date` is Amazon's US MM/DD/YYYY.
 */

export interface ScProductDim {
  asin: string;
  msku: string;
  fnsku: string;
  title: string | null;
}

export interface ScParseBase {
  rowsRead: number;
  warnings: string[];
  error?: string;
  from: string | null;
  to: string | null;
  products: ScProductDim[];
  warehouses: string[];
}

const UScode = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const pad = (s: string) => s.padStart(2, '0');
/** Inventory Ledger `Date` is MM/DD/YYYY (US); fall back to the general parser for anything else. */
function usDate(raw: unknown): string | null {
  const m = str(raw).match(UScode);
  if (m) return plausible(`${m[3]}-${pad(m[1]!)}-${pad(m[2]!)}`);
  return plausible(parseDateCell(raw));
}
const int = (r: Row, aliases: string[]) => Math.round(num(pick(r, aliases)));
const range = (dates: string[]): { from: string | null; to: string | null } => {
  const s = [...dates].filter(Boolean).sort();
  return s.length ? { from: s[0]!, to: s[s.length - 1]! } : { from: null, to: null };
};
const upper = (r: Row, aliases: string[]) => str(pick(r, aliases)).toUpperCase();
const dedupeProducts = (ps: ScProductDim[]): ScProductDim[] => {
  const m = new Map<string, ScProductDim>();
  for (const p of ps) m.set(`${p.asin}|${p.msku}|${p.fnsku}`, p);
  return [...m.values()];
};

// ── Inventory Ledger — Summary ──────────────────────────────────────────────

export interface ScLedgerRecord {
  date: string;
  fnsku: string;
  disposition: string;
  location: string;
  asin: string;
  msku: string;
  title: string | null;
  startingBalance: number;
  inTransitBetween: number;
  receipts: number;
  customerShipments: number;
  customerReturns: number;
  vendorReturns: number;
  warehouseTransfer: number;
  found: number;
  lost: number;
  damaged: number;
  disposed: number;
  otherEvents: number;
  endingBalance: number;
  unknownEvents: number;
}

export interface ScLedgerParse extends ScParseBase {
  records: ScLedgerRecord[];
}

export function parseLedgerSummary(headers: string[], rows: Row[], _ctx: ParseContext): ScLedgerParse {
  const warnings: string[] = [];
  if (!hasColumn(headers, ['Ending Warehouse Balance']) || !hasColumn(headers, ['Location'])) {
    return {
      records: [],
      products: [],
      warehouses: [],
      rowsRead: rows.length,
      warnings,
      error: 'Not an Inventory Ledger Summary (missing Ending Warehouse Balance / Location).',
      from: null,
      to: null,
    };
  }
  const records: ScLedgerRecord[] = [];
  const products: ScProductDim[] = [];
  const warehouses = new Set<string>();
  const dates: string[] = [];
  let skipped = 0;

  for (const r of rows) {
    const date = usDate(pick(r, ['Date']));
    const fnsku = str(pick(r, ['FNSKU']));
    const disposition = str(pick(r, ['Disposition'])) || 'UNKNOWN';
    const location = upper(r, ['Location']);
    if (!date || !fnsku || !location) {
      skipped++;
      continue;
    }
    const asin = upper(r, ['ASIN']);
    const msku = str(pick(r, ['MSKU']));
    const title = str(pick(r, ['Title'])) || null;
    dates.push(date);
    warehouses.add(location);
    products.push({ asin, msku, fnsku, title });
    records.push({
      date,
      fnsku,
      disposition,
      location,
      asin,
      msku,
      title,
      startingBalance: int(r, ['Starting Warehouse Balance']),
      inTransitBetween: int(r, ['In Transit Between Warehouses']),
      receipts: int(r, ['Receipts']),
      customerShipments: int(r, ['Customer Shipments']),
      customerReturns: int(r, ['Customer Returns']),
      vendorReturns: int(r, ['Vendor Returns']),
      warehouseTransfer: int(r, ['Warehouse Transfer In/Out']),
      found: int(r, ['Found']),
      lost: int(r, ['Lost']),
      damaged: int(r, ['Damaged']),
      disposed: int(r, ['Disposed']),
      otherEvents: int(r, ['Other Events']),
      endingBalance: int(r, ['Ending Warehouse Balance']),
      unknownEvents: int(r, ['Unknown Events']),
    });
  }
  if (skipped) warnings.push(`${skipped} row(s) skipped (missing date, FNSKU or location).`);
  return {
    records,
    products: dedupeProducts(products),
    warehouses: [...warehouses],
    rowsRead: rows.length,
    warnings,
    ...range(dates),
  };
}

// ── FBA Inventory snapshot ──────────────────────────────────────────────────

export interface ScFbaRecord {
  snapshotDate: string;
  sku: string;
  fnsku: string;
  asin: string;
  productName: string | null;
  available: number;
  inboundQuantity: number;
  inboundWorking: number;
  inboundShipped: number;
  inboundReceived: number;
  reserved: number;
  unfulfillable: number;
  unitsShipped7: number | null;
  unitsShipped30: number | null;
  unitsShipped60: number | null;
  unitsShipped90: number | null;
  daysOfSupply: number | null;
  weeksOfCoverT30: number | null;
  sellThrough: number | null;
  recommendedShipInQty: number | null;
  recommendedShipInDate: string | null;
  alert: string | null;
  extra: Record<string, unknown> | null;
}

export interface ScFbaParse extends ScParseBase {
  records: ScFbaRecord[];
  missingColumns: string[];
}

const FBA_ALIASES = {
  snapshotDate: ['snapshot-date'],
  sku: ['sku'],
  fnsku: ['fnsku'],
  asin: ['asin'],
  productName: ['product-name'],
  available: ['available'],
  inboundQuantity: ['inbound-quantity'],
  inboundWorking: ['inbound-working'],
  inboundShipped: ['inbound-shipped'],
  inboundReceived: ['inbound-received'],
  reserved: ['Total Reserved Quantity', 'reserved-quantity'],
  unfulfillable: ['unfulfillable-quantity'],
  unitsShipped7: ['units-shipped-t7', 'sales-shipped-last-7-days'],
  unitsShipped30: ['units-shipped-t30', 'sales-shipped-last-30-days'],
  unitsShipped60: ['units-shipped-t60', 'sales-shipped-last-60-days'],
  unitsShipped90: ['units-shipped-t90', 'sales-shipped-last-90-days'],
  daysOfSupply: ['days-of-supply'],
  weeksOfCoverT30: ['weeks-of-cover-t30'],
  sellThrough: ['sell-through'],
  recommendedShipInQty: ['Recommended ship-in quantity', 'recommended-ship-in-quantity'],
  recommendedShipInDate: ['Recommended ship-in date', 'recommended-ship-in-date'],
  alert: ['alert'],
} satisfies Record<string, string[]>;

const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

export function parseFbaInventory(headers: string[], rows: Row[], _ctx: ParseContext): ScFbaParse {
  const warnings: string[] = [];
  if (!hasColumn(headers, FBA_ALIASES.snapshotDate) || !hasColumn(headers, FBA_ALIASES.sku)) {
    return {
      records: [],
      products: [],
      warehouses: [],
      missingColumns: [],
      rowsRead: rows.length,
      warnings,
      error: 'Not an FBA Inventory export (missing snapshot-date / sku).',
      from: null,
      to: null,
    };
  }
  // Columns we consume → anything else goes into `extra` so nothing is lost.
  const consumed = new Set<string>();
  for (const aliases of Object.values(FBA_ALIASES)) for (const a of aliases) consumed.add(normKey(a));
  const expected = ['available', 'units-shipped-t30', 'sales-shipped-last-30-days'];
  const missingColumns = expected.filter((c) => !hasColumn(headers, [c]));
  if (missingColumns.includes('available'))
    warnings.push('No `available` column — sellable stock from FBA Inventory will be 0.');

  const records: ScFbaRecord[] = [];
  const products: ScProductDim[] = [];
  const dates: string[] = [];
  let skipped = 0;

  const n = (r: Row, a: string[]) => Math.round(num(pick(r, a)));
  const nOrNull = (r: Row, a: string[]) => (pick(r, a) == null ? null : Math.round(num(pick(r, a))));
  const fOrNull = (r: Row, a: string[]) => (pick(r, a) == null ? null : num(pick(r, a)));

  for (const r of rows) {
    const snapshotDate = plausible(parseDateCell(pick(r, FBA_ALIASES.snapshotDate)));
    const sku = str(pick(r, FBA_ALIASES.sku));
    if (!snapshotDate || !sku) {
      skipped++;
      continue;
    }
    const asin = str(pick(r, FBA_ALIASES.asin)).toUpperCase();
    const fnsku = str(pick(r, FBA_ALIASES.fnsku));
    const productName = str(pick(r, FBA_ALIASES.productName)) || null;
    dates.push(snapshotDate);
    products.push({ asin, msku: sku, fnsku, title: productName });

    const extra: Record<string, unknown> = {};
    for (const k of Object.keys(r)) {
      if (k.startsWith('__')) continue;
      if (consumed.has(normKey(k))) continue;
      const v = r[k];
      if (v !== '' && v != null) extra[k] = v;
    }

    records.push({
      snapshotDate,
      sku,
      fnsku,
      asin,
      productName,
      available: n(r, FBA_ALIASES.available),
      inboundQuantity: n(r, FBA_ALIASES.inboundQuantity),
      inboundWorking: n(r, FBA_ALIASES.inboundWorking),
      inboundShipped: n(r, FBA_ALIASES.inboundShipped),
      inboundReceived: n(r, FBA_ALIASES.inboundReceived),
      reserved: n(r, FBA_ALIASES.reserved),
      unfulfillable: n(r, FBA_ALIASES.unfulfillable),
      unitsShipped7: nOrNull(r, FBA_ALIASES.unitsShipped7),
      unitsShipped30: nOrNull(r, FBA_ALIASES.unitsShipped30),
      unitsShipped60: nOrNull(r, FBA_ALIASES.unitsShipped60),
      unitsShipped90: nOrNull(r, FBA_ALIASES.unitsShipped90),
      daysOfSupply: fOrNull(r, FBA_ALIASES.daysOfSupply),
      weeksOfCoverT30: fOrNull(r, FBA_ALIASES.weeksOfCoverT30),
      sellThrough: fOrNull(r, FBA_ALIASES.sellThrough),
      recommendedShipInQty: nOrNull(r, FBA_ALIASES.recommendedShipInQty),
      recommendedShipInDate: str(pick(r, FBA_ALIASES.recommendedShipInDate)) || null,
      alert: str(pick(r, FBA_ALIASES.alert)) || null,
      extra: Object.keys(extra).length ? extra : null,
    });
  }
  if (skipped) warnings.push(`${skipped} row(s) skipped (missing snapshot-date or sku).`);
  if (missingColumns.length) warnings.push(`Missing expected columns: ${missingColumns.join(', ')}.`);
  return {
    records,
    products: dedupeProducts(products),
    warehouses: [],
    missingColumns,
    rowsRead: rows.length,
    warnings,
    ...range(dates),
  };
}

// ── Shipments list ──────────────────────────────────────────────────────────

export interface ScShipmentRecord {
  shipmentId: string;
  shipmentName: string;
  status: string;
  created: string | null;
  lastUpdated: string | null;
  destination: string;
  deliveryWindow: string | null;
  skus: number;
  unitsExpected: number;
  unitsLocated: number;
}

export interface ScShipmentParse extends ScParseBase {
  records: ScShipmentRecord[];
  asOf: string | null;
}

/** Shipment ID = the code in the LAST parentheses of the shipment name. */
export function shipmentIdFromName(name: string): string | null {
  const matches = [...name.matchAll(/\(([^)]*)\)/g)];
  const last = matches.at(-1)?.[1]?.trim();
  return last && /^[A-Za-z0-9]+$/.test(last) ? last : null;
}

export function parseShipments(headers: string[], rows: Row[], _ctx: ParseContext): ScShipmentParse {
  const warnings: string[] = [];
  if (!hasColumn(headers, ['Shipment name']) || !hasColumn(headers, ['Units expected'])) {
    return {
      records: [],
      products: [],
      warehouses: [],
      asOf: null,
      rowsRead: rows.length,
      warnings,
      error: 'Not a Shipments list (missing Shipment name / Units expected).',
      from: null,
      to: null,
    };
  }
  const records: ScShipmentRecord[] = [];
  const warehouses = new Set<string>();
  const dates: string[] = [];
  let skipped = 0;

  for (const r of rows) {
    const shipmentName = str(pick(r, ['Shipment name']));
    const shipmentId = shipmentIdFromName(shipmentName);
    if (!shipmentId) {
      skipped++;
      continue;
    }
    const created = plausible(parseDateCell(pick(r, ['Created'])));
    const lastUpdated = plausible(parseDateCell(pick(r, ['Last updated'])));
    const destination = upper(r, ['Destination']);
    if (destination) warehouses.add(destination);
    if (created) dates.push(created);
    if (lastUpdated) dates.push(lastUpdated);
    records.push({
      shipmentId,
      shipmentName,
      status: str(pick(r, ['Status'])),
      created,
      lastUpdated,
      destination,
      deliveryWindow: str(pick(r, ['Delivery window'])) || null,
      skus: Math.round(num(pick(r, ['SKUs']))),
      unitsExpected: Math.round(num(pick(r, ['Units expected']))),
      unitsLocated: Math.round(num(pick(r, ['Units located']))),
    });
  }
  if (skipped) warnings.push(`${skipped} shipment(s) skipped (could not read a shipment ID from the name).`);
  const r = range(dates);
  return {
    records,
    products: [],
    warehouses: [...warehouses],
    asOf: r.to,
    rowsRead: rows.length,
    warnings,
    ...r,
  };
}

// ── Inventory Ledger — Detailed (optional) ──────────────────────────────────

export interface ScLedgerDetailRecord {
  rowHash: string;
  date: string;
  fnsku: string;
  asin: string;
  msku: string;
  title: string | null;
  eventType: string;
  referenceId: string;
  quantity: number;
  fulfillmentCenter: string;
  disposition: string;
  reason: string | null;
  country: string | null;
}

export interface ScLedgerDetailParse extends ScParseBase {
  records: ScLedgerDetailRecord[];
}

export function parseLedgerDetail(headers: string[], rows: Row[], _ctx: ParseContext): ScLedgerDetailParse {
  const warnings: string[] = [];
  if (
    !hasColumn(headers, ['Event Type']) ||
    !hasColumn(headers, ['Fulfillment Center', 'Fulfilment Center'])
  ) {
    return {
      records: [],
      products: [],
      warehouses: [],
      rowsRead: rows.length,
      warnings,
      error: 'Not an Inventory Ledger Detailed view (missing Event Type / Fulfillment Center).',
      from: null,
      to: null,
    };
  }
  const seen = new Set<string>();
  const records: ScLedgerDetailRecord[] = [];
  const products: ScProductDim[] = [];
  const warehouses = new Set<string>();
  const dates: string[] = [];

  for (const r of rows) {
    const date = usDate(pick(r, ['Date']));
    if (!date) continue;
    const fnsku = str(pick(r, ['FNSKU']));
    const asin = upper(r, ['ASIN']);
    const msku = str(pick(r, ['MSKU']));
    const title = str(pick(r, ['Title'])) || null;
    const eventType = str(pick(r, ['Event Type']));
    const referenceId = str(pick(r, ['Reference ID']));
    const quantity = Math.round(num(pick(r, ['Quantity'])));
    const fulfillmentCenter = upper(r, ['Fulfillment Center', 'Fulfilment Center']);
    const disposition = str(pick(r, ['Disposition']));
    const reason = str(pick(r, ['Reason'])) || null;
    const country = str(pick(r, ['Country'])) || null;
    const rowHash = createHash('sha1')
      .update(
        [
          date,
          fnsku,
          asin,
          msku,
          eventType,
          referenceId,
          quantity,
          fulfillmentCenter,
          disposition,
          reason,
          country,
        ].join('\u0001')
      )
      .digest('hex');
    if (seen.has(rowHash)) continue;
    seen.add(rowHash);
    if (fulfillmentCenter) warehouses.add(fulfillmentCenter);
    dates.push(date);
    products.push({ asin, msku, fnsku, title });
    records.push({
      rowHash,
      date,
      fnsku,
      asin,
      msku,
      title,
      eventType,
      referenceId,
      quantity,
      fulfillmentCenter,
      disposition,
      reason,
      country,
    });
  }
  return {
    records,
    products: dedupeProducts(products),
    warehouses: [...warehouses],
    rowsRead: rows.length,
    warnings,
    ...range(dates),
  };
}

// ── Shipment contents (optional) ────────────────────────────────────────────

export interface ScShipmentContentRecord {
  shipmentId: string;
  sku: string;
  fnsku: string;
  asin: string;
  unitsShipped: number;
  unitsReceived: number;
}

export interface ScShipmentContentParse extends ScParseBase {
  records: ScShipmentContentRecord[];
}

export function parseShipmentContents(
  headers: string[],
  rows: Row[],
  _ctx: ParseContext
): ScShipmentContentParse {
  const warnings: string[] = [];
  const hasId = hasColumn(headers, ['Shipment ID', 'Shipment Id', 'FBA Shipment ID']);
  if (!hasId || !hasColumn(headers, ['MSKU', 'SKU', 'Merchant SKU'])) {
    return {
      records: [],
      products: [],
      warehouses: [],
      rowsRead: rows.length,
      warnings,
      error: 'Not a Shipment contents export (missing Shipment ID / SKU).',
      from: null,
      to: null,
    };
  }
  const records: ScShipmentContentRecord[] = [];
  const products: ScProductDim[] = [];
  let skipped = 0;
  for (const r of rows) {
    const shipmentId = str(pick(r, ['Shipment ID', 'Shipment Id', 'FBA Shipment ID']));
    const sku = str(pick(r, ['MSKU', 'SKU', 'Merchant SKU']));
    if (!shipmentId || !sku) {
      skipped++;
      continue;
    }
    const fnsku = str(pick(r, ['FNSKU']));
    const asin = str(pick(r, ['ASIN'])).toUpperCase();
    products.push({ asin, msku: sku, fnsku, title: null });
    records.push({
      shipmentId,
      sku,
      fnsku,
      asin,
      unitsShipped: Math.round(
        num(pick(r, ['Shipped', 'Units shipped', 'Shipped quantity', 'Quantity shipped']))
      ),
      unitsReceived: Math.round(
        num(pick(r, ['Received', 'Units received', 'Received quantity', 'Quantity received']))
      ),
    });
  }
  if (skipped) warnings.push(`${skipped} content row(s) skipped (missing shipment ID or SKU).`);
  return {
    records,
    products: dedupeProducts(products),
    warehouses: [],
    rowsRead: rows.length,
    warnings,
    from: null,
    to: null,
  };
}
