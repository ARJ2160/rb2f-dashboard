import { FC_REPORT_LABEL, type FcReportType } from '@dash/shared/firstcry';
import { and, eq, inArray } from 'drizzle-orm';
import { fileDateRange, inferDateOrder, num, str, toISODate } from '../blinkit/ingestion/clean';
import { db, type Tx } from '../db/client';
import { toUtf8Csv } from '../gcs/warehouse';
import { invalidateFcDims } from './reports/dims';
import { readFirstcryWorkbook, type Sheet } from './sheet-reader';
import { fcAdCategory, fcAdKeyword, fcAdProduct, fcCampaignMap, fcDailySkuSales, fcSkuMap } from './schema';

/* Firstcry ingestion. Sales dated (replace-by-date); performance reports
   period-level (replace-by-period). Performance Category is pre-rolled.
   TODO: confirm column signatures. */
export interface FcIngestOpts { from?: string; to?: string }
export interface FcFileResult { filename: string; sheet?: string; status: 'stored' | 'skipped' | 'error'; reportType?: FcReportType; from?: string; to?: string; rowsRead?: number; rowsStored?: number; message?: string; warnings?: string[] }

const colOf = (s: Sheet, ...names: string[]) => { for (const n of names) { const i = s.headers.indexOf(n); if (i >= 0) return i; } return -1; };
const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);
const has = (s: Sheet, ...names: string[]) => names.some((n) => s.headers.includes(n));

export function detectFirstcry(s: Sheet): FcReportType {
  if (!s.headers.length) return 'unknown';
  const metric = has(s, 'spend', 'ad spend', 'impressions', 'clicks', 'ad sales');
  const sku = has(s, 'sku', 'product');
  if (has(s, 'keyword') && metric) return 'fc_perf_keyword';
  if (sku && metric) return 'fc_perf_product';
  if (has(s, 'category') && metric && !sku) return 'fc_perf_category';
  if (sku && has(s, 'revenue', 'gmv') && has(s, 'units', 'quantity') && !metric) return 'fc_sales';
  if (sku && has(s, 'category')) return 'fc_sku_mapper';
  if (has(s, 'campaign', 'campaign name') && has(s, 'category')) return 'fc_campaign_mapper';
  return 'unknown';
}

type SalesRow = typeof fcDailySkuSales.$inferInsert;
export function parseSales(s: Sheet, profileId: string) {
  const c = { date: colOf(s, 'date'), sku: colOf(s, 'sku', 'product'), title: colOf(s, 'title', 'product'), rev: colOf(s, 'revenue', 'gmv'), units: colOf(s, 'units', 'quantity') };
  const order = inferDateOrder(s.rows.map((r) => cell(r, c.date)), s.fileName);
  const by = new Map<string, SalesRow>(); let bad = 0;
  for (const r of s.rows) { const date = toISODate(cell(r, c.date), order); const sku = str(cell(r, c.sku)); if (!date || !sku) { bad++; continue; } const key = `${date}${sku}`; let row = by.get(key); if (!row) { row = { profileId, date, sku, title: str(cell(r, c.title)), revenue: 0, units: 0 }; by.set(key, row); } row.revenue = (row.revenue ?? 0) + num(cell(r, c.rev)); row.units = (row.units ?? 0) + num(cell(r, c.units)); }
  const records = [...by.values()]; const dates = [...new Set(records.map((r) => r.date))].sort();
  return { records, dates, warnings: bad ? [`${bad} sales row(s) without a valid Date / SKU skipped.`] : [] };
}
const adCols = (s: Sheet) => ({ impr: colOf(s, 'impressions'), clicks: colOf(s, 'clicks'), spend: colOf(s, 'spend', 'ad spend'), asales: colOf(s, 'ad sales', 'revenue', 'gmv'), aunits: colOf(s, 'ad units', 'units', 'quantity') });
const adMetrics = (r: unknown[], c: ReturnType<typeof adCols>) => ({ impressions: num(cell(r, c.impr)), clicks: num(cell(r, c.clicks)), spend: num(cell(r, c.spend)), adSales: num(cell(r, c.asales)), adUnits: num(cell(r, c.aunits)) });
const campCols = (s: Sheet) => ({ cid: colOf(s, 'campaign id'), name: colOf(s, 'campaign', 'campaign name') });

