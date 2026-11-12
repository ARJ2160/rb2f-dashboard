import { canonicalCity, IM_REPORT_LABEL, normKey, type ImReportType } from '@dash/shared/blinkit';
import { and, eq, inArray } from 'drizzle-orm';
import * as XLSX from 'xlsx';

import { inferDateOrder, num, str, toISODate } from '../blinkit/ingestion/clean';
import { db, type Tx } from '../db/client';
import { toUtf8Csv } from '../gcs/warehouse';
import { invalidateImDims } from './dims';
import { imAds, imSales, imSkuMap } from './schema';

/* Swiggy Instamart ingestion: one file → each sheet detected by its COLUMNS →
   parsed → stored replace-by-date. Used by the GCS sync
   (`<brand>/swiggy_instamart/…`) and POST /api/instamart/uploads.

   Expected exports (Oct 2026):
   - Sales  : BRAND, ORDERED_DATE, CITY, AREA_NAME, STORE_ID, L1–L3_CATEGORY, PRODUCT_NAME,
              VARIANT, ITEM_CODE, COMBO, COMBO_ITEM_CODE, COMBO_UNITS_SOLD, BASE_MRP, UNITS_SOLD, GMV
   - Ads    : METRICS_DATE, CAMPAIGN_ID, CAMPAIGN_NAME, AD_PROPERTY, KEYWORD, MATCH_TYPE, PRODUCT_NAME,
              CITY, TOTAL_IMPRESSIONS, TOTAL_BUDGET_BURNT, TOTAL_CLICKS, TOTAL_A2C, TOTAL_GMV,
              TOTAL_CONVERSIONS, TOTAL_DIRECT_GMV_7/14_DAYS, AD_RANK, …
   - Mapper : side-by-side blocks — "Item Code | Product Name | SKU | Category" and
              "Product Name | SKU | …" (product AND campaign names → SKU). */

export interface ImFileResult {
  filename: string;
  sheet?: string;
  status: 'stored' | 'skipped' | 'error';
  reportType?: ImReportType;
  from?: string;
  to?: string;
  rowsRead?: number;
  rowsStored?: number;
  message?: string;
  warnings?: string[];
}

interface Sheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: unknown[][];
}

const TOKENS = new Set([
  'ordered date', 'city', 'area name', 'store id', 'item code', 'product name', 'units sold', 'gmv', 'base mrp',
  'metrics date', 'campaign id', 'campaign name', 'ad property', 'keyword', 'total impressions', 'total budget burnt',
  'sku', 'category',
]);

function isBinary(buf: Buffer) {
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return true;
  return buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
}

/** Workbook / CSV → sheets with the header row found by content (first 20 rows). */
export function readInstamartWorkbook(buf: Buffer, fileName: string): Sheet[] {
  const binary = isBinary(buf);
  // CSV: never let SheetJS guess dates (ads write dd-mm-yyyy).
  const wb = XLSX.read(buf, { type: 'buffer', raw: !binary, cellDates: false, cellNF: false, cellStyles: false });
  const out: Sheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
    let h = -1, best = 0;
    for (let i = 0; i < Math.min(grid.length, 20); i++) {
      const score = (grid[i] ?? []).filter((c) => c != null && TOKENS.has(normKey(c))).length;
      if (score > best) { best = score; h = i; }
    }
    if (best < 2) { out.push({ fileName, sheetName: name, headers: [], rows: [] }); continue; }
    out.push({
      fileName,
      sheetName: name,
      headers: (grid[h] ?? []).map((c) => normKey(c)),
      rows: grid.slice(h + 1).filter((r) => r.some((c) => c != null && c !== '')),
    });
  }
  return out;
}

export function detectInstamart(s: Sheet): ImReportType {
  const h = new Set(s.headers);
  const has = (...c: string[]) => c.every((x) => h.has(x));
  if (has('ordered date', 'item code') && (h.has('units sold') || h.has('gmv'))) return 'im_sales';
  if (has('metrics date', 'campaign id') && (h.has('total budget burnt') || h.has('total impressions'))) return 'im_ads';
  if (h.has('sku') && (h.has('item code') || h.has('product name')) && !h.has('units sold') && !h.has('campaign id')) return 'im_sku_mapper';
  return 'unknown';
}

