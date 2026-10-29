import { canonicalCity } from '@dash/shared/blinkit';
import type { SheetData } from '../sheet-grid';
import { col } from '../sheet-grid';
import { idStr, inferDateOrder, num, str, toISODate } from '../clean';
import type { ParseResult } from './types';

export interface SalesLine {
  date: string; orderId: string; itemId: string; productName: string;
  customerCity: string; customerState: string; supplyCity: string; supplyState: string;
  status: string; quantity: number; mrp: number; sellingPrice: number; revenue: number;
}

/** Statuses that are not a sale. Everything else (DELIVERED, …) counts. */
const EXCLUDED_STATUS = /cancel|return|rto|refund|fail/i;

export function parseSales(s: SheetData): ParseResult<SalesLine> {
  const H = s.headers;
  const c = {
    order: col(H, 'order id'), date: col(H, 'order date'), item: col(H, 'item id'), name: col(H, 'product name'),
    ccity: col(H, 'customer city'), cstate: col(H, 'customer state'), scity: col(H, 'supply city'), sstate: col(H, 'supply state'),
    status: col(H, 'order status'), qty: col(H, 'quantity'), mrp: col(H, 'mrp rs', 'mrp'),
    sp: col(H, 'selling price rs', 'selling price'), gross: col(H, 'total gross bill amount'),
    sno: col(H, 's no'),
  };
  const warnings: string[] = [];
  // Warehouse total_sales CSVs are month-first (2/1/2026 = 1 Feb), Blinkit's own exports day-first.
  const order = inferDateOrder(s.rows.map((r) => r[c.date]), s.fileName);
  const out = new Map<string, SalesLine>();
  const lineNos = new Map<string, Set<string>>();
  let bad = 0, excluded = 0, dupes = 0, merged = 0;
  for (const r of s.rows) {
    const date = toISODate(r[c.date], order);
    const orderId = idStr(r[c.order]), itemId = idStr(r[c.item]);
    if (!date || !orderId) { bad++; continue; }
    const status = c.status >= 0 ? str(r[c.status]) : '';
    if (EXCLUDED_STATUS.test(status)) { excluded++; continue; }
    const qty = num(r[c.qty]);
    const sp = c.sp >= 0 ? num(r[c.sp]) : 0;
    // Revenue = Total Gross Bill Amount; fall back to qty × selling price if absent.
    const revenue = c.gross >= 0 ? num(r[c.gross]) : qty * sp;
    const key = orderId + '|' + itemId;
    const sno = c.sno >= 0 ? str(r[c.sno]) : '';
    const prev = out.get(key);
    if (prev) {
      // Same order + item again. With a different S.No. it is a genuine second line
      // (warehouse total_sales has a few) → add it; otherwise it is a repeated row
      // from overlapping exports → drop it.
      const seen = lineNos.get(key);
      if (sno && seen && !seen.has(sno)) {
        seen.add(sno);
        prev.quantity += qty;
        prev.revenue += revenue;
        merged++;
      } else dupes++;
      continue;
    }
    if (sno) lineNos.set(key, new Set([sno]));
    out.set(key, {
      date, orderId, itemId, productName: str(r[c.name]),
      customerCity: canonicalCity(r[c.ccity]), customerState: str(r[c.cstate]),
      supplyCity: str(r[c.scity]), supplyState: str(r[c.sstate]),
      status, quantity: qty, mrp: c.mrp >= 0 ? num(r[c.mrp]) : 0, sellingPrice: sp, revenue,
    });
  }
  if (bad) warnings.push(`${bad} rows without a valid Order Date / Order Id were skipped`);
  if (excluded) warnings.push(`${excluded} cancelled / returned lines excluded`);
  if (dupes) warnings.push(`${dupes} repeated Order Id × Item Id rows removed`);
  if (merged) warnings.push(`${merged} extra line(s) for the same Order Id × Item Id (different S.No.) added to that line`);
  if (c.gross < 0) warnings.push('No "Total Gross Bill Amount" column — revenue = Quantity × Selling Price');
  const records = [...out.values()];
  return { records, dates: [...new Set(records.map((x) => x.date))].sort(), rowsRead: s.rows.length, warnings };
}
