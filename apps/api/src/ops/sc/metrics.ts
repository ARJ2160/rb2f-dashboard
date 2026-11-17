/**
 * Seller Central metric rules (§4.3) and health status (§5.3) — pure functions,
 * so every page derives identical numbers and the rules are unit-tested. SQL
 * supplies the additive sums and date counts; these turn them into DRR, days of
 * cover, flags and health.
 */

export interface ScThresholds {
  criticalDays: number;
  excessDays: number;
  returnRateBad: number; // percent
  agedShareBad: number; // percent
  demandChangeAlert: number; // percent
  stuckReceivingDays: number;
  workingTooLongDays: number;
  inTransitTooLongDays: number;
}

export const round1 = (n: number) => Math.round(n * 10) / 10;

/** Demand rate per day; null when there are no in-stock days to divide by. */
export const drr = (units: number, days: number): number | null => (days > 0 ? units / days : null);
/** Days of stock on hand; null when demand is unknown or zero. */
export const daysOnHand = (stock: number, rate: number | null): number | null =>
  rate != null && rate > 0 ? stock / rate : null;
/** Percent change from a→b; null when the base is 0 ("New"). */
export const changePct = (base: number, now: number): number | null => (base === 0 ? null : ((now - base) / base) * 100);

export type ScStockFlag =
  | 'No sales'
  | '-'
  | 'Out of stock'
  | 'Critical - inbound'
  | 'Critical - send stock'
  | 'Watch'
  | 'Excess'
  | 'OK';

export function skuStockFlag(
  p: { sellable: number; unitsSold30: number; daysOnHand: number | null; inbound: number },
  t: Pick<ScThresholds, 'criticalDays' | 'excessDays'>
): ScStockFlag {
  if (p.unitsSold30 <= 0) return p.sellable > 0 ? 'No sales' : '-';
  if (p.sellable <= 0) return 'Out of stock';
  const doh = p.daysOnHand;
  if (doh == null) return 'OK';
  if (doh < t.criticalDays) return p.inbound > 0 ? 'Critical - inbound' : 'Critical - send stock';
  if (doh < 2 * t.criticalDays) return 'Watch';
  if (doh > t.excessDays) return 'Excess';
  return 'OK';
}

export type ScFcFlag = 'Stockout at FC' | 'Low cover' | 'Excess' | 'OK';

export function skuFcFlag(
  p: { sellable: number; unitsSold30: number; daysOnHand: number | null },
  t: Pick<ScThresholds, 'criticalDays' | 'excessDays'>
): ScFcFlag {
  if (p.sellable <= 0 && p.unitsSold30 > 0) return 'Stockout at FC';
  const doh = p.daysOnHand;
  if (doh != null && doh < t.criticalDays) return 'Low cover';
  if (doh != null && doh > t.excessDays) return 'Excess';
  return 'OK';
}

/** Statuses that count as "closed" for shortfall, and the active (inbound) set. */
export const SHIPMENT_INBOUND_STATUSES = ['Working', 'Ready to ship', 'Shipped', 'In transit', 'Delivered', 'Checked-in', 'Receiving'];
const norm = (s: string) => s.trim().toLowerCase();
const isStatus = (status: string, name: string) => norm(status) === norm(name);

export type ScShipmentFlag =
  | 'Cancelled'
  | 'Closed - short received (raise case)'
  | 'Closed - OK'
  | 'Receiving - stuck'
  | 'In transit - delayed'
  | 'Not shipped yet'
  | string;

export function shipmentFlag(
  p: { status: string; shortfall: number; daysSinceCreated: number | null },
  t: Pick<ScThresholds, 'stuckReceivingDays' | 'inTransitTooLongDays' | 'workingTooLongDays'>
): ScShipmentFlag {
  const d = p.daysSinceCreated ?? 0;
  if (isStatus(p.status, 'Cancelled')) return 'Cancelled';
  if (isStatus(p.status, 'Closed')) return p.shortfall > 0 ? 'Closed - short received (raise case)' : 'Closed - OK';
  if (isStatus(p.status, 'Receiving') && d > t.stuckReceivingDays) return 'Receiving - stuck';
  if (isStatus(p.status, 'In transit') && d > t.inTransitTooLongDays) return 'In transit - delayed';
  if (isStatus(p.status, 'Working') && d > t.workingTooLongDays) return 'Not shipped yet';
  return p.status;
}

/** Shortfall on a closed shipment only (over-receipts count as 0). */
export const shipmentShortfall = (status: string, expected: number, located: number): number =>
  isStatus(status, 'Closed') ? Math.max(expected - located, 0) : 0;

