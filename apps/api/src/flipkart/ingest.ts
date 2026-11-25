import { FK_REPORT_LABEL, type FkReportType } from '@dash/shared/flipkart';
import { and, eq, inArray } from 'drizzle-orm';

import { fileDateRange, inferDateOrder, num, str, toISODate } from '../blinkit/ingestion/clean';
import { db, type Tx } from '../db/client';
import { toUtf8Csv } from '../gcs/warehouse';
import { invalidateFkDims } from './reports/dims';
import { readFlipkartWorkbook, type Sheet } from './sheet-reader';
import {
  fkAdCampaign,
  fkAdFsn,
  fkAdKeyword,
  fkAdPlacement,
  fkAdSearchTerm,
  fkCampaignMap,
  fkDailyFsnReturns,
  fkDailyFsnSales,
  fkFsnMap,
} from './schema';

/* Flipkart ingestion: one file → each sheet detected by its COLUMNS → parsed →
   stored. Traffic / Earn More are dated (replace-by-date); the five ad reports
   carry no date, so they are stored against the export window
   (replace-by-period). Used by the GCS sync (`<brand>/flipkart/…`).

   TODO: the column aliases below are a best guess from the brief — confirm each
   `colOf(...)` list and `detectFlipkart` signature against a real Flipkart
   export, then delete this note. Everything downstream (schema, reports, views)
   keys off these, so only the column spellings should ever need to change. */

export interface FkIngestOpts {
  from?: string;
  to?: string;
}

export interface FkFileResult {
  filename: string;
  sheet?: string;
  status: 'stored' | 'skipped' | 'error';
  reportType?: FkReportType;
  from?: string;
  to?: string;
  rowsRead?: number;
  rowsStored?: number;
  message?: string;
  warnings?: string[];
}

// ── column helpers ───────────────────────────────────────────────────

const colOf = (s: Sheet, ...names: string[]) => {
  for (const n of names) {
    const i = s.headers.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};
const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);
const has = (s: Sheet, ...names: string[]) => names.some((n) => s.headers.includes(n));

// ── Detection (column-based) ─────────────────────────────────────────

export function detectFlipkart(s: Sheet): FkReportType {
  if (!s.headers.length) return 'unknown';
  const metric = has(s, 'spend', 'ad spend', 'impressions', 'clicks', 'ad sales');
  const fsn = has(s, 'fsn');
  const campaign = has(s, 'campaign', 'campaign name');

  // sales-side (per-row date)
  if (fsn && has(s, 'returns', 'return units', 'cancellations', 'cancelled units', 'net revenue', 'net units'))
    return 'fk_earn_more';
  if (fsn && has(s, 'impressions', 'views') && has(s, 'clicks') && !campaign) return 'fk_traffic';

  // ads (period)
  if (has(s, 'placement') && metric) return 'fk_ad_placement';
  if (has(s, 'search term', 'customer search term') && metric) return 'fk_ad_search_term';
  if (has(s, 'keyword') && metric) return 'fk_ad_keyword';
  if (fsn && campaign && metric) return 'fk_ad_fsn';
  if (campaign && metric) return 'fk_ad_campaign';

  // mappers (no metric columns)
  if (fsn && has(s, 'category')) return 'fk_fsn_mapper';
  if (campaign && has(s, 'category')) return 'fk_campaign_mapper';
  return 'unknown';
}

// ── Sales-side parsers (per-row date) ────────────────────────────────

type SalesRow = typeof fkDailyFsnSales.$inferInsert;
type ReturnsRow = typeof fkDailyFsnReturns.$inferInsert;

