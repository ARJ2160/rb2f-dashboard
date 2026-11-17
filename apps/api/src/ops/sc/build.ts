import type {
  ScShipmentRow as ApiShipmentRow,
  ScHealthCounts,
  ScSkuRow,
  ScSkuWarehouseRow,
  ScSummary,
  ScTrend,
  ScWarehouseRow,
} from '@dash/shared';

import {
  changePct,
  daysOnHand as doh,
  drr,
  fillRatePct,
  shipmentFlag,
  shipmentHealth,
  shipmentShortfall,
  skuFcFlag,
  skuFcHealth,
  skuHealth,
  skuStockFlag,
  warehouseHealth,
  SHIPMENT_INBOUND_STATUSES,
  type ScThresholds,
} from './metrics';

/** Raw rows the SQL layer loads (filtered to the brand + window). */
export interface LedgerRow {
  date: string;
  fnsku: string;
  msku: string;
  asin: string;
  title: string | null;
  location: string;
  disposition: string;
  endingBalance: number;
  customerShipments: number;
  customerReturns: number;
  receipts: number;
  warehouseTransfer: number;
  lost: number;
  damaged: number;
  disposed: number;
}
export interface FbaRow {
  sku: string;
  inboundWorking: number;
  inboundShipped: number;
  inboundReceived: number;
  inboundQuantity: number;
}
export interface ShipmentRow {
  shipmentId: string;
  shipmentName: string;
  status: string;
  created: string | null;
  lastUpdated: string | null;
  destination: string;
  skus: number;
  unitsExpected: number;
  unitsLocated: number;
}
export interface ScInput {
  ledger: LedgerRow[];
  fba: FbaRow[];
  shipments: ShipmentRow[];
  geo: Map<string, { city: string | null; state: string | null }>;
  /** DUR units per ASIN per date (Seller + Vendor). The DRR numerator source. */
  durUnits: Array<{ asin: string; date: string; units: number }>;
  /** ASIN → mapper category (null = ASIN has no mapper row → shown as 'Unmapped'). Display only. */
  asinCategory: Map<string, string | null>;
  thresholds: ScThresholds;
}

const SELLABLE = 'SELLABLE';
const skuKeyOf = (r: { msku: string; fnsku: string }) => r.msku || r.fnsku;
const shortName = (title: string | null, fallback: string) =>
  (title ? title.split('|')[0]!.trim().slice(0, 70) : '') || fallback;
const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 86_400_000);
const active = new Set(SHIPMENT_INBOUND_STATUSES.map((s) => s.toLowerCase()));

/** One (skuKey, location, date) cell of the ledger. */
interface Cell {
  sellableEnding: number;
  unsellableEnding: number;
  cust: number;
  returns: number;
  receipts: number;
  transfer: number;
  loss: number;
}
const emptyCell = (): Cell => ({ sellableEnding: 0, unsellableEnding: 0, cust: 0, returns: 0, receipts: 0, transfer: 0, loss: 0 });

export interface ScViews {
  summary: ScSummary;
  skus: ScSkuRow[];
  warehouses: ScWarehouseRow[];
  shipments: ApiShipmentRow[];
  skuWarehouse: ScSkuWarehouseRow[];
  trend: ScTrend;
}

