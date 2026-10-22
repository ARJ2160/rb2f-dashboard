import { parseDateCell, plausible } from '../../lib/dates';
import { normalizeIndianState } from '../../lib/states';
import { normalizeAsin, num, pick, round2, str, type Row } from '../../lib/values';
import { singleNameDate, type ParseContext, type ParseResult } from './types';

export interface StateRecord {
  date: string;
  state: string;
  asin: string;
  units: number;
  sales: number;
  orders: number | null;
  unpricedUnits: number;
}

function orderDate(r: Row): string | null {
  const raw = pick(r, ['purchase-date', 'Purchase Date', 'purchase date', 'order-date', 'Order Date', 'Date']);
  if (raw == null || raw === '') return null;
  const iso = String(raw).match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1]! : plausible(parseDateCell(raw));
}

/**
 * Seller Central Order report → sales per ship-to state per ASIN per day
 * (rule book §2: the only source of state for Seller sales). Only shipped /
 * shipping lines count; cancelled and pending are excluded (eigen rule).
 */
export function parseOrderReport(rows: Row[], ctx: ParseContext): ParseResult<StateRecord> {
  const warnings: string[] = [];
  const fallbackDate = singleNameDate(ctx);
  const acc = new Map<string, StateRecord>();
  let excluded = 0;
  let undated = 0;
  for (const r of rows) {
    const status = str(pick(r, ['order-status', 'Order Status', 'item-status', 'status'])).toLowerCase();
    if (status && !status.includes('ship')) {
      excluded++;
      continue;
    }
    const date = orderDate(r) ?? fallbackDate;
    if (!date) {
      undated++;
      continue;
    }
    const asin = normalizeAsin(pick(r, ['asin', 'ASIN']));
    const state = normalizeIndianState(pick(r, ['ship-state', 'Ship State', 'ship state', 'shipping-state', 'State']));
    const key = `${date}|${state}|${asin}`;
    const cur = acc.get(key) ?? { date, state, asin, units: 0, sales: 0, orders: 0, unpricedUnits: 0 };
    cur.units += num(pick(r, ['quantity', 'Quantity', 'quantity-purchased', 'quantity-shipped'])) || 1;
    cur.sales += num(pick(r, ['item-price', 'Item Price', 'item price', 'item-total', 'Item Total']));
    cur.orders = (cur.orders ?? 0) + 1;
    acc.set(key, cur);
  }
  if (excluded) warnings.push(`${excluded} cancelled / pending line(s) excluded (only Shipped / Shipping count).`);
  if (undated) warnings.push(`${undated} line(s) skipped: no purchase date.`);
  const records = [...acc.values()].map((r) => ({ ...r, sales: round2(r.sales) }));
  if (!records.length && rows.length) return { records, rowsRead: rows.length, warnings, error: 'No shipped order lines.' };
  return { records, rowsRead: rows.length, warnings };
}