const colOf = (s: Sheet, ...names: string[]) => {
  for (const n of names) {
    const i = s.headers.indexOf(n);
    if (i >= 0) return i;
  }
  return -1;
};
const cell = (r: unknown[], i: number) => (i >= 0 ? r[i] : undefined);

/** Ads / sales cities: same canonical spelling on both sides ("bangalore" / "Bangalore" → "Bengaluru"). */
export function imCity(raw: unknown): string {
  const c = canonicalCity(raw);
  if (!c) return 'Unknown';
  return c === c.toLowerCase() ? c.replace(/\b[a-z]/g, (m) => m.toUpperCase()) : c;
}

export const AD_TYPE_CODE = (prop: string): string => {
  const k = normKey(prop);
  if (k.startsWith('keyword')) return 'KW';
  if (k.includes('inline banner') || k === 'sib') return 'SIB';
  if (k.includes('auto suggest')) return 'AS';
  return (k.match(/\b[a-z]/g) ?? ['X']).join('').toUpperCase().slice(0, 6);
};

// ── Sales ─────────────────────────────────────────────────────────────

type SalesRow = typeof imSales.$inferInsert;

export function parseSales(s: Sheet, profileId: string) {
  const c = {
    date: colOf(s, 'ordered date'), city: colOf(s, 'city'), area: colOf(s, 'area name'), store: colOf(s, 'store id'),
    item: colOf(s, 'item code'), combo: colOf(s, 'combo item code'), name: colOf(s, 'product name'), variant: colOf(s, 'variant'),
    l1: colOf(s, 'l1 category'), l3: colOf(s, 'l3 category'), mrp: colOf(s, 'base mrp'), units: colOf(s, 'units sold'), gmv: colOf(s, 'gmv'),
  };
  const order = inferDateOrder(s.rows.map((r) => cell(r, c.date)), s.fileName);
  const by = new Map<string, SalesRow>();
  let badDate = 0, merged = 0;
  for (const r of s.rows) {
    const date = toISODate(cell(r, c.date), order);
    const itemCode = str(cell(r, c.item)).replace(/\.0+$/, '');
    if (!date || !itemCode) { badDate++; continue; }
    const row: SalesRow = {
      profileId, date, city: imCity(cell(r, c.city)), area: str(cell(r, c.area)), storeId: str(cell(r, c.store)).replace(/\.0+$/, ''),
      itemCode, comboItemCode: str(cell(r, c.combo)).replace(/\.0+$/, ''), productName: str(cell(r, c.name)), variant: str(cell(r, c.variant)),
      l1Category: str(cell(r, c.l1)), l3Category: str(cell(r, c.l3)), mrp: num(cell(r, c.mrp)), units: num(cell(r, c.units)), gmv: num(cell(r, c.gmv)),
    };
    const key = [row.date, row.city, row.area, row.storeId, row.itemCode, row.comboItemCode].join('\u0001');
    const prev = by.get(key);
    if (prev) { prev.units = (prev.units ?? 0) + (row.units ?? 0); prev.gmv = (prev.gmv ?? 0) + (row.gmv ?? 0); merged++; }
    else by.set(key, row);
  }
  const records = [...by.values()];
  const dates = [...new Set(records.map((r) => r.date))].sort();
  const warnings: string[] = [];
  if (badDate) warnings.push(`${badDate} row(s) without a valid ORDERED_DATE / ITEM_CODE skipped.`);
  if (merged) warnings.push(`${merged} row(s) for the same day × store × item added together.`);
  return { records, dates, warnings };
}

// ── Ads ───────────────────────────────────────────────────────────────

type AdRow = typeof imAds.$inferInsert;

