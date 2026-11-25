import { ME_REPORT_LABEL, type MeReportType } from '@dash/shared/meesho';
import { and, eq, inArray } from 'drizzle-orm';
import { inferDateOrder, num, str, toISODate } from '../blinkit/ingestion/clean';
import { db, type Tx } from '../db/client';
import { toUtf8Csv } from '../gcs/warehouse';
import { invalidateMeDims } from './reports/dims';
import { readMeeshoWorkbook, type Sheet } from './sheet-reader';
import { meDailySkuSales, meOrderAgg, meSkuMap } from './schema';

/* Meesho ingestion. BR = gross (sku × day × state); Orders → net buckets by
   status. No ad feed (ads are entered manually via the API). TODO: confirm columns. */
export interface MeFileResult { filename: string; sheet?: string; status: 'stored' | 'skipped' | 'error'; reportType?: MeReportType; from?: string; to?: string; rowsRead?: number; rowsStored?: number; message?: string; warnings?: string[] }

const colOf = (s: Sheet, ...names: string[]) => { for (const n of names) { const i = s.headers.indexOf(n); if (i >= 0) return i; } return -1; };
const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);
const has = (s: Sheet, ...names: string[]) => names.some((n) => s.headers.includes(n));

export function detectMeesho(s: Sheet): MeReportType {
  if (!s.headers.length) return 'unknown';
  if (has(s, 'status', 'order status') && has(s, 'order id')) return 'me_orders';
  if (has(s, 'sku') && has(s, 'revenue', 'gmv') && has(s, 'units', 'quantity')) return 'me_br';
  if (has(s, 'sku') && has(s, 'category')) return 'me_sku_mapper';
  return 'unknown';
}

type SalesRow = typeof meDailySkuSales.$inferInsert;
export function parseBr(s: Sheet, profileId: string) {
  const c = { date: colOf(s, 'date', 'order date'), sku: colOf(s, 'sku'), state: colOf(s, 'state'), title: colOf(s, 'title', 'product'), rev: colOf(s, 'revenue', 'gmv'), units: colOf(s, 'units', 'quantity') };
  const order = inferDateOrder(s.rows.map((r) => cell(r, c.date)), s.fileName);
  const by = new Map<string, SalesRow>(); let bad = 0;
  for (const r of s.rows) { const date = toISODate(cell(r, c.date), order); const sku = str(cell(r, c.sku)); if (!date || !sku) { bad++; continue; } const state = str(cell(r, c.state)); const key = `${date}${sku}${state}`; let row = by.get(key); if (!row) { row = { profileId, date, sku, state, title: str(cell(r, c.title)), revenue: 0, units: 0 }; by.set(key, row); } row.revenue = (row.revenue ?? 0) + num(cell(r, c.rev)); row.units = (row.units ?? 0) + num(cell(r, c.units)); }
  const records = [...by.values()]; const dates = [...new Set(records.map((r) => r.date))].sort();
  return { records, dates, warnings: bad ? [`${bad} BR row(s) without a valid Date / SKU skipped.`] : [] };
}

type OrderRow = typeof meOrderAgg.$inferInsert;
const bucketOf = (status: string): 'delivered' | 'returned' | 'rto' | 'cancelled' | 'other' => {
  const k = status.toLowerCase();
  if (k.includes('rto')) return 'rto';
  if (k.includes('return')) return 'returned';
  if (k.includes('cancel')) return 'cancelled';
  if (k.includes('deliver') || k.includes('complete') || k.includes('shipped')) return 'delivered';
  return 'other';
};
export function parseOrders(s: Sheet, profileId: string) {
  const c = { date: colOf(s, 'order date', 'date'), sku: colOf(s, 'sku'), status: colOf(s, 'order status', 'status'), units: colOf(s, 'units', 'quantity'), rev: colOf(s, 'revenue', 'gmv') };
  const order = inferDateOrder(s.rows.map((r) => cell(r, c.date)), s.fileName);
  const by = new Map<string, OrderRow>(); let bad = 0;
  for (const r of s.rows) {
    const date = toISODate(cell(r, c.date), order); const sku = str(cell(r, c.sku));
    if (!date || !sku) { bad++; continue; }
    const key = `${date}${sku}`;
    let row = by.get(key);
    if (!row) { row = { profileId, date, sku, deliveredUnits: 0, returnedUnits: 0, rtoUnits: 0, cancelledUnits: 0, netRevenue: 0, netUnits: 0 }; by.set(key, row); }
    const u = num(cell(r, c.units)) || 1; const rev = num(cell(r, c.rev)); const b = bucketOf(str(cell(r, c.status)));
    if (b === 'delivered') { row.deliveredUnits! += u; row.netUnits! += u; row.netRevenue! += rev; }
    else if (b === 'returned') row.returnedUnits! += u;
    else if (b === 'rto') row.rtoUnits! += u;
    else if (b === 'cancelled') row.cancelledUnits! += u;
  }
  const records = [...by.values()]; const dates = [...new Set(records.map((r) => r.date))].sort();
  return { records, dates, warnings: bad ? [`${bad} order row(s) without a valid Date / SKU skipped.`] : [] };
}

