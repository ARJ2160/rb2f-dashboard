import { normKey } from '@dash/shared/blinkit';
import { NK_REPORT_LABEL, type NkReportType, type NkSalesSource } from '@dash/shared/nykaa';
import { and, eq, inArray } from 'drizzle-orm';
import { fileDateRange, inferDateOrder, num, str, toISODate } from '../blinkit/ingestion/clean';
import { db, type Tx } from '../db/client';
import { toUtf8Csv } from '../gcs/warehouse';
import { invalidateNkDims } from './reports/dims';
import { readNykaaWorkbook, type Sheet } from './sheet-reader';
import { nkAdCampaign, nkAdPlacement, nkAdSearchTerm, nkAdSku, nkCampaignMap, nkDailySkuSales, nkSkuMap, nkSkuSov } from './schema';

/* Nykaa ingestion. MIS + Sales Report both land in nk_daily_sku_sales with a
   `source` (resolved from the file name); deduped by precedence at query time.
   Ad reports period-level. TODO: confirm column signatures + source precedence. */

export interface NkIngestOpts { from?: string; to?: string; source?: NkSalesSource }
export interface NkFileResult { filename: string; sheet?: string; status: 'stored' | 'skipped' | 'error'; reportType?: NkReportType; source?: NkSalesSource; from?: string; to?: string; rowsRead?: number; rowsStored?: number; message?: string; warnings?: string[] }

const colOf = (s: Sheet, ...names: string[]) => { for (const n of names) { const i = s.headers.indexOf(n); if (i >= 0) return i; } return -1; };
const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);
const has = (s: Sheet, ...names: string[]) => names.some((n) => s.headers.includes(n));

export function detectNykaa(s: Sheet): NkReportType {
  if (!s.headers.length) return 'unknown';
  const metric = has(s, 'spend', 'ad spend', 'impressions', 'clicks', 'ad sales');
  const campaign = has(s, 'campaign', 'campaign name');
  const sku = has(s, 'sku');
  if (sku && has(s, 'sov', 'share of voice', 'share') && !metric) return 'nk_sku_sov';
  if (sku && has(s, 'revenue', 'gmv') && has(s, 'units', 'quantity') && !campaign && !metric) return 'nk_sales_report';
  if (has(s, 'placement') && metric) return 'nk_ad_placement';
  if (has(s, 'search term') && metric) return 'nk_ad_search_term';
  if (sku && metric) return 'nk_ad_sku';
  if (campaign && metric) return 'nk_ad_campaign';
  if (sku && has(s, 'category')) return 'nk_sku_mapper';
  if (campaign && has(s, 'category')) return 'nk_campaign_mapper';
  return 'unknown';
}

function sourceFromName(fileName: string, sheetName: string, opt?: NkSalesSource): NkSalesSource {
  if (opt) return opt;
  const n = normKey(`${fileName} ${sheetName}`);
  if (/mis|fashion/.test(n)) return 'mis';
  return 'seller';
}

type SalesRow = typeof nkDailySkuSales.$inferInsert;
export function parseSales(s: Sheet, profileId: string, source: NkSalesSource) {
  const c = { date: colOf(s, 'date'), sku: colOf(s, 'sku'), title: colOf(s, 'title', 'product'), rev: colOf(s, 'revenue', 'gmv'), units: colOf(s, 'units', 'quantity') };
  const order = inferDateOrder(s.rows.map((r) => cell(r, c.date)), s.fileName);
  const by = new Map<string, SalesRow>(); let bad = 0;
  for (const r of s.rows) { const date = toISODate(cell(r, c.date), order); const sku = str(cell(r, c.sku)); if (!date || !sku) { bad++; continue; } const key = `${date}${sku}`; let row = by.get(key); if (!row) { row = { profileId, date, sku, source, title: str(cell(r, c.title)), revenue: 0, units: 0 }; by.set(key, row); } row.revenue = (row.revenue ?? 0) + num(cell(r, c.rev)); row.units = (row.units ?? 0) + num(cell(r, c.units)); }
  const records = [...by.values()]; const dates = [...new Set(records.map((r) => r.date))].sort();
  return { records, dates, warnings: bad ? [`${bad} sales row(s) without a valid Date / SKU skipped.`] : [] };
}

const adCols = (s: Sheet) => ({ impr: colOf(s, 'impressions'), clicks: colOf(s, 'clicks'), spend: colOf(s, 'spend', 'ad spend'), asales: colOf(s, 'ad sales', 'revenue', 'gmv'), aunits: colOf(s, 'ad units', 'units', 'quantity') });
const adMetrics = (r: unknown[], c: ReturnType<typeof adCols>) => ({ impressions: num(cell(r, c.impr)), clicks: num(cell(r, c.clicks)), spend: num(cell(r, c.spend)), adSales: num(cell(r, c.asales)), adUnits: num(cell(r, c.aunits)) });
const campCols = (s: Sheet) => ({ cid: colOf(s, 'campaign id'), name: colOf(s, 'campaign', 'campaign name') });