export function buildScViews(input: ScInput): ScViews {
  const { ledger, fba, shipments, geo, durUnits, asinCategory, thresholds: T } = input;

  const dates = [...new Set(ledger.map((r) => r.date))].sort();
  const asOf = dates.at(-1) ?? null;
  const last7 = new Set(dates.slice(-7));
  const last30 = new Set(dates.slice(-30));
  const in30 = (d: string) => last30.has(d);
  const in7 = (d: string) => last7.has(d);

  // ── DUR-based demand (DRR numerator) ──
  // Per ASIN: total DUR units over the last-30-ledger-date window, and the set
  // of in-window dates that actually have a sales upload (any ASIN sold that
  // day). DRR = units ÷ (days with data), per the agreed rule. Falls back to
  // the ledger's own demand when an ASIN has no DUR rows.
  const durUnitsByAsin = new Map<string, number>();
  const durDatesWithData = new Set<string>();
  for (const u of durUnits) {
    if (!in30(u.date)) continue;
    durDatesWithData.add(u.date);
    durUnitsByAsin.set(u.asin, (durUnitsByAsin.get(u.asin) ?? 0) + u.units);
  }
  const durDays = durDatesWithData.size;
  const catOf = (asin: string): string | null => (asin ? (asinCategory.get(asin) ?? 'Unmapped') : null);
  /** DUR demand rate for an ASIN, or null when the ASIN has no DUR rows (→ caller falls back to ledger DRR). */
  const durDrrOf = (asin: string): number | null => {
    if (!asin || !durUnitsByAsin.has(asin) || durDays <= 0) return null;
    return durUnitsByAsin.get(asin)! / durDays;
  };

  // Identity per SKU.
  const ident = new Map<string, { msku: string; asin: string; fnsku: string; title: string | null }>();
  // (skuKey → location → date → Cell)
  const cells = new Map<string, Map<string, Map<string, Cell>>>();
  const inboundBySku = new Map<string, number>();
  for (const f of fba) {
    const inb = f.inboundWorking + f.inboundShipped + f.inboundReceived || f.inboundQuantity || 0;
    inboundBySku.set(f.sku, (inboundBySku.get(f.sku) ?? 0) + inb);
  }

  for (const r of ledger) {
    const k = skuKeyOf(r);
    if (!k) continue;
    if (!ident.has(k)) ident.set(k, { msku: r.msku, asin: r.asin, fnsku: r.fnsku, title: r.title });
    else {
      const id = ident.get(k)!;
      if (!id.asin && r.asin) id.asin = r.asin;
      if (!id.title && r.title) id.title = r.title;
    }
    const byLoc = cells.get(k) ?? new Map<string, Map<string, Cell>>();
    cells.set(k, byLoc);
    const byDate = byLoc.get(r.location) ?? new Map<string, Cell>();
    byLoc.set(r.location, byDate);
    const c = byDate.get(r.date) ?? emptyCell();
    byDate.set(r.date, c);
    if (r.disposition === SELLABLE) c.sellableEnding += r.endingBalance;
    else c.unsellableEnding += r.endingBalance;
    c.cust += r.customerShipments;
    c.returns += r.customerReturns;
    c.receipts += r.receipts;
    c.transfer += r.warehouseTransfer;
    c.loss += r.lost + r.damaged + r.disposed;
  }

  // Per-SKU×FC aggregates over the window.
  interface FcAgg {
    sellable: number;
    unsellable: number;
    sold7: number;
    sold30: number;
    returns30: number;
    receipts30: number;
    transfers30: number;
    loss30: number;
    inStockDays: number;
  }
  const fcAgg = new Map<string, Map<string, FcAgg>>(); // skuKey → loc → agg
  for (const [k, byLoc] of cells) {
    const m = new Map<string, FcAgg>();
    fcAgg.set(k, m);
    for (const [loc, byDate] of byLoc) {
      const a: FcAgg = { sellable: 0, unsellable: 0, sold7: 0, sold30: 0, returns30: 0, receipts30: 0, transfers30: 0, loss30: 0, inStockDays: 0 };
      if (asOf && byDate.has(asOf)) {
        a.sellable = byDate.get(asOf)!.sellableEnding;
        a.unsellable = byDate.get(asOf)!.unsellableEnding;
      }
      for (const [d, c] of byDate) {
        if (in7(d)) a.sold7 += -c.cust;
        if (in30(d)) {
          a.sold30 += -c.cust;
          a.returns30 += c.returns;
          a.receipts30 += c.receipts;
          a.transfers30 += c.transfer;
          a.loss30 += c.loss;
          if (c.sellableEnding > 0 || c.cust < 0) a.inStockDays += 1;
        }
      }
      m.set(loc, a);
    }
  }

  // National in-stock days per SKU (in stock at any FC that date).
  const nationalInStock = new Map<string, number>();
  for (const [k, byLoc] of cells) {
    const inStockDates = new Set<string>();
    for (const byDate of byLoc.values()) {
      for (const [d, c] of byDate) if (in30(d) && (c.sellableEnding > 0 || c.cust < 0)) inStockDates.add(d);
    }
    nationalInStock.set(k, inStockDates.size);
  }

  // ── SKU level ──
  const skus: ScSkuRow[] = [];
  const skuStockFlagByKey = new Map<string, string>();
  for (const [k, locs] of fcAgg) {
    const id = ident.get(k)!;
    let sellable = 0, unsellable = 0, sold7 = 0, sold30 = 0, returns30 = 0, receipts30 = 0, loss30 = 0;
    let fcsInStock = 0, fcsStockedOut = 0;
    for (const a of locs.values()) {
      sellable += a.sellable;
      unsellable += a.unsellable;
      sold7 += a.sold7;
      sold30 += a.sold30;
      returns30 += a.returns30;
      receipts30 += a.receipts30;
      loss30 += a.loss30;
      if (a.sellable > 0) fcsInStock += 1;
      else if (a.sold30 > 0) fcsStockedOut += 1;
    }
    const nis = nationalInStock.get(k) ?? 0;
    // DRR from the DUR (units ÷ days with data) when this SKU's ASIN has DUR
    // rows; otherwise fall back to the ledger's in-stock demand.
    const drrInStock = durDrrOf(id.asin) ?? drr(sold30, nis);
    const drr7 = drr(sold7, Math.min(7, last7.size));
    const drr30 = drr(sold30, Math.min(30, last30.size));
    const daysOnHand = doh(sellable, drrInStock);
    const inbound = inboundBySku.get(k) ?? 0;
    const stockFlag = skuStockFlag({ sellable, unitsSold30: sold30, daysOnHand, inbound }, T);
    skuStockFlagByKey.set(k, stockFlag);
    const returnRatePct = pct(returns30, sold30);
    const demandTrendPct = changePct(drr30 ?? 0, drr7 ?? 0);
    const health = skuHealth({ stockFlag: stockFlag as never, fcStockouts: fcsStockedOut, returnRatePct: returnRatePct ?? 0, agedSharePct: 0, drr7, drr30 }, T);
    skus.push({
      msku: id.msku, asin: id.asin, fnsku: id.fnsku, product: shortName(id.title, id.msku || id.fnsku),
      category: catOf(id.asin),
      sellable, unsellable, fcsInStock, fcsStockedOut, sold7, sold30, returns30, returnRatePct,
      drr7, drr30, drrInStock, daysOnHand, inbound, daysOfCoverInclInbound: doh(sellable + inbound, drrInStock),
      receipts30, lossDamaged30: loss30, demandTrendPct, stockFlag, health,
    });
  }
  skus.sort((a, b) => b.sold30 - a.sold30);

  // ── SKU × Warehouse ──
  const skuWarehouse: ScSkuWarehouseRow[] = [];
  // Per-FC DUR demand (sum of each SKU's DUR DRR share landing at that FC) so the
  // warehouse-level DRR is DUR-driven too; fcHasDur marks FCs with any DUR input.
  const fcDurDrr = new Map<string, number>();
  const fcHasDur = new Set<string>();
  for (const [k, locs] of fcAgg) {
    const id = ident.get(k)!;
    const skuSold30 = [...locs.values()].reduce((s, a) => s + a.sold30, 0);
    const skuDurDrr = durDrrOf(id.asin); // national DUR demand rate for this SKU's ASIN (null → ledger fallback)
    for (const [loc, a] of locs) {
      // Split the ASIN's DUR demand to this FC by its share of the SKU's ledger
      // sales; fall back to the ledger FC demand when the ASIN has no DUR rows.
      const fcShare = skuSold30 > 0 ? a.sold30 / skuSold30 : 0;
      const drrInStock = skuDurDrr != null ? skuDurDrr * fcShare : drr(a.sold30, a.inStockDays);
      if (skuDurDrr != null) {
        fcDurDrr.set(loc, (fcDurDrr.get(loc) ?? 0) + skuDurDrr * fcShare);
        fcHasDur.add(loc);
      }
      const daysOnHand = doh(a.sellable, drrInStock);
      const flag = skuFcFlag({ sellable: a.sellable, unitsSold30: a.sold30, daysOnHand }, T);
      skuWarehouse.push({
        msku: id.msku, asin: id.asin, product: shortName(id.title, id.msku || id.fnsku), category: catOf(id.asin), fc: loc,
        sellable: a.sellable, unsellable: a.unsellable, sold7: a.sold7, sold30: a.sold30, inStockDays: a.inStockDays,
        drrInStock, daysOnHand, shareOfSkuNationalPct: pct(a.sold30, skuSold30), receipts30: a.receipts30,
        transfers: a.transfers30, lossDamaged: a.loss30, flag, health: skuFcHealth({ fcFlag: flag }, T),
      });
    }
  }
  skuWarehouse.sort((a, b) => b.sellable - a.sellable);

  // ── Shipments ──
  const reportDate =
    [asOf, ...shipments.flatMap((s) => [s.lastUpdated, s.created])].filter((d): d is string => !!d).sort().at(-1) ?? asOf;
  const shipRows: ApiShipmentRow[] = shipments.map((s) => {
    const shortfall = shipmentShortfall(s.status, s.unitsExpected, s.unitsLocated);
    const fillRate = fillRatePct(s.unitsLocated, s.unitsExpected);
    const daysSinceCreated = reportDate && s.created ? daysBetween(s.created, reportDate) : null;
    const flag = shipmentFlag({ status: s.status, shortfall, daysSinceCreated }, T);
    return {
      shipmentId: s.shipmentId, name: s.shipmentName, status: s.status, created: s.created, lastUpdated: s.lastUpdated,
      destFc: s.destination, city: geo.get(s.destination)?.city ?? null, skus: s.skus, unitsExpected: s.unitsExpected,
      unitsLocated: s.unitsLocated, shortfall, fillRatePct: fillRate, daysSinceCreated, shipmentFlag: flag,
      health: shipmentHealth({ flag, status: s.status, shortfall, fillRate }, T),
    };
  });
  shipRows.sort((a, b) => (b.created ?? '').localeCompare(a.created ?? ''));

  // Inbound + short per FC from shipments.
  const fcInbound = new Map<string, number>();
  const fcShipExpected = new Map<string, number>();
  const fcShipLocated = new Map<string, number>();
  const fcShipShort = new Map<string, number>();
  const fcClosedExpected = new Map<string, number>();
  const fcClosedLocated = new Map<string, number>();
  const fcStuck = new Map<string, number>();
  const add = (m: Map<string, number>, k: string, v: number) => m.set(k, (m.get(k) ?? 0) + v);
  for (const s of shipRows) {
    const fc = s.destFc;
    add(fcShipExpected, fc, s.unitsExpected);
    add(fcShipLocated, fc, s.unitsLocated);
    if (active.has(s.status.toLowerCase())) add(fcInbound, fc, Math.max(s.unitsExpected - s.unitsLocated, 0));
    if (s.status.toLowerCase() === 'closed') {
      add(fcClosedExpected, fc, s.unitsExpected);
      add(fcClosedLocated, fc, s.unitsLocated);
      add(fcShipShort, fc, s.shortfall);
    }
    if (s.shipmentFlag === 'Receiving - stuck' || s.shipmentFlag === 'In transit - delayed') add(fcStuck, fc, 1);
  }

  // ── Warehouse level ──
  const totalSold30 = skus.reduce((s, r) => s + r.sold30, 0);
  const fcKeys = new Set<string>();
  for (const byLoc of cells.values()) for (const loc of byLoc.keys()) fcKeys.add(loc);
  for (const fc of fcInbound.keys()) fcKeys.add(fc);
  const warehouses: ScWarehouseRow[] = [];
  for (const fc of fcKeys) {
    let sellable = 0, unsellable = 0, sold7 = 0, sold30 = 0, receipts30 = 0, transfers = 0, loss30 = 0;
    let skusInStock = 0, skusStockedOut = 0, lowCover = 0, excess = 0;
    const fcInStockDates = new Set<string>();
    for (const [k, locs] of fcAgg) {
      const a = locs.get(fc);
      if (!a) continue;
      sellable += a.sellable;
      unsellable += a.unsellable;
      sold7 += a.sold7;
      sold30 += a.sold30;
      receipts30 += a.receipts30;
      transfers += a.transfers30;
      loss30 += a.loss30;
      if (a.sellable > 0) skusInStock += 1;
      else if (a.sold30 > 0) skusStockedOut += 1;
      const kAsin = ident.get(k)!.asin;
      const kDur = durDrrOf(kAsin);
      const kSold30 = [...(fcAgg.get(k)?.values() ?? [])].reduce((s2, x) => s2 + x.sold30, 0);
      const kFcDrr = kDur != null ? kDur * (kSold30 > 0 ? a.sold30 / kSold30 : 0) : drr(a.sold30, a.inStockDays);
      const flag = skuFcFlag({ sellable: a.sellable, unitsSold30: a.sold30, daysOnHand: doh(a.sellable, kFcDrr) }, T);
      if (flag === 'Low cover') lowCover += 1;
      if (flag === 'Excess') excess += 1;
      void k;
    }
    for (const byDate of [...cells.values()].map((b) => b.get(fc)).filter((b): b is Map<string, Cell> => !!b)) {
      for (const [d, c] of byDate) if (in30(d) && (c.sellableEnding > 0 || c.cust < 0)) fcInStockDates.add(d);
    }
    const fcDrr = fcHasDur.has(fc) ? (fcDurDrr.get(fc) ?? 0) : drr(sold30, fcInStockDates.size);
    const closedExp = fcClosedExpected.get(fc) ?? 0;
    warehouses.push({
      fc, city: geo.get(fc)?.city ?? null, state: geo.get(fc)?.state ?? null, sellable, unsellable,
      skusInStock, skusStockedOut, sold7, sold30, shareOfNationalPct: pct(sold30, totalSold30), drr: fcDrr,
      daysOnHand: doh(sellable, fcDrr), receipts30, transfersInOut: transfers, lossDamaged30: loss30,
      unitsExpected: fcShipExpected.get(fc) ?? 0, unitsLocated: fcShipLocated.get(fc) ?? 0, inbound: fcInbound.get(fc) ?? 0,
      unitsShort: fcShipShort.get(fc) ?? 0, fillRateClosedPct: fillRatePct(fcClosedLocated.get(fc) ?? 0, closedExp),
      health: warehouseHealth({ skusStockedOut, shipmentsShort: (fcShipShort.get(fc) ?? 0) > 0 ? 1 : 0, shipmentsStuckOrDelayed: fcStuck.get(fc) ?? 0, lowCoverSkus: lowCover, excessSkus: excess }, T),
    });
  }
  warehouses.sort((a, b) => b.sellable - a.sellable);

  // ── Summary ──
  const unsellableByTypeMap = new Map<string, number>();
  let sellableTotal = 0, unsellableTotal = 0, sold7Total = 0, sold30Total = 0, returnsTotal = 0, receiptsTotal = 0, lossTotal = 0;
  if (asOf) {
    for (const r of ledger) {
      if (r.date !== asOf) continue;
      if (r.disposition === SELLABLE) sellableTotal += r.endingBalance;
      else {
        unsellableTotal += r.endingBalance;
        unsellableByTypeMap.set(r.disposition, (unsellableByTypeMap.get(r.disposition) ?? 0) + r.endingBalance);
      }
    }
  }
  for (const r of skus) {
    sold7Total += r.sold7;
    sold30Total += r.sold30;
    returnsTotal += r.returns30;
    receiptsTotal += r.receipts30;
    lossTotal += r.lossDamaged30;
  }
  const skusByFlag: Record<string, number> = {};
  for (const r of skus) skusByFlag[r.stockFlag] = (skusByFlag[r.stockFlag] ?? 0) + 1;
  const fcsHolding = new Set(skuWarehouse.filter((r) => r.sellable > 0).map((r) => r.fc)).size;
  const skusInStockCount = skus.filter((r) => r.sellable > 0).length;
  const nationalStockDates = new Set<string>();
  for (const byLoc of cells.values()) for (const byDate of byLoc.values()) for (const [d, c] of byDate) if (in30(d) && (c.sellableEnding > 0 || c.cust < 0)) nationalStockDates.add(d);
  // National DRR: sum each SKU's DUR demand rate where its ASIN has DUR rows,
  // and the ledger demand rate for SKUs without DUR — so the total still
  // reflects every SKU. Falls back entirely to the ledger when no DUR exists.
  const ledgerNationalDrr = drr(sold30Total, nationalStockDates.size);
  let nationalDrr: number | null;
  if (durDays > 0 && durUnitsByAsin.size > 0) {
    let sum = 0;
    for (const [k, locs] of fcAgg) {
      const asin = ident.get(k)!.asin;
      const d = durDrrOf(asin);
      if (d != null) {
        sum += d;
      } else {
        const nis = nationalInStock.get(k) ?? 0;
        const sold30Sku = [...locs.values()].reduce((x, a) => x + a.sold30, 0);
        sum += drr(sold30Sku, nis) ?? 0;
      }
    }
    nationalDrr = sum;
  } else {
    nationalDrr = ledgerNationalDrr;
  }

  const statusAgg = new Map<string, { count: number; unitsExpected: number; unitsLocated: number }>();
  for (const s of shipRows) {
    const a = statusAgg.get(s.status) ?? { count: 0, unitsExpected: 0, unitsLocated: 0 };
    a.count += 1;
    a.unitsExpected += s.unitsExpected;
    a.unitsLocated += s.unitsLocated;
    statusAgg.set(s.status, a);
  }
  const healthCounts: ScHealthCounts = { not_working: 0, needs_attention: 0, working: 0 };
  for (const r of skus) healthCounts[r.health.status] += 1;

  const summary: ScSummary = {
    asOf, numLedgerDates: dates.length, sellable: sellableTotal, unsellable: unsellableTotal,
    unsellableByType: [...unsellableByTypeMap.entries()].map(([disposition, units]) => ({ disposition, units })).sort((a, b) => b.units - a.units),
    skusInStock: skusInStockCount, fcsHoldingStock: fcsHolding, sold7: sold7Total, sold30: sold30Total,
    returns30: returnsTotal, receipts30: receiptsTotal, lossDamaged30: lossTotal, nationalDrr,
    daysOnHand: doh(sellableTotal, nationalDrr), skusByFlag,
    shipmentsByStatus: [...statusAgg.entries()].map(([status, a]) => ({ status, ...a })),
    inboundUnits: [...fcInbound.values()].reduce((s, v) => s + v, 0),
    unitsShortClosed: shipRows.reduce((s, r) => s + r.shortfall, 0),
    flaggedShipments: shipRows.filter((r) => r.health.status !== 'working').length,
    health: healthCounts,
  };

  // ── Trend ──
  const dailyMap = new Map<string, { sellable: number; sold: number; receipts: number; returns: number; loss: number }>();
  for (const d of dates.slice(-30)) dailyMap.set(d, { sellable: 0, sold: 0, receipts: 0, returns: 0, loss: 0 });
  for (const r of ledger) {
    const p = dailyMap.get(r.date);
    if (!p) continue;
    if (r.disposition === SELLABLE) p.sellable += r.endingBalance;
    p.sold += -r.customerShipments;
    p.receipts += r.receipts;
    p.returns += r.customerReturns;
    p.loss += r.lost + r.damaged + r.disposed;
  }
  const weekStart = (iso: string) => {
    const dt = new Date(iso + 'T00:00:00Z');
    const dow = (dt.getUTCDay() + 6) % 7; // Monday = 0
    dt.setUTCDate(dt.getUTCDate() - dow);
    return dt.toISOString().slice(0, 10);
  };
  const weekMap = new Map<string, { count: number; unitsExpected: number; unitsLocated: number }>();
  for (const s of shipments) {
    if (!s.created) continue;
    const w = weekStart(s.created);
    const a = weekMap.get(w) ?? { count: 0, unitsExpected: 0, unitsLocated: 0 };
    a.count += 1;
    a.unitsExpected += s.unitsExpected;
    a.unitsLocated += s.unitsLocated;
    weekMap.set(w, a);
  }
  const trend: ScTrend = {
    daily: [...dailyMap.entries()].map(([date, p]) => ({ date, sellable: p.sellable, sold: p.sold, receipts: p.receipts, returns: p.returns, lossDamaged: p.loss })),
    weeklyShipments: [...weekMap.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([weekStart, a]) => ({ weekStart, ...a })),
  };

  return { summary, skus, warehouses, shipments: shipRows, skuWarehouse, trend };
}