export function parseAds(s: Sheet, profileId: string) {
  const c = {
    date: colOf(s, 'metrics date'), id: colOf(s, 'campaign id'), name: colOf(s, 'campaign name'), prop: colOf(s, 'ad property'),
    kw: colOf(s, 'keyword'), match: colOf(s, 'match type'), product: colOf(s, 'product name'), city: colOf(s, 'city'),
    impr: colOf(s, 'total impressions'), clicks: colOf(s, 'total clicks'), a2c: colOf(s, 'total a2c'), conv: colOf(s, 'total conversions'),
    gmv: colOf(s, 'total gmv'), d7: colOf(s, 'total direct gmv 7 days'), d14: colOf(s, 'total direct gmv 14 days'),
    spend: colOf(s, 'total budget burnt'), branded: colOf(s, 'branded searches clicks'), rank: colOf(s, 'ad rank'),
  };
  const order = inferDateOrder(s.rows.map((r) => cell(r, c.date)), s.fileName);
  const by = new Map<string, AdRow>();
  let bad = 0;
  const add = (t: AdRow, k: keyof AdRow, v: number) => ((t[k] as number) = ((t[k] as number | undefined) ?? 0) + v);
  for (const r of s.rows) {
    const date = toISODate(cell(r, c.date), order);
    const campaignId = str(cell(r, c.id));
    if (!date || !campaignId) { bad++; continue; }
    const kw = str(cell(r, c.kw));
    const product = str(cell(r, c.product));
    const row: AdRow = {
      profileId, date, campaignId, campaignName: str(cell(r, c.name)), adType: AD_TYPE_CODE(str(cell(r, c.prop))),
      keyword: /^na$/i.test(kw) ? '' : kw.toLowerCase(),
      matchType: str(cell(r, c.match)).replace(/^KEYWORD_MATCH_TYPE_/, '').toLowerCase(),
      productName: /^na$/i.test(product) ? '' : product.toLowerCase(),
      city: imCity(cell(r, c.city)),
    };
    const key = [row.date, row.campaignId, row.adType, row.keyword, row.matchType, row.productName, row.city].join('\u0001');
    const t = by.get(key) ?? row;
    const impr = num(cell(r, c.impr));
    const rank = num(cell(r, c.rank));
    add(t, 'impressions', impr);
    add(t, 'clicks', num(cell(r, c.clicks)));
    add(t, 'a2c', num(cell(r, c.a2c)));
    add(t, 'conversions', num(cell(r, c.conv)));
    add(t, 'gmv', num(cell(r, c.gmv)));
    add(t, 'directGmv7', num(cell(r, c.d7)));
    add(t, 'directGmv14', num(cell(r, c.d14)));
    add(t, 'spend', num(cell(r, c.spend)));
    add(t, 'brandedClicks', num(cell(r, c.branded)));
    if (rank > 0) { add(t, 'rankWeighted', rank * impr); add(t, 'rankImpr', impr); }
    by.set(key, t);
  }
  const records = [...by.values()];
  const dates = [...new Set(records.map((r) => r.date))].sort();
  const warnings = bad ? [`${bad} row(s) without a valid METRICS_DATE / CAMPAIGN_ID skipped.`] : [];
  return { records, dates, warnings };
}

// ── SKU mapper (multi-block) ──────────────────────────────────────────

type MapRow = typeof imSkuMap.$inferInsert;

/**
 * The mapper sheet holds several side-by-side blocks. Every block with a SKU
 * column is read: an "Item Code" block gives item → SKU / Category; any block
 * with a "Product Name" gives name → SKU (product names as the ads report
 * writes them, and campaign names). First occurrence wins; categories missing
 * on name rows are taken from the SKU's category in the Item Code block.
 */