export function parseCampaign(s: Sheet, profileId: string, from: string, to: string) { const a = adCols(s); const c = { ...campCols(s), status: colOf(s, 'status') }; const by = new Map<string, typeof nkAdCampaign.$inferInsert>(); let bad = 0; for (const r of s.rows) { const campaignName = str(cell(r, c.name)); const campaignId = str(cell(r, c.cid)); if (!campaignName) { bad++; continue; } by.set(`${campaignId}${campaignName}`, { profileId, periodFrom: from, periodTo: to, campaignId, campaignName, status: str(cell(r, c.status)), ...adMetrics(r, a) }); } return { records: [...by.values()], warnings: bad ? [`${bad} campaign row(s) skipped.`] : [] }; }
export function parseAdSku(s: Sheet, profileId: string, from: string, to: string) { const a = adCols(s); const c = { ...campCols(s), sku: colOf(s, 'sku'), title: colOf(s, 'title', 'product') }; const by = new Map<string, typeof nkAdSku.$inferInsert>(); let bad = 0; for (const r of s.rows) { const sku = str(cell(r, c.sku)); const campaignId = str(cell(r, c.cid)); if (!sku) { bad++; continue; } by.set(`${campaignId}${sku}`, { profileId, periodFrom: from, periodTo: to, campaignId, campaignName: str(cell(r, c.name)), sku, title: str(cell(r, c.title)), ...adMetrics(r, a) }); } return { records: [...by.values()], warnings: bad ? [`${bad} sku-ad row(s) skipped.`] : [] }; }
export function parsePlacement(s: Sheet, profileId: string, from: string, to: string) { const a = adCols(s); const c = { ...campCols(s), placement: colOf(s, 'placement') }; const by = new Map<string, typeof nkAdPlacement.$inferInsert>(); let bad = 0; for (const r of s.rows) { const placement = str(cell(r, c.placement)); const campaignId = str(cell(r, c.cid)); if (!placement) { bad++; continue; } by.set(`${campaignId}${placement}`, { profileId, periodFrom: from, periodTo: to, campaignId, campaignName: str(cell(r, c.name)), placement, ...adMetrics(r, a) }); } return { records: [...by.values()], warnings: bad ? [`${bad} placement row(s) skipped.`] : [] }; }
export function parseSearchTerm(s: Sheet, profileId: string, from: string, to: string) { const a = adCols(s); const c = { ...campCols(s), term: colOf(s, 'search term'), match: colOf(s, 'match type') }; const by = new Map<string, typeof nkAdSearchTerm.$inferInsert>(); let bad = 0; for (const r of s.rows) { const searchTerm = str(cell(r, c.term)).toLowerCase(); const campaignId = str(cell(r, c.cid)); const matchType = str(cell(r, c.match)).toLowerCase(); if (!searchTerm) { bad++; continue; } by.set(`${campaignId}${searchTerm}${matchType}`, { profileId, periodFrom: from, periodTo: to, campaignId, campaignName: str(cell(r, c.name)), searchTerm, matchType, ...adMetrics(r, a) }); } return { records: [...by.values()], warnings: bad ? [`${bad} search-term row(s) skipped.`] : [] }; }
export function parseSov(s: Sheet, profileId: string, from: string, to: string) { const c = { sku: colOf(s, 'sku'), sov: colOf(s, 'sov', 'share of voice', 'share'), rank: colOf(s, 'rank') }; const by = new Map<string, typeof nkSkuSov.$inferInsert>(); let bad = 0; for (const r of s.rows) { const sku = str(cell(r, c.sku)); if (!sku || by.has(sku)) { if (!sku) bad++; continue; } by.set(sku, { profileId, periodFrom: from, periodTo: to, sku, sov: num(cell(r, c.sov)), rank: c.rank >= 0 ? num(cell(r, c.rank)) : null }); } return { records: [...by.values()], warnings: bad ? [`${bad} SOV row(s) skipped.`] : [] }; }