export function parseTraffic(s: Sheet, profileId: string) {
  const c = {
    date: colOf(s, 'date'),
    fsn: colOf(s, 'fsn'),
    title: colOf(s, 'title', 'product'),
    rev: colOf(s, 'revenue', 'gmv'),
    units: colOf(s, 'units', 'quantity'),
    impr: colOf(s, 'impressions', 'views'),
    clicks: colOf(s, 'clicks'),
  };
  const order = inferDateOrder(s.rows.map((r) => cell(r, c.date)), s.fileName);
  const by = new Map<string, SalesRow>();
  let bad = 0;
  for (const r of s.rows) {
    const date = toISODate(cell(r, c.date), order);
    const fsn = str(cell(r, c.fsn));
    if (!date || !fsn) {
      bad++;
      continue;
    }
    const key = `${date}${fsn}`;
    let row = by.get(key);
    if (!row) {
      row = { profileId, date, fsn, title: str(cell(r, c.title)), revenueGross: 0, units: 0, impressionsTotal: 0, clicksTotal: 0 };
      by.set(key, row);
    }
    row.revenueGross = (row.revenueGross ?? 0) + num(cell(r, c.rev));
    row.units = (row.units ?? 0) + num(cell(r, c.units));
    row.impressionsTotal = (row.impressionsTotal ?? 0) + num(cell(r, c.impr));
    row.clicksTotal = (row.clicksTotal ?? 0) + num(cell(r, c.clicks));
  }
  const records = [...by.values()];
  const dates = [...new Set(records.map((r) => r.date))].sort();
  const warnings = bad ? [`${bad} traffic row(s) without a valid Date / FSN skipped.`] : [];
  return { records, dates, warnings };
}

export function parseEarnMore(s: Sheet, profileId: string) {
  const c = {
    date: colOf(s, 'date'),
    fsn: colOf(s, 'fsn'),
    ret: colOf(s, 'returns', 'return units'),
    canc: colOf(s, 'cancellations', 'cancelled units'),
    netRev: colOf(s, 'net revenue'),
    netUnits: colOf(s, 'net units'),
  };
  const order = inferDateOrder(s.rows.map((r) => cell(r, c.date)), s.fileName);
  const by = new Map<string, ReturnsRow>();
  let bad = 0;
  for (const r of s.rows) {
    const date = toISODate(cell(r, c.date), order);
    const fsn = str(cell(r, c.fsn));
    if (!date || !fsn) {
      bad++;
      continue;
    }
    const key = `${date}${fsn}`;
    let row = by.get(key);
    if (!row) {
      row = { profileId, date, fsn, returnsUnits: 0, cancellationsUnits: 0, netRevenue: 0, netUnits: 0 };
      by.set(key, row);
    }
    row.returnsUnits = (row.returnsUnits ?? 0) + num(cell(r, c.ret));
    row.cancellationsUnits = (row.cancellationsUnits ?? 0) + num(cell(r, c.canc));
    row.netRevenue = (row.netRevenue ?? 0) + num(cell(r, c.netRev));
    row.netUnits = (row.netUnits ?? 0) + num(cell(r, c.netUnits));
  }
  const records = [...by.values()];
  const dates = [...new Set(records.map((r) => r.date))].sort();
  const warnings = bad ? [`${bad} earn-more row(s) without a valid Date / FSN skipped.`] : [];
  return { records, dates, warnings };
}

// ── Ad parsers (period) ──────────────────────────────────────────────

const adCols = (s: Sheet) => ({
  impr: colOf(s, 'impressions', 'views'),
  clicks: colOf(s, 'clicks'),
  spend: colOf(s, 'spend', 'ad spend'),
  asales: colOf(s, 'ad sales', 'revenue', 'gmv'),
  aunits: colOf(s, 'ad units', 'units', 'quantity'),
});
const adMetrics = (r: unknown[], c: ReturnType<typeof adCols>) => ({
  impressions: num(cell(r, c.impr)),
  clicks: num(cell(r, c.clicks)),
  spend: num(cell(r, c.spend)),
  adSales: num(cell(r, c.asales)),
  adUnits: num(cell(r, c.aunits)),
});

type CampRow = typeof fkAdCampaign.$inferInsert;
type FsnAdRow = typeof fkAdFsn.$inferInsert;
type PlaceRow = typeof fkAdPlacement.$inferInsert;
type StRow = typeof fkAdSearchTerm.$inferInsert;
type KwRow = typeof fkAdKeyword.$inferInsert;

const campCols = (s: Sheet) => ({
  cid: colOf(s, 'campaign id'),
  name: colOf(s, 'campaign', 'campaign name'),
  type: colOf(s, 'campaign type'),
  status: colOf(s, 'status'),
});