export function parseSkuMapper(s: Sheet, profileId: string) {
  // blocks = runs of adjacent non-empty header cells
  const blocks: Array<{ item: number; name: number; sku: number; cat: number; price: number }> = [];
  let start = -1;
  const H = [...s.headers, ''];
  for (let i = 0; i < H.length; i++) {
    if (H[i] && start < 0) start = i;
    if (!H[i] && start >= 0) {
      const span = H.slice(start, i);
      const at = (...n: string[]) => { const j = span.findIndex((x) => n.includes(x!)); return j < 0 ? -1 : start + j; };
      const sku = at('sku');
      if (sku >= 0) blocks.push({ item: at('item code', 'item id'), name: at('product name', 'campaign name', 'name'), sku, cat: at('category'), price: at('price', 'mrp', 'units') });
      start = -1;
    }
  }
  const byKey = new Map<string, MapRow>();
  const skuCat = new Map<string, string>();
  let conflicts = 0;
  const put = (key: string, r: MapRow) => {
    const prev = byKey.get(key);
    if (!prev) byKey.set(key, r);
    else if (normKey(prev.sku) !== normKey(r.sku)) conflicts++;
  };
  // item blocks first so their categories are known
  const ordered = [...blocks].sort((a, b) => Number(b.item >= 0) - Number(a.item >= 0));
  for (const b of ordered) {
    for (const r of s.rows) {
      const sku = str(cell(r, b.sku));
      const name = str(cell(r, b.name));
      if (!sku || normKey(sku) === 'sku' || normKey(name) === 'product name') continue;
      const cat = str(cell(r, b.cat));
      const price = b.price >= 0 ? num(cell(r, b.price)) || null : null;
      if (b.item >= 0) {
        const code = str(cell(r, b.item)).replace(/\.0+$/, '');
        if (code && /^\d+$/.test(code)) {
          put(`item:${code}`, { profileId, key: `item:${code}`, productName: name, sku, category: cat || sku, price });
          if (cat && !skuCat.has(normKey(sku))) skuCat.set(normKey(sku), cat);
        }
      }
      if (name) put(`name:${normKey(name)}`, { profileId, key: `name:${normKey(name)}`, productName: name, sku, category: cat, price });
    }
  }
  const records = [...byKey.values()].map((r) => ({ ...r, category: r.category || skuCat.get(normKey(r.sku ?? '')) || r.sku || '' }));
  const warnings: string[] = [];
  if (!blocks.length) warnings.push('No column headed "SKU" — nothing mapped.');
  if (conflicts) warnings.push(`${conflicts} repeated name / item code(s) with a different SKU — the first one in the sheet was kept.`);
  return { records, warnings, items: records.filter((r) => r.key.startsWith('item:')).length };
}

// ── Store ─────────────────────────────────────────────────────────────

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

export async function storeSales(profileId: string, dates: string[], rows: SalesRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(imSales).where(and(eq(imSales.profileId, profileId), inArray(imSales.date, dates)));
    await chunked(rows, 1000, (part) => tx.insert(imSales).values(part));
  });
  return rows.length;
}

export async function storeAds(profileId: string, dates: string[], rows: AdRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(imAds).where(and(eq(imAds.profileId, profileId), inArray(imAds.date, dates)));
    await chunked(rows, 1000, (part) => tx.insert(imAds).values(part));
  });
  return rows.length;
}

export async function storeSkuMap(profileId: string, rows: MapRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(imSkuMap).where(eq(imSkuMap.profileId, profileId));
    await chunked(rows, 1000, (part) => tx.insert(imSkuMap).values(part));
  });
  return rows.length;
}

// ── One file ──────────────────────────────────────────────────────────

export async function ingestInstamartFile(profileId: string, filename: string, raw: Buffer): Promise<ImFileResult[]> {
  let sheets: Sheet[];
  try {
    sheets = readInstamartWorkbook(toUtf8Csv(raw), filename);
  } catch (err) {
    return [{ filename, status: 'error', message: `Could not read file: ${(err as Error).message}` }];
  }
  const results: ImFileResult[] = [];
  for (const s of sheets) {
    const type = detectInstamart(s);
    const base = { filename, sheet: s.sheetName, reportType: type, rowsRead: s.rows.length };
    try {
      if (type === 'unknown') {
        results.push({ ...base, status: 'skipped', message: `Sheet "${s.sheetName}" is not a recognised Instamart report (columns did not match).` });
        continue;
      }
      let stored = 0;
      let dates: string[] = [];
      let warnings: string[] = [];
      if (type === 'im_sales') {
        const p = parseSales(s, profileId);
        ({ dates, warnings } = p);
        if (p.records.length) stored = await storeSales(profileId, p.dates, p.records);
      } else if (type === 'im_ads') {
        const p = parseAds(s, profileId);
        ({ dates, warnings } = p);
        if (p.records.length) stored = await storeAds(profileId, p.dates, p.records);
      } else {
        const p = parseSkuMapper(s, profileId);
        warnings = p.warnings;
        if (p.records.length) stored = await storeSkuMap(profileId, p.records);
      }
      results.push({
        ...base,
        status: stored ? 'stored' : 'skipped',
        rowsStored: stored,
        ...(dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : {}),
        ...(stored ? {} : { message: `${IM_REPORT_LABEL[type]}: nothing stored.` }),
        ...(warnings.length ? { warnings } : {}),
      });
    } catch (err) {
      results.push({ ...base, status: 'error', message: (err as Error).message });
    }
  }
  if (results.some((r) => r.status === 'stored')) invalidateImDims(profileId);
  return results;
}
