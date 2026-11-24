import { normKey } from '@dash/shared/blinkit';
import { ZP_REPORT_LABEL, type ZpChannel, type ZpReportType } from '@dash/shared/zepto';
import { and, eq, inArray } from 'drizzle-orm';

import { fileDateRange, inferDateOrder, num, str, toISODate } from '../blinkit/ingestion/clean';
import { db, type Tx } from '../db/client';
import { toUtf8Csv } from '../gcs/warehouse';
import { invalidateZpDims } from './reports/dims';
import { readZeptoWorkbook, type Sheet } from './sheet-reader';
import {
  zpAdCampaign,
  zpAdKeyword,
  zpAdProduct,
  zpCampaignMap,
  zpInventory,
  zpSales,
  zpSkuMap,
} from './schema';

/* Zepto ingestion: one file → each sheet detected by its COLUMNS → parsed →
   stored. Sales / inventory are dated (replace-by-date / -snapshot); the ad
   reports carry no date, so they are stored against the export window per
   channel (replace-by-period). Used by the GCS sync (`<brand>/zepto/…`).

   Channel (SP/SB/SD) is not a column — it comes from the file / report-type
   name, with the campaign report's CampaignType as a fallback. */

export interface ZpIngestOpts {
  /** Export window for dateless ad / inventory reports (GCS filename range, else the upload range). */
  from?: string;
  to?: string;
  /** Explicit channel for an ad report when the file name doesn't carry one. */
  channel?: ZpChannel;
}

export interface ZpFileResult {
  filename: string;
  sheet?: string;
  status: 'stored' | 'skipped' | 'error';
  reportType?: ZpReportType;
  channel?: ZpChannel;
  from?: string;
  to?: string;
  rowsRead?: number;
  rowsStored?: number;
  message?: string;
  warnings?: string[];
}

// ── Detection (column-based; returns the KIND — channel is resolved separately) ──

export function detectZepto(s: Sheet): ZpReportType {
  const h = new Set(s.headers);
  const has = (...c: string[]) => c.every((x) => h.has(x));
  const any = (...c: string[]) => c.some((x) => h.has(x));

  if (has('sales date', 'sku id') && any('gmv', 'quantity')) return 'zp_sales';
  if (has('sku code', 'units') && h.has('sku sub category')) return 'zp_inventory';
  if (h.has('pvid sku id')) return 'zp_sku_mapper';
  if (h.has('keywordname')) return 'zp_keyword';
  if (has('productid', 'productname')) return 'zp_product';
  if (has('campaignname', 'campaigntype')) return 'zp_campaign';
  if (has('campaign name', 'category') && !any('impressions', 'productid', 'keywordname'))
    return 'zp_campaign_mapper';
  return 'unknown';
}

// ── Channel resolution ───────────────────────────────────────────────

function channelFromName(fileName: string, sheetName: string): ZpChannel | null {
  const n = ` ${normKey(`${fileName} ${sheetName}`)} `;
  if (/ sd /.test(n) || /sponsored display/.test(n) || / pda /.test(n)) return 'sd';
  if (/ sb /.test(n) || /sponsored brand/.test(n)) return 'sb';
  if (/ sp /.test(n) || /sponsored product/.test(n)) return 'sp';
  return null;
}