export function parseCampaign(s: Sheet, profileId: string, from: string, to: string) {
  const a = adCols(s);
  const c = campCols(s);
  const by = new Map<string, CampRow>();
  let bad = 0;
  for (const r of s.rows) {
    const campaignName = str(cell(r, c.name));
    const campaignId = str(cell(r, c.cid));
    if (!campaignName) {
      bad++;
      continue;
    }
    by.set(`${campaignId}${campaignName}`, {
      profileId,
      periodFrom: from,
      periodTo: to,
      campaignId,
      campaignName,
      campaignType: str(cell(r, c.type)),
      status: str(cell(r, c.status)),
      ...adMetrics(r, a),
    });
  }
  return { records: [...by.values()], warnings: bad ? [`${bad} campaign row(s) without a name skipped.`] : [] };
}

export function parseAdFsn(s: Sheet, profileId: string, from: string, to: string) {
  const a = adCols(s);
  const c = { cid: colOf(s, 'campaign id'), name: colOf(s, 'campaign', 'campaign name'), fsn: colOf(s, 'fsn'), title: colOf(s, 'title', 'product') };
  const by = new Map<string, FsnAdRow>();
  let bad = 0;
  for (const r of s.rows) {
    const fsn = str(cell(r, c.fsn));
    const campaignId = str(cell(r, c.cid));
    if (!fsn) {
      bad++;
      continue;
    }
    by.set(`${campaignId}${fsn}`, {
      profileId,
      periodFrom: from,
      periodTo: to,
      campaignId,
      campaignName: str(cell(r, c.name)),
      fsn,
      title: str(cell(r, c.title)),
      ...adMetrics(r, a),
    });
  }
  return { records: [...by.values()], warnings: bad ? [`${bad} consolidated-FSN row(s) without an FSN skipped.`] : [] };
}

export function parsePlacement(s: Sheet, profileId: string, from: string, to: string) {
  const a = adCols(s);
  const c = { cid: colOf(s, 'campaign id'), name: colOf(s, 'campaign', 'campaign name'), placement: colOf(s, 'placement') };
  const by = new Map<string, PlaceRow>();
  let bad = 0;
  for (const r of s.rows) {
    const placement = str(cell(r, c.placement));
    const campaignId = str(cell(r, c.cid));
    if (!placement) {
      bad++;
      continue;
    }
    by.set(`${campaignId}${placement}`, {
      profileId,
      periodFrom: from,
      periodTo: to,
      campaignId,
      campaignName: str(cell(r, c.name)),
      placement,
      ...adMetrics(r, a),
    });
  }
  return { records: [...by.values()], warnings: bad ? [`${bad} placement row(s) without a placement skipped.`] : [] };
}

export function parseSearchTerm(s: Sheet, profileId: string, from: string, to: string) {
  const a = adCols(s);
  const c = { cid: colOf(s, 'campaign id'), name: colOf(s, 'campaign', 'campaign name'), term: colOf(s, 'search term', 'customer search term'), match: colOf(s, 'match type') };
  const by = new Map<string, StRow>();
  let bad = 0;
  for (const r of s.rows) {
    const searchTerm = str(cell(r, c.term)).toLowerCase();
    const campaignId = str(cell(r, c.cid));
    const matchType = str(cell(r, c.match)).toLowerCase();
    if (!searchTerm) {
      bad++;
      continue;
    }
    by.set(`${campaignId}${searchTerm}${matchType}`, {
      profileId,
      periodFrom: from,
      periodTo: to,
      campaignId,
      campaignName: str(cell(r, c.name)),
      searchTerm,
      matchType,
      ...adMetrics(r, a),
    });
  }
  return { records: [...by.values()], warnings: bad ? [`${bad} search-term row(s) without a term skipped.`] : [] };
}