export function parseProduct(s: Sheet, profileId: string, from: string, to: string) { const a = adCols(s); const c = { ...campCols(s), sku: colOf(s, 'sku', 'product'), title: colOf(s, 'title', 'product') }; const by = new Map<string, typeof fcAdProduct.$inferInsert>(); let bad = 0; for (const r of s.rows) { const sku = str(cell(r, c.sku)); const campaignId = str(cell(r, c.cid)); if (!sku) { bad++; continue; } by.set(`${campaignId}${sku}`, { profileId, periodFrom: from, periodTo: to, campaignId, campaignName: str(cell(r, c.name)), sku, title: str(cell(r, c.title)), ...adMetrics(r, a) }); } return { records: [...by.values()], warnings: bad ? [`${bad} product row(s) skipped.`] : [] }; }
export function parseCategory(s: Sheet, profileId: string, from: string, to: string) { const a = adCols(s); const c = { cat: colOf(s, 'category') }; const by = new Map<string, typeof fcAdCategory.$inferInsert>(); let bad = 0; for (const r of s.rows) { const category = str(cell(r, c.cat)).toUpperCase(); if (!category) { bad++; continue; } const ex = by.get(category); const m = adMetrics(r, a); if (ex) { ex.impressions! += m.impressions; ex.clicks! += m.clicks; ex.spend! += m.spend; ex.adSales! += m.adSales; ex.adUnits! += m.adUnits; } else by.set(category, { profileId, periodFrom: from, periodTo: to, category, ...m }); } return { records: [...by.values()], warnings: bad ? [`${bad} category row(s) skipped.`] : [] }; }
export function parseKeyword(s: Sheet, profileId: string, from: string, to: string) { const a = adCols(s); const c = { ...campCols(s), kw: colOf(s, 'keyword'), match: colOf(s, 'match type') }; const by = new Map<string, typeof fcAdKeyword.$inferInsert>(); let bad = 0; for (const r of s.rows) { const keyword = str(cell(r, c.kw)); const campaignId = str(cell(r, c.cid)); const matchType = str(cell(r, c.match)).toLowerCase(); if (!keyword) { bad++; continue; } by.set(`${campaignId}${keyword}${matchType}`, { profileId, periodFrom: from, periodTo: to, campaignId, campaignName: str(cell(r, c.name)), keyword, matchType, ...adMetrics(r, a) }); } return { records: [...by.values()], warnings: bad ? [`${bad} keyword row(s) skipped.`] : [] }; }
export function parseSkuMapper(s: Sheet, profileId: string) { const c = { sku: colOf(s, 'sku', 'product'), title: colOf(s, 'title', 'product'), cat: colOf(s, 'category'), price: colOf(s, 'selling price') }; const by = new Map<string, typeof fcSkuMap.$inferInsert>(); for (const r of s.rows) { const sku = str(cell(r, c.sku)); if (!sku || by.has(sku)) continue; by.set(sku, { profileId, sku, title: str(cell(r, c.title)), category: str(cell(r, c.cat)), sellingPrice: num(cell(r, c.price)) }); } return { records: [...by.values()], warnings: by.size ? [] : ['No SKU rows found in the SKU mapper.'] }; }
export function parseCampaignMapper(s: Sheet, profileId: string) { const c = { name: colOf(s, 'campaign', 'campaign name'), cat: colOf(s, 'category') }; const by = new Map<string, typeof fcCampaignMap.$inferInsert>(); for (const r of s.rows) { const campaignName = str(cell(r, c.name)); if (!campaignName || by.has(campaignName)) continue; by.set(campaignName, { profileId, campaignName, category: str(cell(r, c.cat)) }); } return { records: [...by.values()], warnings: by.size ? [] : ['No Campaign rows found.'] }; }

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); }
async function storeSales(profileId: string, dates: string[], rows: SalesRow[]) { await db.transaction(async (tx: Tx) => { await tx.delete(fcDailySkuSales).where(and(eq(fcDailySkuSales.profileId, profileId), inArray(fcDailySkuSales.date, dates))); await chunked(rows, 1000, (p) => tx.insert(fcDailySkuSales).values(p)); }); return rows.length; }
type PeriodTable = typeof fcAdProduct | typeof fcAdCategory | typeof fcAdKeyword;
async function storePeriod<T>(table: PeriodTable, profileId: string, from: string, to: string, rows: T[]) { await db.transaction(async (tx: Tx) => { await tx.delete(table).where(and(eq(table.profileId, profileId), eq(table.periodFrom, from), eq(table.periodTo, to))); /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ await chunked(rows, 1000, (p) => tx.insert(table).values(p as any)); }); return rows.length; }
async function replaceAll<T>(table: typeof fcSkuMap | typeof fcCampaignMap, profileId: string, rows: T[]) { await db.transaction(async (tx: Tx) => { await tx.delete(table).where(eq(table.profileId, profileId)); /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ await chunked(rows, 1000, (p) => tx.insert(table).values(p as any)); }); return rows.length; }