export function parseSkuMapper(s: Sheet, profileId: string) { const c = { sku: colOf(s, 'sku'), title: colOf(s, 'title', 'product'), cat: colOf(s, 'category'), price: colOf(s, 'selling price') }; const by = new Map<string, typeof nkSkuMap.$inferInsert>(); for (const r of s.rows) { const sku = str(cell(r, c.sku)); if (!sku || by.has(sku)) continue; by.set(sku, { profileId, sku, title: str(cell(r, c.title)), category: str(cell(r, c.cat)), sellingPrice: num(cell(r, c.price)) }); } return { records: [...by.values()], warnings: by.size ? [] : ['No SKU rows found in the SKU mapper.'] }; }
export function parseCampaignMapper(s: Sheet, profileId: string) { const c = { name: colOf(s, 'campaign', 'campaign name'), cat: colOf(s, 'category') }; const by = new Map<string, typeof nkCampaignMap.$inferInsert>(); for (const r of s.rows) { const campaignName = str(cell(r, c.name)); if (!campaignName || by.has(campaignName)) continue; by.set(campaignName, { profileId, campaignName, category: str(cell(r, c.cat)) }); } return { records: [...by.values()], warnings: by.size ? [] : ['No Campaign rows found in the campaign mapper.'] }; }

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); }
async function storeSales(profileId: string, source: NkSalesSource, dates: string[], rows: SalesRow[]) { await db.transaction(async (tx: Tx) => { await tx.delete(nkDailySkuSales).where(and(eq(nkDailySkuSales.profileId, profileId), eq(nkDailySkuSales.source, source), inArray(nkDailySkuSales.date, dates))); await chunked(rows, 1000, (p) => tx.insert(nkDailySkuSales).values(p)); }); return rows.length; }
type PeriodTable = typeof nkAdCampaign | typeof nkAdSku | typeof nkAdPlacement | typeof nkAdSearchTerm | typeof nkSkuSov;
async function storePeriod<T>(table: PeriodTable, profileId: string, from: string, to: string, rows: T[]) { await db.transaction(async (tx: Tx) => { await tx.delete(table).where(and(eq(table.profileId, profileId), eq(table.periodFrom, from), eq(table.periodTo, to))); /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ await chunked(rows, 1000, (p) => tx.insert(table).values(p as any)); }); return rows.length; }
async function replaceAll<T>(table: typeof nkSkuMap | typeof nkCampaignMap, profileId: string, rows: T[]) { await db.transaction(async (tx: Tx) => { await tx.delete(table).where(eq(table.profileId, profileId)); /* eslint-disable-next-line @typescript-eslint/no-explicit-any */ await chunked(rows, 1000, (p) => tx.insert(table).values(p as any)); }); return rows.length; }

const todayISO = () => new Date().toISOString().slice(0, 10);
function windowFor(fileName: string, opts: NkIngestOpts): [string, string] { const f = fileDateRange(fileName); if (f) return f; if (opts.from && opts.to) return [opts.from, opts.to]; const d = opts.from ?? opts.to ?? todayISO(); return [d, d]; }

export async function ingestNykaaFile(profileId: string, filename: string, raw: Buffer, opts: NkIngestOpts = {}): Promise<NkFileResult[]> {
  let sheets: Sheet[];
  try { sheets = readNykaaWorkbook(toUtf8Csv(raw), filename); } catch (err) { return [{ filename, status: 'error', message: `Could not read file: ${(err as Error).message}` }]; }
  const results: NkFileResult[] = [];
  for (const s of sheets) {
    let type = detectNykaa(s);
    const base: Omit<NkFileResult, 'status'> = { filename, sheet: s.sheetName, reportType: type, rowsRead: s.rows.length };
    if (type === 'unknown') { results.push({ ...base, status: 'skipped', message: `Sheet "${s.sheetName}" is not a recognised Nykaa report.` }); continue; }
    try {
      if (type === 'nk_sales_report') {
        const source = sourceFromName(filename, s.sheetName, opts.source);
        type = source === 'mis' ? 'nk_mis' : 'nk_sales_report';
        const p = parseSales(s, profileId, source);
        const stored = p.records.length ? await storeSales(profileId, source, p.dates, p.records) : 0;
        results.push({ ...base, reportType: type, source, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.dates.length ? { from: p.dates[0]!, to: p.dates[p.dates.length - 1]! } : {}), ...(p.warnings.length ? { warnings: p.warnings } : {}) });
      } else if (type === 'nk_sku_mapper') { const p = parseSkuMapper(s, profileId); const stored = p.records.length ? await replaceAll(nkSkuMap, profileId, p.records) : 0; results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.warnings.length ? { warnings: p.warnings } : {}) }); }
      else if (type === 'nk_campaign_mapper') { const p = parseCampaignMapper(s, profileId); const stored = p.records.length ? await replaceAll(nkCampaignMap, profileId, p.records) : 0; results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.warnings.length ? { warnings: p.warnings } : {}) }); }
      else {
        const [from, to] = windowFor(filename, opts); let stored = 0; let warnings: string[] = [];
        if (type === 'nk_ad_campaign') { const p = parseCampaign(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(nkAdCampaign, profileId, from, to, p.records) : 0; }
        else if (type === 'nk_ad_sku') { const p = parseAdSku(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(nkAdSku, profileId, from, to, p.records) : 0; }
        else if (type === 'nk_ad_placement') { const p = parsePlacement(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(nkAdPlacement, profileId, from, to, p.records) : 0; }
        else if (type === 'nk_ad_search_term') { const p = parseSearchTerm(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(nkAdSearchTerm, profileId, from, to, p.records) : 0; }
        else { const p = parseSov(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(nkSkuSov, profileId, from, to, p.records) : 0; }
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, from, to, ...(warnings.length ? { warnings } : {}) });
      }
    } catch (err) { results.push({ ...base, status: 'error', message: (err as Error).message }); }
  }
  if (results.some((r) => r.status === 'stored')) invalidateNkDims(profileId);
  return results;
}
export { NK_REPORT_LABEL };
