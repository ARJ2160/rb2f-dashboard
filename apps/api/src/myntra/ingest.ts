import { MY_REPORT_LABEL, type MyReportType, type MyTargetType } from '@dash/shared/myntra';
import { and, eq, inArray } from 'drizzle-orm';

import { fileDateRange, inferDateOrder, num, str, toISODate } from '../blinkit/ingestion/clean';
import { db, type Tx } from '../db/client';
import { toUtf8Csv } from '../gcs/warehouse';
import { invalidateMyDims } from './reports/dims';
import { readMyntraWorkbook, type Sheet } from './sheet-reader';
import {
  myAdCampaign, myAdPlacement, myAdProduct, myAdSearchTerm, myAdTargeting,
  myCampaignMap, myDailyStyleSales, myStyleMap, myTopSearchTerms,
} from './schema';

/* Myntra ingestion. Total Sales is dated (replace-by-date); ad reports are
   dateless → export window (replace-by-period). Product Targeting + Keyword
   Targeting merge into my_ad_targeting. TODO: confirm column signatures. */

export interface MyIngestOpts { from?: string; to?: string }
export interface MyFileResult {
  filename: string; sheet?: string; status: 'stored' | 'skipped' | 'error';
  reportType?: MyReportType; from?: string; to?: string; rowsRead?: number; rowsStored?: number;
  message?: string; warnings?: string[];
}

const colOf = (s: Sheet, ...names: string[]) => { for (const n of names) { const i = s.headers.indexOf(n); if (i >= 0) return i; } return -1; };
const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);
const has = (s: Sheet, ...names: string[]) => names.some((n) => s.headers.includes(n));

export function detectMyntra(s: Sheet): MyReportType {
  if (!s.headers.length) return 'unknown';
  const metric = has(s, 'spend', 'ad spend', 'impressions', 'clicks', 'ad sales');
  const campaign = has(s, 'campaign', 'campaign name');
  const style = has(s, 'style', 'style id');

  if (has(s, 'volume', 'searches') && has(s, 'search term', 'term') && !metric) return 'my_top_search_terms';
  if (style && has(s, 'revenue', 'gmv') && has(s, 'units', 'quantity') && !campaign && !metric) return 'my_total_sales';
  if (has(s, 'placement') && metric) return 'my_ad_placement';
  if (has(s, 'search term', 'customer search term') && metric) return 'my_ad_search_term';
  if (has(s, 'targeted product', 'target', 'targeting', 'target keyword') && metric) return 'my_ad_targeting';
  if (style && campaign && metric) return 'my_ad_product';
  if (campaign && metric) return 'my_ad_campaign';
  if (style && has(s, 'category')) return 'my_style_mapper';
  if (campaign && has(s, 'category')) return 'my_campaign_mapper';
  return 'unknown';
}

// ── Sales ──
type SalesRow = typeof myDailyStyleSales.$inferInsert;
export function parseTotalSales(s: Sheet, profileId: string) {
  const c = { date: colOf(s, 'date'), style: colOf(s, 'style id', 'style'), state: colOf(s, 'state'), title: colOf(s, 'title', 'product'), rev: colOf(s, 'revenue', 'gmv'), units: colOf(s, 'units', 'quantity') };
  const order = inferDateOrder(s.rows.map((r) => cell(r, c.date)), s.fileName);
  const by = new Map<string, SalesRow>();
  let bad = 0;
  for (const r of s.rows) {
    const date = toISODate(cell(r, c.date), order);
    const styleId = str(cell(r, c.style));
    if (!date || !styleId) { bad++; continue; }
    const state = str(cell(r, c.state));
    const key = `${date}${styleId}${state}`;
    let row = by.get(key);
    if (!row) { row = { profileId, date, styleId, state, title: str(cell(r, c.title)), revenue: 0, units: 0 }; by.set(key, row); }
    row.revenue = (row.revenue ?? 0) + num(cell(r, c.rev));
    row.units = (row.units ?? 0) + num(cell(r, c.units));
  }
  const records = [...by.values()];
  const dates = [...new Set(records.map((r) => r.date))].sort();
  return { records, dates, warnings: bad ? [`${bad} sales row(s) without a valid Date / Style skipped.`] : [] };
}

