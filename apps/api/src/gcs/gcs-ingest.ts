/**
 * GCS warehouse ingest: upload report files to the correct bucket path.
 *
 * Object name pattern:
 *   <brand>/<marketplace>/<report folder>/<filename>
 *   e.g. eatopia/amazon/seller_central/BR_2026-10-01.csv
 *        eatopia/blinkit/total_sales/eatopia_total_sales_20261001_20261027.csv
 *
 * After uploading, callers can trigger a GCS sync so the data appears in the
 * dashboard immediately.
 */



import type { ReportType as FineReportType } from '@dash/shared';

import { env } from '../config/env';
import { detectReportType } from '../ingestion/detect-report';
import { detectInstamart } from '../instamart/ingest';
import { normKey } from '@dash/shared/blinkit';
import { readWorkbook } from '../ingestion/sheet-reader';
import { GcsClient, READ_WRITE_SCOPE } from './gcs-client';

// ── Report type registry ──────────────────────────────────────────────────────

export interface ReportType {
  id: string;
  label: string;
  /** Sub-folder under <brand>/<marketplace>/  */
  folder: string;
  marketplace: 'amazon' | 'blinkit' | 'swiggy_instamart' | 'zepto';
  hint?: string;
}

export const AMAZON_REPORT_TYPES: readonly ReportType[] = [
  {
    id: 'seller_central',
    label: 'Business Report (Seller Central)',
    folder: 'seller_central',
    marketplace: 'amazon',
    hint: 'Daily sales by ASIN from the Seller Central Business Report',
  },
  {
    id: 'campaign',
    label: 'Ads Campaign (SP / SB / SD)',
    folder: 'campaign',
    marketplace: 'amazon',
    hint: 'Daily or hourly campaign-level ad metrics',
  },
  {
    id: 'advertised',
    label: 'Advertised Product / SB Attributed Purchases',
    folder: 'advertised',
    marketplace: 'amazon',
    hint: 'SP & SD Advertised Product reports; SB Attributed Purchases',
  },
  {
    id: 'str',
    label: 'Search Terms (SP / SB / SD)',
    folder: 'str',
    marketplace: 'amazon',
    hint: 'Customer search term and targeting reports',
  },
  {
    id: 'placement',
    label: 'Placements (SP / SB)',
    folder: 'placement',
    marketplace: 'amazon',
    hint: 'Top-of-search, rest-of-search, PDP placement metrics',
  },
  {
    id: 'asin_mapper',
    label: 'ASIN Mapper',
    folder: 'asin_mapper',
    marketplace: 'amazon',
    hint: 'Maps ASIN → Category, Brand, Selling Price, Title',
  },
  {
    id: 'campaign_mapper',
    label: 'Campaign Mapper',
    folder: 'campaign_mapper',
    marketplace: 'amazon',
    hint: 'Maps Campaign Name → Category, Type, Targeting, Branded flag',
  },
  {
    id: 'sqp',
    label: 'Search Query Performance',
    folder: 'sqp',
    marketplace: 'amazon',
    hint: 'Brand analytics search query performance report',
  },
  {
    id: 'pi_sales',
    label: 'Amazon Pi — Sales by City',
    folder: 'pi_sales',
    marketplace: 'amazon',
    hint: 'ASIN × day × city sales + indexed glance views (becomes the sole sales source)',
  },
  {
    id: 'search_rank',
    label: 'Amazon Pi — Search Rank',
    folder: 'search_rank',
    marketplace: 'amazon',
    hint: 'Monthly organic search rank per ASIN',
  },
  {
    id: 'gv',
    label: 'Amazon Pi — Glance Views (ASIN)',
    folder: 'gv',
    marketplace: 'amazon',
    hint: 'Daily indexed glance views per ASIN',
  },
  {
    id: 'keyword_sov',
    label: 'Amazon Pi — Keyword SOV',
    folder: 'keyword_sov',
    marketplace: 'amazon',
    hint: 'Keyword share of voice / CTR / CPC / ACoS (7 / 15 / 30 day)',
  },
];