function channelFromCampaignType(ct: string): ZpChannel | null {
  const k = normKey(ct);
  if (!k) return null;
  if (k.includes('banner') || k.includes('display')) return 'sd';
  if (k === 'pca' || k.includes('brand')) return 'sb';
  if (k.includes('auction') || k.includes('auto') || k.includes('product') || k.includes('up sell'))
    return 'sp';
  return null;
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
const cityOf = (v: unknown) => str(v).replace(/\s+/g, ' ') || 'Unknown';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ── Sales ────────────────────────────────────────────────────────────

type SalesRow = typeof zpSales.$inferInsert;

export function parseSales(s: Sheet, profileId: string) {
  const c = {
    date: colOf(s, 'sales date'),
    sku: colOf(s, 'sku id'),
    name: colOf(s, 'sku name'),
    city: colOf(s, 'city'),
    brand: colOf(s, 'brand name'),
    mfgId: colOf(s, 'manufacturer id'),
    mfgName: colOf(s, 'manufacturer name'),
    cat: colOf(s, 'sku category'),
    qty: colOf(s, 'quantity'),
    gmv: colOf(s, 'gmv'),
  };
  const order = inferDateOrder(
    s.rows.map((r) => cell(r, c.date)),
    s.fileName
  );
  const by = new Map<string, SalesRow>();
  let bad = 0;
  for (const r of s.rows) {
    const date = toISODate(cell(r, c.date), order);
    const skuId = str(cell(r, c.sku));
    if (!date || !skuId) {
      bad++;
      continue;
    }
    const city = cityOf(cell(r, c.city));
    const key = `${date}\u0001${city}\u0001${skuId}`;
    let row = by.get(key);
    if (!row) {
      row = {
        profileId,
        date,
        city,
        skuId,
        skuName: str(cell(r, c.name)),
        brand: str(cell(r, c.brand)),
        manufacturerId: str(cell(r, c.mfgId)),
        manufacturerName: str(cell(r, c.mfgName)),
        reportCategory: str(cell(r, c.cat)),
        units: 0,
        gmv: 0,
      };
      by.set(key, row);
    }
    row.units = (row.units ?? 0) + num(cell(r, c.qty));
    row.gmv = (row.gmv ?? 0) + num(cell(r, c.gmv));
  }
  const records = [...by.values()];
  const dates = [...new Set(records.map((r) => r.date))].sort();
  const warnings = bad ? [`${bad} row(s) without a valid Sales Date / SKU ID skipped.`] : [];
  return { records, dates, warnings };
}

// ── Inventory ────────────────────────────────────────────────────────

type InvRow = typeof zpInventory.$inferInsert;

export function parseInventory(s: Sheet, profileId: string, snapshot: string) {
  const c = {
    city: colOf(s, 'city'),
    code: colOf(s, 'sku code'),
    ean: colOf(s, 'ean'),
    name: colOf(s, 'sku name'),
    cat: colOf(s, 'sku category'),
    sub: colOf(s, 'sku sub category'),
    brand: colOf(s, 'brand name'),
    mfgName: colOf(s, 'manufacturer name'),
    mfgId: colOf(s, 'manufacturer id'),
    units: colOf(s, 'units'),
  };
  const by = new Map<string, InvRow>();
  let bad = 0;
  for (const r of s.rows) {
    const skuCode = str(cell(r, c.code));
    const city = cityOf(cell(r, c.city));
    if (!skuCode) {
      bad++;
      continue;
    }
    const key = `${city}\u0001${skuCode}`;
    let row = by.get(key);
    if (!row) {
      row = {
        profileId,
        snapshotDate: snapshot,
        city,
        skuCode,
        ean: str(cell(r, c.ean)),
        skuName: str(cell(r, c.name)),
        reportCategory: str(cell(r, c.cat)),
        subCategory: str(cell(r, c.sub)),
        brand: str(cell(r, c.brand)),
        manufacturerName: str(cell(r, c.mfgName)),
        manufacturerId: str(cell(r, c.mfgId)),
        units: 0,
      };
      by.set(key, row);
    }
    row.units = (row.units ?? 0) + num(cell(r, c.units));
  }
  const records = [...by.values()];
  const warnings = bad ? [`${bad} inventory row(s) without a SKU Code skipped.`] : [];
  return { records, warnings };
}

// ── Ad reports (campaign / keyword / product) ────────────────────────

const adCols = (s: Sheet) => ({
  spend: colOf(s, 'spend'),
  asales: colOf(s, 'revenue'),
  aunits: colOf(s, 'orders'),
  atc: colOf(s, 'atc'),
  clicks: colOf(s, 'clicks'),
  impr: colOf(s, 'impressions'),
  same: colOf(s, 'same skus'),
  other: colOf(s, 'other skus'),
});
const adMetrics = (r: unknown[], c: ReturnType<typeof adCols>) => ({
  spend: num(cell(r, c.spend)),
  asales: num(cell(r, c.asales)),
  aunits: num(cell(r, c.aunits)),
  atc: num(cell(r, c.atc)),
  clicks: num(cell(r, c.clicks)),
  impressions: num(cell(r, c.impr)),
  sameSkus: num(cell(r, c.same)),
  otherSkus: num(cell(r, c.other)),
});

type CampRow = typeof zpAdCampaign.$inferInsert;
type KwRow = typeof zpAdKeyword.$inferInsert;
type ProdRow = typeof zpAdProduct.$inferInsert;

export function parseCampaign(
  s: Sheet,
  profileId: string,
  channel: ZpChannel,
  from: string,
  to: string
): { records: CampRow[]; warnings: string[] } {
  const a = adCols(s);
  const c = {
    name: colOf(s, 'campaignname'),
    type: colOf(s, 'campaigntype'),
    status: colOf(s, 'status'),
    brandId: colOf(s, 'brandid'),
    brandName: colOf(s, 'brandname'),
    budget: colOf(s, 'daily budget'),
    reach: colOf(s, 'unique reach'),
    cons: colOf(s, 'unique considerations'),
  };
  const by = new Map<string, CampRow>();
  let bad = 0;
  for (const r of s.rows) {
    const campaignName = str(cell(r, c.name));
    if (!campaignName) {
      bad++;
      continue;
    }
    by.set(campaignName, {
      profileId,
      periodFrom: from,
      periodTo: to,
      channel,
      campaignName,
      campaignType: str(cell(r, c.type)),
      status: str(cell(r, c.status)),
      brandId: str(cell(r, c.brandId)),
      brandName: str(cell(r, c.brandName)),
      dailyBudget: num(cell(r, c.budget)),
      uniqueReach: num(cell(r, c.reach)),
      uniqueConsiderations: num(cell(r, c.cons)),
      ...adMetrics(r, a),
    });
  }
  const warnings = bad ? [`${bad} campaign row(s) without a CampaignName skipped.`] : [];
  return { records: [...by.values()], warnings };
}

export function parseKeyword(
  s: Sheet,
  profileId: string,
  channel: ZpChannel,
  from: string,
  to: string
): { records: KwRow[]; warnings: string[] } {
  const a = adCols(s);
  const c = {
    kw: colOf(s, 'keywordname'),
    match: colOf(s, 'keywordmatchtype'),
    cid: colOf(s, 'campaign id'),
    cname: colOf(s, 'campaign name'),
  };
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
    by.set(`${campaignId}\u0001${keyword}\u0001${matchType}`, {
      profileId,
      periodFrom: from,
      periodTo: to,
      channel,
      keyword,
      matchType,
      campaignId,
      campaignName: str(cell(r, c.cname)),
      ...adMetrics(r, a),
    });
  }
  const warnings = bad ? [`${bad} keyword row(s) without a KeywordName skipped.`] : [];
  return { records: [...by.values()], warnings };
}