// ── Ads ──
const adCols = (s: Sheet) => ({ impr: colOf(s, 'impressions'), clicks: colOf(s, 'clicks'), spend: colOf(s, 'spend', 'ad spend'), asales: colOf(s, 'ad sales', 'revenue', 'gmv'), aunits: colOf(s, 'ad units', 'units', 'quantity') });
const adMetrics = (r: unknown[], c: ReturnType<typeof adCols>) => ({ impressions: num(cell(r, c.impr)), clicks: num(cell(r, c.clicks)), spend: num(cell(r, c.spend)), adSales: num(cell(r, c.asales)), adUnits: num(cell(r, c.aunits)) });
const campCols = (s: Sheet) => ({ cid: colOf(s, 'campaign id'), name: colOf(s, 'campaign', 'campaign name') });

export function parseCampaign(s: Sheet, profileId: string, from: string, to: string) {
  const a = adCols(s); const c = { ...campCols(s), status: colOf(s, 'status') };
  const by = new Map<string, typeof myAdCampaign.$inferInsert>(); let bad = 0;
  for (const r of s.rows) { const campaignName = str(cell(r, c.name)); const campaignId = str(cell(r, c.cid)); if (!campaignName) { bad++; continue; } by.set(`${campaignId}${campaignName}`, { profileId, periodFrom: from, periodTo: to, campaignId, campaignName, status: str(cell(r, c.status)), ...adMetrics(r, a) }); }
  return { records: [...by.values()], warnings: bad ? [`${bad} campaign row(s) skipped.`] : [] };
}
export function parseProduct(s: Sheet, profileId: string, from: string, to: string) {
  const a = adCols(s); const c = { ...campCols(s), style: colOf(s, 'style id', 'style'), title: colOf(s, 'title', 'product') };
  const by = new Map<string, typeof myAdProduct.$inferInsert>(); let bad = 0;
  for (const r of s.rows) { const styleId = str(cell(r, c.style)); const campaignId = str(cell(r, c.cid)); if (!styleId) { bad++; continue; } by.set(`${campaignId}${styleId}`, { profileId, periodFrom: from, periodTo: to, campaignId, campaignName: str(cell(r, c.name)), styleId, title: str(cell(r, c.title)), ...adMetrics(r, a) }); }
  return { records: [...by.values()], warnings: bad ? [`${bad} product row(s) skipped.`] : [] };
}
export function parsePlacement(s: Sheet, profileId: string, from: string, to: string) {
  const a = adCols(s); const c = { ...campCols(s), placement: colOf(s, 'placement') };
  const by = new Map<string, typeof myAdPlacement.$inferInsert>(); let bad = 0;
  for (const r of s.rows) { const placement = str(cell(r, c.placement)); const campaignId = str(cell(r, c.cid)); if (!placement) { bad++; continue; } by.set(`${campaignId}${placement}`, { profileId, periodFrom: from, periodTo: to, campaignId, campaignName: str(cell(r, c.name)), placement, ...adMetrics(r, a) }); }
  return { records: [...by.values()], warnings: bad ? [`${bad} placement row(s) skipped.`] : [] };
}
export function parseSearchTerm(s: Sheet, profileId: string, from: string, to: string) {
  const a = adCols(s); const c = { ...campCols(s), term: colOf(s, 'search term', 'customer search term'), match: colOf(s, 'match type') };
  const by = new Map<string, typeof myAdSearchTerm.$inferInsert>(); let bad = 0;
  for (const r of s.rows) { const searchTerm = str(cell(r, c.term)).toLowerCase(); const campaignId = str(cell(r, c.cid)); const matchType = str(cell(r, c.match)).toLowerCase(); if (!searchTerm) { bad++; continue; } by.set(`${campaignId}${searchTerm}${matchType}`, { profileId, periodFrom: from, periodTo: to, campaignId, campaignName: str(cell(r, c.name)), searchTerm, matchType, ...adMetrics(r, a) }); }
  return { records: [...by.values()], warnings: bad ? [`${bad} search-term row(s) skipped.`] : [] };
}
export function parseTargeting(s: Sheet, profileId: string, from: string, to: string) {
  const a = adCols(s);
  const c = { ...campCols(s), ttype: colOf(s, 'target type'), target: colOf(s, 'targeted product', 'target keyword', 'target', 'targeting') };
  const by = new Map<string, typeof myAdTargeting.$inferInsert>(); let bad = 0;
  const hasProdCol = s.headers.includes('targeted product');
  for (const r of s.rows) {
    const target = str(cell(r, c.target)); const campaignId = str(cell(r, c.cid));
    if (!target) { bad++; continue; }
    let targetType = str(cell(r, c.ttype)).toLowerCase();
    if (targetType !== 'product' && targetType !== 'keyword') targetType = hasProdCol || /^b0|^\d{6,}/i.test(target) ? 'product' : 'keyword';
    by.set(`${campaignId}${targetType}${target}`, { profileId, periodFrom: from, periodTo: to, campaignId, campaignName: str(cell(r, c.name)), targetType: targetType as MyTargetType, target, ...adMetrics(r, a) });
  }
  return { records: [...by.values()], warnings: bad ? [`${bad} targeting row(s) skipped.`] : [] };
}
export function parseTopSearchTerms(s: Sheet, profileId: string, from: string, to: string) {
  const c = { term: colOf(s, 'search term', 'term'), vol: colOf(s, 'volume', 'searches'), impr: colOf(s, 'impressions'), clicks: colOf(s, 'clicks'), rank: colOf(s, 'rank') };
  const by = new Map<string, typeof myTopSearchTerms.$inferInsert>(); let bad = 0;
  for (const r of s.rows) { const term = str(cell(r, c.term)).toLowerCase(); if (!term || by.has(term)) { if (!term) bad++; continue; } by.set(term, { profileId, periodFrom: from, periodTo: to, term, volume: num(cell(r, c.vol)), yourImpressions: num(cell(r, c.impr)), yourClicks: num(cell(r, c.clicks)), rank: c.rank >= 0 ? num(cell(r, c.rank)) : null }); }
  return { records: [...by.values()], warnings: bad ? [`${bad} top-term row(s) skipped.`] : [] };
}