const todayISO = () => new Date().toISOString().slice(0, 10);
function windowFor(fileName: string, opts: FcIngestOpts): [string, string] { const f = fileDateRange(fileName); if (f) return f; if (opts.from && opts.to) return [opts.from, opts.to]; const d = opts.from ?? opts.to ?? todayISO(); return [d, d]; }

export async function ingestFirstcryFile(profileId: string, filename: string, raw: Buffer, opts: FcIngestOpts = {}): Promise<FcFileResult[]> {
  let sheets: Sheet[];
  try { sheets = readFirstcryWorkbook(toUtf8Csv(raw), filename); } catch (err) { return [{ filename, status: 'error', message: `Could not read file: ${(err as Error).message}` }]; }
  const results: FcFileResult[] = [];
  for (const s of sheets) {
    const type = detectFirstcry(s);
    const base: Omit<FcFileResult, 'status'> = { filename, sheet: s.sheetName, reportType: type, rowsRead: s.rows.length };
    if (type === 'unknown') { results.push({ ...base, status: 'skipped', message: `Sheet "${s.sheetName}" is not a recognised Firstcry report.` }); continue; }
    try {
      if (type === 'fc_sales') { const p = parseSales(s, profileId); const stored = p.records.length ? await storeSales(profileId, p.dates, p.records) : 0; results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.dates.length ? { from: p.dates[0]!, to: p.dates[p.dates.length - 1]! } : {}), ...(p.warnings.length ? { warnings: p.warnings } : {}) }); }
      else if (type === 'fc_sku_mapper') { const p = parseSkuMapper(s, profileId); const stored = p.records.length ? await replaceAll(fcSkuMap, profileId, p.records) : 0; results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.warnings.length ? { warnings: p.warnings } : {}) }); }
      else if (type === 'fc_campaign_mapper') { const p = parseCampaignMapper(s, profileId); const stored = p.records.length ? await replaceAll(fcCampaignMap, profileId, p.records) : 0; results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.warnings.length ? { warnings: p.warnings } : {}) }); }
      else { const [from, to] = windowFor(filename, opts); let stored = 0; let warnings: string[] = [];
        if (type === 'fc_perf_product') { const p = parseProduct(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(fcAdProduct, profileId, from, to, p.records) : 0; }
        else if (type === 'fc_perf_category') { const p = parseCategory(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(fcAdCategory, profileId, from, to, p.records) : 0; }
        else { const p = parseKeyword(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(fcAdKeyword, profileId, from, to, p.records) : 0; }
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, from, to, ...(warnings.length ? { warnings } : {}) });
      }
    } catch (err) { results.push({ ...base, status: 'error', message: (err as Error).message }); }
  }
  if (results.some((r) => r.status === 'stored')) invalidateFcDims(profileId);
  return results;
}
export { FC_REPORT_LABEL };