export function parseProduct(
  s: Sheet,
  profileId: string,
  channel: ZpChannel,
  from: string,
  to: string
): { records: ProdRow[]; warnings: string[] } {
  const a = adCols(s);
  const c = {
    pid: colOf(s, 'productid'),
    pname: colOf(s, 'productname'),
    cat: colOf(s, 'category'),
    cid: colOf(s, 'campaign id'),
    cname: colOf(s, 'campaign name'),
  };
  const by = new Map<string, ProdRow>();
  let bad = 0;
  for (const r of s.rows) {
    const productId = str(cell(r, c.pid));
    const campaignId = str(cell(r, c.cid));
    if (!productId) {
      bad++;
      continue;
    }
    by.set(`${campaignId}\u0001${productId}`, {
      profileId,
      periodFrom: from,
      periodTo: to,
      channel,
      productId,
      productName: str(cell(r, c.pname)),
      reportCategory: str(cell(r, c.cat)),
      campaignId,
      campaignName: str(cell(r, c.cname)),
      ...adMetrics(r, a),
    });
  }
  const warnings = bad ? [`${bad} product row(s) without a ProductID skipped.`] : [];
  return { records: [...by.values()], warnings };
}

// ── Mappers ──────────────────────────────────────────────────────────

type SkuMapRow = typeof zpSkuMap.$inferInsert;
type CampMapRow = typeof zpCampaignMap.$inferInsert;

/** SKU mapper: rows under `▼ CATEGORY` group headers — keep rows whose SKU-ID cell is a UUID. */
export function parseSkuMapper(s: Sheet, profileId: string): { records: SkuMapRow[]; warnings: string[] } {
  const c = {
    sku: colOf(s, 'pvid sku id', 'sku id'),
    name: colOf(s, 'sku name'),
    cat: colOf(s, 'category'),
  };
  const by = new Map<string, SkuMapRow>();
  for (const r of s.rows) {
    const skuId = str(cell(r, c.sku));
    if (!UUID.test(skuId) || by.has(skuId)) continue;
    by.set(skuId, { profileId, skuId, skuName: str(cell(r, c.name)), category: str(cell(r, c.cat)) });
  }
  const warnings = by.size ? [] : ['No SKU-ID rows found in the SKU mapper.'];
  return { records: [...by.values()], warnings };
}