export function parseSkuMapper(s: Sheet, profileId: string) { const c = { sku: colOf(s, 'sku'), title: colOf(s, 'title', 'product'), cat: colOf(s, 'category'), price: colOf(s, 'selling price') }; const by = new Map<string, typeof meSkuMap.$inferInsert>(); for (const r of s.rows) { const sku = str(cell(r, c.sku)); if (!sku || by.has(sku)) continue; by.set(sku, { profileId, sku, title: str(cell(r, c.title)), category: str(cell(r, c.cat)), sellingPrice: num(cell(r, c.price)) }); } return { records: [...by.values()], warnings: by.size ? [] : ['No SKU rows found.'] }; }

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); }
async function storeSales(profileId: string, dates: string[], rows: SalesRow[]) { await db.transaction(async (tx: Tx) => { await tx.delete(meDailySkuSales).where(and(eq(meDailySkuSales.profileId, profileId), inArray(meDailySkuSales.date, dates))); await chunked(rows, 1000, (p) => tx.insert(meDailySkuSales).values(p)); }); return rows.length; }
async function storeOrders(profileId: string, dates: string[], rows: OrderRow[]) { await db.transaction(async (tx: Tx) => { await tx.delete(meOrderAgg).where(and(eq(meOrderAgg.profileId, profileId), inArray(meOrderAgg.date, dates))); await chunked(rows, 1000, (p) => tx.insert(meOrderAgg).values(p)); }); return rows.length; }
async function replaceMap(profileId: string, rows: (typeof meSkuMap.$inferInsert)[]) { await db.transaction(async (tx: Tx) => { await tx.delete(meSkuMap).where(eq(meSkuMap.profileId, profileId)); await chunked(rows, 1000, (p) => tx.insert(meSkuMap).values(p)); }); return rows.length; }

export async function ingestMeeshoFile(profileId: string, filename: string, raw: Buffer): Promise<MeFileResult[]> {
  let sheets: Sheet[];
  try { sheets = readMeeshoWorkbook(toUtf8Csv(raw), filename); } catch (err) { return [{ filename, status: 'error', message: `Could not read file: ${(err as Error).message}` }]; }
  const results: MeFileResult[] = [];
  for (const s of sheets) {
    const type = detectMeesho(s);
    const base: Omit<MeFileResult, 'status'> = { filename, sheet: s.sheetName, reportType: type, rowsRead: s.rows.length };
    if (type === 'unknown') { results.push({ ...base, status: 'skipped', message: `Sheet "${s.sheetName}" is not a recognised Meesho report.` }); continue; }
    try {
      if (type === 'me_br') { const p = parseBr(s, profileId); const stored = p.records.length ? await storeSales(profileId, p.dates, p.records) : 0; results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.dates.length ? { from: p.dates[0]!, to: p.dates[p.dates.length - 1]! } : {}), ...(p.warnings.length ? { warnings: p.warnings } : {}) }); }
      else if (type === 'me_orders') { const p = parseOrders(s, profileId); const stored = p.records.length ? await storeOrders(profileId, p.dates, p.records) : 0; results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.dates.length ? { from: p.dates[0]!, to: p.dates[p.dates.length - 1]! } : {}), ...(p.warnings.length ? { warnings: p.warnings } : {}) }); }
      else { const p = parseSkuMapper(s, profileId); const stored = p.records.length ? await replaceMap(profileId, p.records) : 0; results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.warnings.length ? { warnings: p.warnings } : {}) }); }
    } catch (err) { results.push({ ...base, status: 'error', message: (err as Error).message }); }
  }
  if (results.some((r) => r.status === 'stored')) invalidateMeDims(profileId);
  return results;
}
export { ME_REPORT_LABEL };