export const BLINKIT_REPORT_TYPES: readonly ReportType[] = [
  {
    id: 'total_sales',
    label: 'Sales (Total Sales)',
    folder: 'total_sales',
    marketplace: 'blinkit',
    hint: 'Order-level sales export (Sales Summary)',
  },
  {
    id: 'product_listing',
    label: 'Ads — Product Listing (PL)',
    folder: 'ads_sales/product_listing',
    marketplace: 'blinkit',
    hint: 'Keyword-targeted ad campaign daily report',
  },
  {
    id: 'product_recommendation',
    label: 'Ads — Product Recommendation (PR)',
    folder: 'ads_sales/product_recommendation',
    marketplace: 'blinkit',
    hint: 'Product recommendation ad campaign daily report',
  },
  {
    id: 'banner_listing',
    label: 'Ads — Banner Listing (BL)',
    folder: 'ads_sales/banner_listing',
    marketplace: 'blinkit',
    hint: 'Banner listing ad campaign daily report',
  },
  {
    id: 'inventory',
    label: 'Inventory (Stock on Hand)',
    folder: 'inventory',
    marketplace: 'blinkit',
    hint: 'Daily SOH dump — InventoryData file from Blinkit portal',
  },
  {
    id: 'sku_mapper',
    label: 'SKU Mapper',
    folder: 'sku_mapper',
    marketplace: 'blinkit',
    hint: 'Maps Blinkit Item ID → SKU, Category, Price',
  },
  {
    id: 'campaign_mapper',
    label: 'Campaign Mapper',
    folder: 'campaign_mapper',
    marketplace: 'blinkit',
    hint: 'Maps Campaign Name/ID → Category, SKU, City',
  },
];

export const SWIGGY_INSTAMART_REPORT_TYPES: readonly ReportType[] = [
  {
    id: 'sales',
    label: 'Sales',
    folder: 'sales',
    marketplace: 'swiggy_instamart',
    hint: 'Instamart sales export (ORDERED_DATE, CITY, STORE_ID, ITEM_CODE, UNITS_SOLD, GMV)',
  },
  {
    id: 'ads',
    label: 'Ads',
    folder: 'ads',
    marketplace: 'swiggy_instamart',
    hint: 'Instamart ads export (METRICS_DATE, CAMPAIGN_ID, AD_PROPERTY, KEYWORD, CITY, TOTAL_BUDGET_BURNT …)',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    folder: 'inventory',
    marketplace: 'swiggy_instamart',
    hint: 'Daily stock-on-hand export — not read yet (no sample so far); files are kept in the bucket',
  },
  {
    id: 'sku_mapper',
    label: 'SKU Mapper',
    folder: 'sku_mapper',
    marketplace: 'swiggy_instamart',
    hint: 'Item Code → SKU / Category, plus product and campaign names → SKU',
  },
];

export const ZEPTO_REPORT_TYPES: readonly ReportType[] = [
  {
    id: 'sales',
    label: 'Sales',
    folder: 'sales',
    marketplace: 'zepto',
    hint: 'Order-level sales export from Zepto portal',
  },
  {
    id: 'ads',
    label: 'Ads',
    folder: 'ads',
    marketplace: 'zepto',
    hint: 'Campaign-level ad metrics from Zepto',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    folder: 'inventory',
    marketplace: 'zepto',
    hint: 'Daily stock-on-hand export from Zepto',
  },
  {
    id: 'sku_mapper',
    label: 'SKU Mapper',
    folder: 'sku_mapper',
    marketplace: 'zepto',
    hint: 'Maps Zepto Item ID → SKU, Category, Price',
  },
];

export const ALL_REPORT_TYPES: readonly ReportType[] = [
  ...AMAZON_REPORT_TYPES,
  ...BLINKIT_REPORT_TYPES,
  ...SWIGGY_INSTAMART_REPORT_TYPES,
  ...ZEPTO_REPORT_TYPES,
];

export function reportTypesForMarketplace(marketplace: 'amazon' | 'blinkit' | 'swiggy_instamart' | 'zepto'): readonly ReportType[] {
  if (marketplace === 'blinkit')          return BLINKIT_REPORT_TYPES;
  if (marketplace === 'swiggy_instamart') return SWIGGY_INSTAMART_REPORT_TYPES;
  if (marketplace === 'zepto')            return ZEPTO_REPORT_TYPES;
  return AMAZON_REPORT_TYPES;
}

export function findReportType(marketplace: 'amazon' | 'blinkit' | 'swiggy_instamart' | 'zepto', id: string): ReportType | undefined {
  return reportTypesForMarketplace(marketplace).find((r) => r.id === id);
}

// ── Auto-detection (bulk ingest) ──────────────────────────────────────────────

/**
 * Maps the pipeline's fine-grained report type (e.g. `sp_campaign`) to the
 * coarse GCS warehouse folder it belongs in (e.g. `campaign`).
 *
 * Sync re-detects the exact report from the file's own columns, so the folder
 * is organisational — but keeping it correct preserves the filename fallback
 * and a tidy bucket. Types with no warehouse folder (vendor_central,
 * order_report) are intentionally absent: they fall through to manual pick.
 */