export function parseCampaignMapper(
  s: Sheet,
  profileId: string
): { records: CampMapRow[]; warnings: string[] } {
  const c = { name: colOf(s, 'campaign name'), cat: colOf(s, 'category') };
  const by = new Map<string, CampMapRow>();
  for (const r of s.rows) {
    const campaignName = str(cell(r, c.name));
    const category = str(cell(r, c.cat));
    if (!campaignName || !category || by.has(campaignName)) continue;
    by.set(campaignName, { profileId, campaignName, category });
  }
  const warnings = by.size ? [] : ['No Campaign Name rows found in the campaign mapper.'];
  return { records: [...by.values()], warnings };
}

// ── Store ────────────────────────────────────────────────────────────

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

async function storeSales(profileId: string, dates: string[], rows: SalesRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(zpSales).where(and(eq(zpSales.profileId, profileId), inArray(zpSales.date, dates)));
    await chunked(rows, 1000, (part) => tx.insert(zpSales).values(part));
  });
  return rows.length;
}

async function storeInventory(profileId: string, snapshot: string, rows: InvRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx
      .delete(zpInventory)
      .where(and(eq(zpInventory.profileId, profileId), eq(zpInventory.snapshotDate, snapshot)));
    await chunked(rows, 1000, (part) => tx.insert(zpInventory).values(part));
  });
  return rows.length;
}

async function storeCampaign(profileId: string, channel: ZpChannel, from: string, to: string, rows: CampRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx
      .delete(zpAdCampaign)
      .where(
        and(
          eq(zpAdCampaign.profileId, profileId),
          eq(zpAdCampaign.channel, channel),
          eq(zpAdCampaign.periodFrom, from),
          eq(zpAdCampaign.periodTo, to)
        )
      );
    await chunked(rows, 1000, (part) => tx.insert(zpAdCampaign).values(part));
  });
  return rows.length;
}

async function storeKeyword(profileId: string, channel: ZpChannel, from: string, to: string, rows: KwRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx
      .delete(zpAdKeyword)
      .where(
        and(
          eq(zpAdKeyword.profileId, profileId),
          eq(zpAdKeyword.channel, channel),
          eq(zpAdKeyword.periodFrom, from),
          eq(zpAdKeyword.periodTo, to)
        )
      );
    await chunked(rows, 1000, (part) => tx.insert(zpAdKeyword).values(part));
  });
  return rows.length;
}

async function storeProduct(profileId: string, channel: ZpChannel, from: string, to: string, rows: ProdRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx
      .delete(zpAdProduct)
      .where(
        and(
          eq(zpAdProduct.profileId, profileId),
          eq(zpAdProduct.channel, channel),
          eq(zpAdProduct.periodFrom, from),
          eq(zpAdProduct.periodTo, to)
        )
      );
    await chunked(rows, 1000, (part) => tx.insert(zpAdProduct).values(part));
  });
  return rows.length;
}

async function storeSkuMap(profileId: string, rows: SkuMapRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(zpSkuMap).where(eq(zpSkuMap.profileId, profileId));
    await chunked(rows, 1000, (part) => tx.insert(zpSkuMap).values(part));
  });
  return rows.length;
}

async function storeCampaignMap(profileId: string, rows: CampMapRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(zpCampaignMap).where(eq(zpCampaignMap.profileId, profileId));
    await chunked(rows, 1000, (part) => tx.insert(zpCampaignMap).values(part));
  });
  return rows.length;
}

// ── One file ─────────────────────────────────────────────────────────

const todayISO = () => new Date().toISOString().slice(0, 10);

/** Export window for a dateless report: GCS filename range → opts range → upload day. */
function windowFor(fileName: string, opts: ZpIngestOpts): [string, string] {
  const fromName = fileDateRange(fileName);
  if (fromName) return fromName;
  if (opts.from && opts.to) return [opts.from, opts.to];
  const d = opts.from ?? opts.to ?? todayISO();
  return [d, d];
}