export const fillRatePct = (located: number, expected: number): number | null =>
  expected > 0 ? (located / expected) * 100 : null;

export type Health = 'not_working' | 'needs_attention' | 'working';
export interface HealthResult {
  status: Health;
  reasons: string[];
}

const resolve = (not: string[], att: string[]): HealthResult =>
  not.length ? { status: 'not_working', reasons: not } : att.length ? { status: 'needs_attention', reasons: att } : { status: 'working', reasons: [] };

/** SKU-level health (§5.3 Seller Central). */
export function skuHealth(
  p: { stockFlag: ScStockFlag; fcStockouts: number; returnRatePct: number; agedSharePct: number; drr7: number | null; drr30: number | null },
  t: ScThresholds
): HealthResult {
  const not: string[] = [];
  const att: string[] = [];
  if (p.stockFlag === 'Out of stock') not.push('Out of stock');
  if (p.stockFlag === 'Critical - send stock') not.push('Critical cover, no inbound');
  if (p.fcStockouts > 0) not.push(`Stocked out at ${p.fcStockouts} FC${p.fcStockouts > 1 ? 's' : ''}`);
  if (p.stockFlag === 'Critical - inbound') att.push('Critical cover (inbound on the way)');
  if (p.stockFlag === 'Watch') att.push('Low cover');
  if (p.stockFlag === 'Excess') att.push('Excess stock');
  if (p.returnRatePct > t.returnRateBad) att.push(`Return rate ${round1(p.returnRatePct)}%`);
  if (p.agedSharePct > t.agedShareBad) att.push(`Aged stock ${round1(p.agedSharePct)}%`);
  const trend = changePct(p.drr30 ?? 0, p.drr7 ?? 0);
  if (trend != null && trend < -t.demandChangeAlert) att.push(`Demand falling ${round1(trend)}%`);
  return resolve(not, att);
}

/** SKU × FC health. */
export function skuFcHealth(p: { fcFlag: ScFcFlag }, _t: ScThresholds): HealthResult {
  if (p.fcFlag === 'Stockout at FC') return { status: 'not_working', reasons: ['Stockout at FC'] };
  if (p.fcFlag === 'Low cover') return { status: 'needs_attention', reasons: ['Low cover'] };
  if (p.fcFlag === 'Excess') return { status: 'needs_attention', reasons: ['Excess stock'] };
  return { status: 'working', reasons: [] };
}

/** Shipment-level health. */
export function shipmentHealth(
  p: { flag: ScShipmentFlag; status: string; shortfall: number; fillRate: number | null },
  _t: ScThresholds
): HealthResult {
  const not: string[] = [];
  const att: string[] = [];
  if (p.flag === 'Receiving - stuck') not.push('Receiving stuck');
  if (p.flag === 'In transit - delayed') not.push('In transit delayed');
  if (isStatus(p.status, 'Closed') && p.shortfall > 0) not.push(`Short received ${p.shortfall} units`);
  if (isStatus(p.status, 'Receiving') && p.fillRate != null && p.fillRate < 100) att.push(`Only ${round1(p.fillRate)}% located so far`);
  return resolve(not, att);
}

/** Warehouse-level health, aggregated from its SKU×FC and shipment signals. */
export function warehouseHealth(
  p: { skusStockedOut: number; shipmentsShort: number; shipmentsStuckOrDelayed: number; lowCoverSkus: number; excessSkus: number },
  _t: ScThresholds
): HealthResult {
  const not: string[] = [];
  const att: string[] = [];
  if (p.skusStockedOut > 0) not.push(`${p.skusStockedOut} SKU stockout${p.skusStockedOut > 1 ? 's' : ''}`);
  if (p.shipmentsShort > 0) not.push(`${p.shipmentsShort} short-received shipment${p.shipmentsShort > 1 ? 's' : ''}`);
  if (p.shipmentsStuckOrDelayed > 0) not.push(`${p.shipmentsStuckOrDelayed} stuck/delayed shipment${p.shipmentsStuckOrDelayed > 1 ? 's' : ''}`);
  if (p.lowCoverSkus > 0) att.push(`${p.lowCoverSkus} low-cover SKU${p.lowCoverSkus > 1 ? 's' : ''}`);
  if (p.excessSkus > 0) att.push(`${p.excessSkus} excess SKU${p.excessSkus > 1 ? 's' : ''}`);
  return resolve(not, att);
}