const FINE_TO_COARSE: Partial<Record<FineReportType, string>> = {
  business_report: 'seller_central',
  sp_campaign: 'campaign',
  sb_campaign: 'campaign',
  sd_campaign: 'campaign',
  hourly: 'campaign',
  sp_advertised_product: 'advertised',
  sd_advertised_product: 'advertised',
  sb_advertised_product: 'advertised',
  sb_attributed_purchase: 'advertised',
  sp_search_term: 'str',
  sb_search_term: 'str',
  sd_targeting: 'str',
  sp_placement: 'placement',
  sb_placement: 'placement',
  asin_mapper: 'asin_mapper',
  campaign_mapper: 'campaign_mapper',
  search_query_performance: 'sqp',
  pi_city_sales: 'pi_sales',
  search_rank: 'search_rank',
  asin_gv: 'gv',
  keyword_sov: 'keyword_sov',
};

export interface DetectResult {
  filename: string;
  /** Coarse warehouse report type id (e.g. "campaign"), or null when unrecognised / unmapped. */
  reportType: string | null;
  /** The pipeline's fine-grained guess, for display ("SP Campaign"). */
  fineType: FineReportType | null;
  /** How the guess was made — column headers beat filename. */
  detectedBy: 'headers' | 'filename' | null;
  /** Set when the file is a recognised report with no warehouse folder yet. */
  note?: string;
  /** Marketplace the columns belong to (absent = Amazon). */
  marketplace?: 'amazon' | 'swiggy_instamart';
}

/** Swiggy Instamart exports are recognised by their own columns (sales / ads / SKU mapper). */
const IM_FOLDER: Record<string, string> = { im_sales: 'sales', im_ads: 'ads', im_sku_mapper: 'sku_mapper' };

/**
 * Inspect a file's columns and decide which warehouse report type it is.
 * Reads only the first rows (header detection) — never the whole export.
 */
export function detectIngestType(buffer: Buffer, filename: string): DetectResult {
  let sheets;
  try {
    sheets = readWorkbook(buffer, { maxRows: 25 });
  } catch {
    return { filename, reportType: null, fineType: null, detectedBy: null };
  }

  // Try each sheet; the first that classifies wins (combined workbooks name
  // their tabs, so sheetName feeds the fallback).
  for (const sheet of sheets) {
    const im = detectInstamart({ fileName: filename, sheetName: sheet.sheetName, headers: sheet.headers.map((h) => normKey(h)), rows: [] });
    if (im !== 'unknown')
      return { filename, reportType: IM_FOLDER[im] ?? null, fineType: null, detectedBy: 'headers', marketplace: 'swiggy_instamart' };
    const hit = detectReportType(sheet.headers, sheet.sheetName, filename);
    if (!hit) continue;
    const coarse = FINE_TO_COARSE[hit.reportType];
    if (coarse) {
      return { filename, reportType: coarse, fineType: hit.reportType, detectedBy: hit.detectedBy };
    }
    // Recognised but no warehouse folder (vendor_central, order_report, …).
    return {
      filename,
      reportType: null,
      fineType: hit.reportType,
      detectedBy: hit.detectedBy,
      note: `Recognised as "${hit.reportType}" but it has no warehouse folder yet — pick a type manually.`,
    };
  }
  return { filename, reportType: null, fineType: null, detectedBy: null };
}

// ── Content-type helper ───────────────────────────────────────────────────────

export function mimeForFilename(filename: string): string {
  const ext = filename.includes('.') ? '.' + filename.split('.').pop()!.toLowerCase() : '';
  if (ext === '.csv') return 'text/csv';
  if (ext === '.xlsx') return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  if (ext === '.xls') return 'application/vnd.ms-excel';
  return 'application/octet-stream';
}


// ── Filename normalisation ────────────────────────────────────────────────────

/**
 * Build the canonical GCS filename:
 *   <brand>_<reportTypeId>_<YYYYMMDD>_<YYYYMMDD><suffix>.<ext>
 *
 * `suffix` is used when multiple files share the same date range (e.g. "_2").
 */
export function buildFilename(
  brand: string,
  reportTypeId: string,
  startDate: string,
  endDate: string,
  originalName: string,
  suffix = ''
): string {
  const start = startDate.replace(/-/g, '');  // "2026-06-01" → "20260601"
  const end   = endDate.replace(/-/g, '');
  const ext   = originalName.includes('.')
    ? '.' + originalName.split('.').pop()!.toLowerCase()
    : '.csv';
  return `${brand}_${reportTypeId}_${start}_${end}${suffix}${ext}`;
}

/** YYYY-MM-DD validation — rejects obviously invalid dates. */
export function isValidDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s);
  return !isNaN(d.getTime());
}