export async function ingestZeptoFile(
  profileId: string,
  filename: string,
  raw: Buffer,
  opts: ZpIngestOpts = {}
): Promise<ZpFileResult[]> {
  let sheets: Sheet[];
  try {
    sheets = readZeptoWorkbook(toUtf8Csv(raw), filename);
  } catch (err) {
    return [{ filename, status: 'error', message: `Could not read file: ${(err as Error).message}` }];
  }
  const results: ZpFileResult[] = [];
  for (const s of sheets) {
    const type = detectZepto(s);
    const base: Omit<ZpFileResult, 'status'> = {
      filename,
      sheet: s.sheetName,
      reportType: type,
      rowsRead: s.rows.length,
    };
    if (type === 'unknown') {
      results.push({ ...base, status: 'skipped', message: `Sheet "${s.sheetName}" is not a recognised Zepto report.` });
      continue;
    }
    try {
      if (type === 'zp_sales') {
        const p = parseSales(s, profileId);
        const stored = p.records.length ? await storeSales(profileId, p.dates, p.records) : 0;
        results.push({
          ...base,
          status: stored ? 'stored' : 'skipped',
          rowsStored: stored,
          ...(p.dates.length ? { from: p.dates[0]!, to: p.dates[p.dates.length - 1]! } : {}),
          ...(p.warnings.length ? { warnings: p.warnings } : {}),
        });
      } else if (type === 'zp_inventory') {
        const [from] = windowFor(filename, opts);
        const snapshot = opts.to ?? from;
        const p = parseInventory(s, profileId, snapshot);
        const stored = p.records.length ? await storeInventory(profileId, snapshot, p.records) : 0;
        results.push({
          ...base,
          status: stored ? 'stored' : 'skipped',
          rowsStored: stored,
          from: snapshot,
          to: snapshot,
          ...(p.warnings.length ? { warnings: p.warnings } : {}),
        });
      } else if (type === 'zp_sku_mapper') {
        const p = parseSkuMapper(s, profileId);
        const stored = p.records.length ? await storeSkuMap(profileId, p.records) : 0;
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.warnings.length ? { warnings: p.warnings } : {}) });
      } else if (type === 'zp_campaign_mapper') {
        const p = parseCampaignMapper(s, profileId);
        const stored = p.records.length ? await storeCampaignMap(profileId, p.records) : 0;
        results.push({ ...base, status: stored ? 'stored' : 'skipped', rowsStored: stored, ...(p.warnings.length ? { warnings: p.warnings } : {}) });
      } else {
        // Ad reports — need a channel and a period.
        const [from, to] = windowFor(filename, opts);
        const warnings: string[] = [];
        let channel = opts.channel ?? channelFromName(filename, s.sheetName);
        if (!channel && type === 'zp_campaign') {
          const ci = colOf(s, 'campaigntype');
          for (const r of s.rows) {
            const ch = channelFromCampaignType(str(cell(r, ci)));
            if (ch) {
              channel = ch;
              break;
            }
          }
        }
        if (!channel) {
          channel = 'sp';
          warnings.push(`Channel (SP/SB/SD) not found in the file name — defaulted to SP. Name the file with its channel or pass it explicitly.`);
        }
        let stored = 0;
        if (type === 'zp_campaign') {
          const p = parseCampaign(s, profileId, channel, from, to);
          warnings.push(...p.warnings);
          stored = p.records.length ? await storeCampaign(profileId, channel, from, to, p.records) : 0;
        } else if (type === 'zp_keyword') {
          const p = parseKeyword(s, profileId, channel, from, to);
          warnings.push(...p.warnings);
          stored = p.records.length ? await storeKeyword(profileId, channel, from, to, p.records) : 0;
        } else {
          const p = parseProduct(s, profileId, channel, from, to);
          warnings.push(...p.warnings);
          stored = p.records.length ? await storeProduct(profileId, channel, from, to, p.records) : 0;
        }
        results.push({
          ...base,
          channel,
          status: stored ? 'stored' : 'skipped',
          rowsStored: stored,
          from,
          to,
          ...(warnings.length ? { warnings } : {}),
        });
      }
    } catch (err) {
      results.push({ ...base, status: 'error', message: (err as Error).message });
    }
  }
  if (results.some((r) => r.status === 'stored')) invalidateZpDims(profileId);
  return results;
}

export { ZP_REPORT_LABEL };