export function parseKeyword(s: Sheet, profileId: string, from: string, to: string) {
  const a = adCols(s);
  const c = { cid: colOf(s, 'campaign id'), name: colOf(s, 'campaign', 'campaign name'), kw: colOf(s, 'keyword'), match: colOf(s, 'match type') };
  const by = new Map<string, KwRow>();
  let bad = 0;
  for (const r of s.rows) {
    const keyword = str(cell(r, c.kw));
    const campaignId = str(cell(r, c.cid));
    const matchType = str(cell(r, c.match)).toLowerCase();
    if (!keyword) {
      bad++;
      continue;
    }
    by.set(`${campaignId}${keyword}${matchType}`, {
      profileId,
      periodFrom: from,
      periodTo: to,
      campaignId,
      campaignName: str(cell(r, c.name)),
      keyword,
      matchType,
      ...adMetrics(r, a),
    });
  }
  return { records: [...by.values()], warnings: bad ? [`${bad} keyword row(s) without a keyword skipped.`] : [] };
}

// ── Mapper parsers ───────────────────────────────────────────────────

type FsnMapRow = typeof fkFsnMap.$inferInsert;
type CampMapRow = typeof fkCampaignMap.$inferInsert;

export function parseFsnMapper(s: Sheet, profileId: string) {
  const c = { fsn: colOf(s, 'fsn'), title: colOf(s, 'title', 'product'), cat: colOf(s, 'category'), price: colOf(s, 'selling price') };
  const by = new Map<string, FsnMapRow>();
  for (const r of s.rows) {
    const fsn = str(cell(r, c.fsn));
    if (!fsn || by.has(fsn)) continue;
    by.set(fsn, { profileId, fsn, title: str(cell(r, c.title)), category: str(cell(r, c.cat)), sellingPrice: num(cell(r, c.price)) });
  }
  return { records: [...by.values()], warnings: by.size ? [] : ['No FSN rows found in the FSN mapper.'] };
}

export function parseCampaignMapper(s: Sheet, profileId: string) {
  const c = { name: colOf(s, 'campaign', 'campaign name'), cat: colOf(s, 'category'), sku: colOf(s, 'sku'), city: colOf(s, 'city') };
  const by = new Map<string, CampMapRow>();
  for (const r of s.rows) {
    const campaignName = str(cell(r, c.name));
    if (!campaignName || by.has(campaignName)) continue;
    by.set(campaignName, { profileId, campaignName, category: str(cell(r, c.cat)), sku: str(cell(r, c.sku)), city: str(cell(r, c.city)) });
  }
  return { records: [...by.values()], warnings: by.size ? [] : ['No Campaign rows found in the campaign mapper.'] };
}

// ── Store ────────────────────────────────────────────────────────────

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

async function storeSales(profileId: string, dates: string[], rows: SalesRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(fkDailyFsnSales).where(and(eq(fkDailyFsnSales.profileId, profileId), inArray(fkDailyFsnSales.date, dates)));
    await chunked(rows, 1000, (part) => tx.insert(fkDailyFsnSales).values(part));
  });
  return rows.length;
}
async function storeReturns(profileId: string, dates: string[], rows: ReturnsRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(fkDailyFsnReturns).where(and(eq(fkDailyFsnReturns.profileId, profileId), inArray(fkDailyFsnReturns.date, dates)));
    await chunked(rows, 1000, (part) => tx.insert(fkDailyFsnReturns).values(part));
  });
  return rows.length;
}

type PeriodTable = typeof fkAdCampaign | typeof fkAdFsn | typeof fkAdPlacement | typeof fkAdSearchTerm | typeof fkAdKeyword;
async function storePeriod<T extends { profileId: unknown }>(table: PeriodTable, profileId: string, from: string, to: string, rows: T[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(table).where(and(eq(table.profileId, profileId), eq(table.periodFrom, from), eq(table.periodTo, to)));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await chunked(rows, 1000, (part) => tx.insert(table).values(part as any));
  });
  return rows.length;
}

async function replaceAll<T extends { profileId: unknown }>(table: typeof fkFsnMap | typeof fkCampaignMap, profileId: string, rows: T[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(table).where(eq(table.profileId, profileId));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await chunked(rows, 1000, (part) => tx.insert(table).values(part as any));
  });
  return rows.length;
}

// ── One file ─────────────────────────────────────────────────────────