// ── Mappers ──
export function parseStyleMapper(s: Sheet, profileId: string) {
  const c = { style: colOf(s, 'style id', 'style'), title: colOf(s, 'title', 'product'), cat: colOf(s, 'category'), price: colOf(s, 'selling price') };
  const by = new Map<string, typeof myStyleMap.$inferInsert>();
  for (const r of s.rows) { const styleId = str(cell(r, c.style)); if (!styleId || by.has(styleId)) continue; by.set(styleId, { profileId, styleId, title: str(cell(r, c.title)), category: str(cell(r, c.cat)), sellingPrice: num(cell(r, c.price)) }); }
  return { records: [...by.values()], warnings: by.size ? [] : ['No Style rows found in the style mapper.'] };
}
export function parseCampaignMapper(s: Sheet, profileId: string) {
  const c = { name: colOf(s, 'campaign', 'campaign name'), cat: colOf(s, 'category') };
  const by = new Map<string, typeof myCampaignMap.$inferInsert>();
  for (const r of s.rows) { const campaignName = str(cell(r, c.name)); if (!campaignName || by.has(campaignName)) continue; by.set(campaignName, { profileId, campaignName, category: str(cell(r, c.cat)) }); }
  return { records: [...by.values()], warnings: by.size ? [] : ['No Campaign rows found in the campaign mapper.'] };
}