// ── Upload service ────────────────────────────────────────────────────────────

export interface IngestFileResult {
  filename: string;
  objectName: string;
  size: number;
  status: 'uploaded' | 'error';
  message?: string;
}

/** Build the GCS object name for a file: `<brand>/<marketplace>/<folder>/<filename>` */
export function objectName(brand: string, reportType: ReportType, filename: string): string {
  return `${brand}/${reportType.marketplace}/${reportType.folder}/${filename}`;
}

/** Upload an array of in-memory files to the warehouse bucket. */
export async function uploadFilesToGcs(
  brand: string,
  reportType: ReportType,
  files: Array<{ name: string; buffer: Buffer }>
): Promise<IngestFileResult[]> {
  const credFile = env.gcsCredentialsFile ?? null;
  const bucket = env.GCS_BUCKET;

  // Build a write-capable client. On Cloud Run the metadata-server token
  // already covers Storage Object Creator if the service account has that role.
  const client =
    credFile !== null
      ? GcsClient.fromKeyFile(bucket, credFile, READ_WRITE_SCOPE)
      : GcsClient.fromMetadataServer(bucket);

  const results: IngestFileResult[] = [];
  for (const file of files) {
    const name = objectName(brand, reportType, file.name);
    try {
      const uploaded = await client.upload(name, file.buffer, mimeForFilename(file.name));
      results.push({ filename: file.name, objectName: name, size: uploaded.size, status: 'uploaded' });
    } catch (err) {
      results.push({
        filename: file.name,
        objectName: name,
        size: file.buffer.length,
        status: 'error',
        message: (err as Error).message,
      });
    }
  }
  return results;
}


// ── Bulk upload (mixed report types, one call) ────────────────────────────────

export interface BulkIngestItem {
  original: string;
  buffer: Buffer;
  marketplace: 'amazon' | 'blinkit' | 'swiggy_instamart' | 'zepto';
  reportTypeId: string;
}

/**
 * Upload a batch of files whose report types differ — the daily workflow where
 * someone drops all ~14 advertising exports at once. Each file is renamed to
 * the canonical format and routed to its own folder; files sharing a report
 * type + date range get "_2", "_3" … suffixes so none collide.
 *
 * Returns per-file results plus the distinct marketplaces touched (so the
 * caller can trigger one sync per marketplace).
 */
export async function uploadBulkToGcs(
  brand: string,
  startDate: string,
  endDate: string,
  items: BulkIngestItem[]
): Promise<{ results: IngestFileResult[]; marketplaces: Array<'amazon' | 'blinkit' | 'swiggy_instamart' | 'zepto'> }> {
  const credFile = env.gcsCredentialsFile ?? null;
  const bucket = env.GCS_BUCKET;
  const client =
    credFile !== null
      ? GcsClient.fromKeyFile(bucket, credFile, READ_WRITE_SCOPE)
      : GcsClient.fromMetadataServer(bucket);

  // Count per (reportType) so we can add a suffix only when a type repeats.
  const typeCounts = new Map<string, number>();
  for (const it of items) typeCounts.set(it.reportTypeId, (typeCounts.get(it.reportTypeId) ?? 0) + 1);
  const typeSeen = new Map<string, number>();

  const results: IngestFileResult[] = [];
  const marketplaces = new Set<'amazon' | 'blinkit' | 'swiggy_instamart' | 'zepto'>();

  for (const it of items) {
    const reportType = findReportType(it.marketplace, it.reportTypeId);
    if (!reportType) {
      results.push({
        filename: it.original,
        objectName: it.original,
        size: it.buffer.length,
        status: 'error',
        message: `Unknown report type "${it.reportTypeId}" for marketplace "${it.marketplace}".`,
      });
      continue;
    }
    const seen = (typeSeen.get(it.reportTypeId) ?? 0) + 1;
    typeSeen.set(it.reportTypeId, seen);
    const suffix = (typeCounts.get(it.reportTypeId) ?? 1) > 1 ? `_${seen}` : '';
    const filename = buildFilename(brand, it.reportTypeId, startDate, endDate, it.original, suffix);
    const name = objectName(brand, reportType, filename);
    try {
      const uploaded = await client.upload(name, it.buffer, mimeForFilename(filename));
      results.push({ filename, objectName: name, size: uploaded.size, status: 'uploaded' });
      marketplaces.add(it.marketplace);
    } catch (err) {
      results.push({
        filename,
        objectName: name,
        size: it.buffer.length,
        status: 'error',
        message: (err as Error).message,
      });
    }
  }
  return { results, marketplaces: [...marketplaces] };
}