const todayISO = () => new Date().toISOString().slice(0, 10);
function windowFor(fileName: string, opts: FkIngestOpts): [string, string] {
  const fromName = fileDateRange(fileName);
  if (fromName) return fromName;
  if (opts.from && opts.to) return [opts.from, opts.to];
  const d = opts.from ?? opts.to ?? todayISO();
  return [d, d];
}

export async function ingestFlipkartFile(
  profileId: string,
  filename: string,
  raw: Buffer,
  opts: FkIngestOpts = {}
): Promise<FkFileResult[]> {
  let sheets: Sheet[];
  try {
    sheets = readFlipkartWorkbook(toUtf8Csv(raw), filename);
  } catch (err) {
    return [{ filename, status: 'error', message: `Could not read file: ${(err as Error).message}` }];
  }
  const results: FkFileResult[] = [];
  for (const s of sheets) {
    const type = detectFlipkart(s);
    const base: Omit<FkFileResult, 'status'> = { filename, sheet: s.sheetName, reportType: type, rowsRead: s.rows.length };
    if (type === 'unknown') {
      results.push({ ...base, status: 'skipped', message: `Sheet "${s.sheetName}" is not a recognised Flipkart report.` });
      continue;
    }
    try {
      if (type === 'fk_traffic') {
        const p = parseTraffic(s, profileId);
        const stored = p.records.length ? await storeSales(profileId, p.dates, p.records) : 0;
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.dates.length ? { from: p.dates[0]!, to: p.dates[p.dates.length - 1]! } : {}), ...(p.warnings.length ? { warnings: p.warnings } : {}) });
      } else if (type === 'fk_earn_more') {
        const p = parseEarnMore(s, profileId);
        const stored = p.records.length ? await storeReturns(profileId, p.dates, p.records) : 0;
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.dates.length ? { from: p.dates[0]!, to: p.dates[p.dates.length - 1]! } : {}), ...(p.warnings.length ? { warnings: p.warnings } : {}) });
      } else if (type === 'fk_fsn_mapper') {
        const p = parseFsnMapper(s, profileId);
        const stored = p.records.length ? await replaceAll(fkFsnMap, profileId, p.records) : 0;
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.warnings.length ? { warnings: p.warnings } : {}) });
      } else if (type === 'fk_campaign_mapper') {
        const p = parseCampaignMapper(s, profileId);
        const stored = p.records.length ? await replaceAll(fkCampaignMap, profileId, p.records) : 0;
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.warnings.length ? { warnings: p.warnings } : {}) });
      } else {
        // ad reports — dateless → export window
        const [from, to] = windowFor(filename, opts);
        let stored = 0;
        let warnings: string[] = [];
        if (type === 'fk_ad_campaign') {
          const p = parseCampaign(s, profileId, from, to);
          warnings = p.warnings;
          stored = p.records.length ? await storePeriod(fkAdCampaign, profileId, from, to, p.records) : 0;
        } else if (type === 'fk_ad_fsn') {
          const p = parseAdFsn(s, profileId, from, to);
          warnings = p.warnings;
          stored = p.records.length ? await storePeriod(fkAdFsn, profileId, from, to, p.records) : 0;
        } else if (type === 'fk_ad_placement') {
          const p = parsePlacement(s, profileId, from, to);
          warnings = p.warnings;
          stored = p.records.length ? await storePeriod(fkAdPlacement, profileId, from, to, p.records) : 0;
        } else if (type === 'fk_ad_search_term') {
          const p = parseSearchTerm(s, profileId, from, to);
          warnings = p.warnings;
          stored = p.records.length ? await storePeriod(fkAdSearchTerm, profileId, from, to, p.records) : 0;
        } else {
          const p = parseKeyword(s, profileId, from, to);
          warnings = p.warnings;
          stored = p.records.length ? await storePeriod(fkAdKeyword, profileId, from, to, p.records) : 0;
        }
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, from, to, ...(warnings.length ? { warnings } : {}) });
      }
    } catch (err) {
      results.push({ ...base, status: 'error', message: (err as Error).message });
    }
  }
  if (results.some((r) => r.status === 'stored')) invalidateFkDims(profileId);
  return results;
}

export { FK_REPORT_LABEL };