// ── Store ──
async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) { for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size)); }
async function storeSales(profileId: string, dates: string[], rows: SalesRow[]) {
  await db.transaction(async (tx: Tx) => { await tx.delete(myDailyStyleSales).where(and(eq(myDailyStyleSales.profileId, profileId), inArray(myDailyStyleSales.date, dates))); await chunked(rows, 1000, (p) => tx.insert(myDailyStyleSales).values(p)); });
  return rows.length;
}
type PeriodTable = typeof myAdCampaign | typeof myAdProduct | typeof myAdPlacement | typeof myAdSearchTerm | typeof myAdTargeting | typeof myTopSearchTerms;
async function storePeriod<T>(table: PeriodTable, profileId: string, from: string, to: string, rows: T[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(table).where(and(eq(table.profileId, profileId), eq(table.periodFrom, from), eq(table.periodTo, to)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await chunked(rows, 1000, (p) => tx.insert(table).values(p as any));
  });
  return rows.length;
}
async function replaceAll<T>(table: typeof myStyleMap | typeof myCampaignMap, profileId: string, rows: T[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(table).where(eq(table.profileId, profileId));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await chunked(rows, 1000, (p) => tx.insert(table).values(p as any));
  });
  return rows.length;
}

const todayISO = () => new Date().toISOString().slice(0, 10);
function windowFor(fileName: string, opts: MyIngestOpts): [string, string] {
  const fromName = fileDateRange(fileName);
  if (fromName) return fromName;
  if (opts.from && opts.to) return [opts.from, opts.to];
  const d = opts.from ?? opts.to ?? todayISO();
  return [d, d];
}

export async function ingestMyntraFile(profileId: string, filename: string, raw: Buffer, opts: MyIngestOpts = {}): Promise<MyFileResult[]> {
  let sheets: Sheet[];
  try { sheets = readMyntraWorkbook(toUtf8Csv(raw), filename); }
  catch (err) { return [{ filename, status: 'error', message: `Could not read file: ${(err as Error).message}` }]; }
  const results: MyFileResult[] = [];
  for (const s of sheets) {
    const type = detectMyntra(s);
    const base: Omit<MyFileResult, 'status'> = { filename, sheet: s.sheetName, reportType: type, rowsRead: s.rows.length };
    if (type === 'unknown') { results.push({ ...base, status: 'skipped', message: `Sheet "${s.sheetName}" is not a recognised Myntra report.` }); continue; }
    try {
      if (type === 'my_total_sales') {
        const p = parseTotalSales(s, profileId);
        const stored = p.records.length ? await storeSales(profileId, p.dates, p.records) : 0;
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.dates.length ? { from: p.dates[0]!, to: p.dates[p.dates.length - 1]! } : {}), ...(p.warnings.length ? { warnings: p.warnings } : {}) });
      } else if (type === 'my_style_mapper') {
        const p = parseStyleMapper(s, profileId); const stored = p.records.length ? await replaceAll(myStyleMap, profileId, p.records) : 0;
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.warnings.length ? { warnings: p.warnings } : {}) });
      } else if (type === 'my_campaign_mapper') {
        const p = parseCampaignMapper(s, profileId); const stored = p.records.length ? await replaceAll(myCampaignMap, profileId, p.records) : 0;
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.warnings.length ? { warnings: p.warnings } : {}) });
      } else {
        const [from, to] = windowFor(filename, opts);
        let stored = 0; let warnings: string[] = [];
        if (type === 'my_ad_campaign') { const p = parseCampaign(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(myAdCampaign, profileId, from, to, p.records) : 0; }
        else if (type === 'my_ad_product') { const p = parseProduct(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(myAdProduct, profileId, from, to, p.records) : 0; }
        else if (type === 'my_ad_placement') { const p = parsePlacement(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(myAdPlacement, profileId, from, to, p.records) : 0; }
        else if (type === 'my_ad_search_term') { const p = parseSearchTerm(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(myAdSearchTerm, profileId, from, to, p.records) : 0; }
        else if (type === 'my_ad_targeting') { const p = parseTargeting(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(myAdTargeting, profileId, from, to, p.records) : 0; }
        else { const p = parseTopSearchTerms(s, profileId, from, to); warnings = p.warnings; stored = p.records.length ? await storePeriod(myTopSearchTerms, profileId, from, to, p.records) : 0; }
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, from, to, ...(warnings.length ? { warnings } : {}) });
      }
    } catch (err) { results.push({ ...base, status: 'error', message: (err as Error).message }); }
  }
  if (results.some((r) => r.status === 'stored')) invalidateMyDims(profileId);
  return results;
}

export { MY_REPORT_LABEL };
