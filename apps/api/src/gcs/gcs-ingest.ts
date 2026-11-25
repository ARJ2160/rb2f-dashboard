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

import { env } from '../config/env';
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
    id: 'vendor_central',
    label: 'Vendor Central Sales',
    folder: 'vendor_central',
    marketplace: 'amazon',
    hint: 'Vendor Central ordered / shipped revenue & units (stored as source = vendor)',
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
  {
    id: 'sc_ledger',
    label: 'Seller Central — Inventory Ledger',
    folder: 'sc_ledger',
    marketplace: 'amazon',
    hint: 'FBA Inventory Ledger (Summary or Detailed view)',
  },
  {
    id: 'fba_inventory',
    label: 'Seller Central — FBA Inventory',
    folder: 'fba_inventory',
    marketplace: 'amazon',
    hint: 'FBA Inventory snapshot — available, inbound, ageing, sales T7/T30',
  },
  {
    id: 'sc_shipments',
    label: 'Seller Central — Shipments',
    folder: 'sc_shipments',
    marketplace: 'amazon',
    hint: 'FBA shipments list / shipment contents',
  },
  {
    id: 'vc_po',
    label: 'Vendor Central — PO Export',
    folder: 'vc_po',
    marketplace: 'amazon',
    hint: 'Purchase order items export',
  },
  {
    id: 'vc_inventory',
    label: 'Vendor Central — Inventory',
    folder: 'vc_inventory',
    marketplace: 'amazon',
    hint: 'Retail Analytics inventory (Sellable On Hand Units)',
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
    id: 'ads',
    label: 'Ads Data',
    folder: 'ads',
    marketplace: 'blinkit',
    hint: 'Blinkit ads export — Product Listing / Recommendation / Banner (classified from columns on sync)',
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
    label: 'Total Sales',
    folder: 'sales',
    marketplace: 'zepto',
    hint: 'SALES_OVERVIEW — day × city × SKU (GMV, Quantity)',
  },
  {
    id: 'sp_campaign',
    label: 'SP Campaign',
    folder: 'sp_campaign',
    marketplace: 'zepto',
    hint: 'Sponsored Product campaign report',
  },
  {
    id: 'sb_campaign',
    label: 'SB Campaign',
    folder: 'sb_campaign',
    marketplace: 'zepto',
    hint: 'Sponsored Brand campaign report',
  },
  {
    id: 'sd_campaign',
    label: 'SD Campaign',
    folder: 'sd_campaign',
    marketplace: 'zepto',
    hint: 'Sponsored Display campaign report',
  },
  {
    id: 'sp_keyword',
    label: 'SP Keyword',
    folder: 'sp_keyword',
    marketplace: 'zepto',
    hint: 'Sponsored Product keyword report',
  },
  {
    id: 'sb_keyword',
    label: 'SB Keyword',
    folder: 'sb_keyword',
    marketplace: 'zepto',
    hint: 'Sponsored Brand keyword report',
  },
  {
    id: 'sp_product',
    label: 'SP Product',
    folder: 'sp_product',
    marketplace: 'zepto',
    hint: 'Sponsored Product product (SKU) report',
  },
  {
    id: 'sb_product',
    label: 'SB Product',
    folder: 'sb_product',
    marketplace: 'zepto',
    hint: 'Sponsored Brand product (SKU) report',
  },
  {
    id: 'sd_product',
    label: 'SD Product',
    folder: 'sd_product',
    marketplace: 'zepto',
    hint: 'Sponsored Display product (SKU) report',
  },
  {
    id: 'inventory',
    label: 'Inventory',
    folder: 'inventory',
    marketplace: 'zepto',
    hint: 'City × SKU stock snapshot',
  },
  {
    id: 'sku_mapper',
    label: 'SKU Mapper',
    folder: 'sku_mapper',
    marketplace: 'zepto',
    hint: 'Maps SKU ID (PVID) → canonical Category',
  },
  {
    id: 'campaign_mapper',
    label: 'Campaign Mapper',
    folder: 'campaign_mapper',
    marketplace: 'zepto',
    hint: 'Maps Campaign Name → Category',
  },
];

export const ALL_REPORT_TYPES: readonly ReportType[] = [
  ...AMAZON_REPORT_TYPES,
  ...BLINKIT_REPORT_TYPES,
  ...SWIGGY_INSTAMART_REPORT_TYPES,
  ...ZEPTO_REPORT_TYPES,
];

export function reportTypesForMarketplace(
  marketplace: 'amazon' | 'blinkit' | 'swiggy_instamart' | 'zepto'
): readonly ReportType[] {
  if (marketplace === 'blinkit') return BLINKIT_REPORT_TYPES;
  if (marketplace === 'swiggy_instamart') return SWIGGY_INSTAMART_REPORT_TYPES;
  if (marketplace === 'zepto') return ZEPTO_REPORT_TYPES;
  return AMAZON_REPORT_TYPES;
}

export function findReportType(
  marketplace: 'amazon' | 'blinkit' | 'swiggy_instamart' | 'zepto',
  id: string
): ReportType | undefined {
  return reportTypesForMarketplace(marketplace).find((r) => r.id === id);
}

// ── Auto-detection (bulk ingest) ──────────────────────────────────────────────

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
  const start = startDate.replace(/-/g, ''); // "2026-06-01" → "20260601"
  const end = endDate.replace(/-/g, '');
  const ext = originalName.includes('.') ? '.' + originalName.split('.').pop()!.toLowerCase() : '.csv';
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
  // picks up whatever IAM the service account has. Note: overwriting an existing
  // object (replace-by-date) needs storage.objects.delete, so the SA must have
  // Storage Object Admin, not just Storage Object Creator.
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
): Promise<{
  results: IngestFileResult[];
  marketplaces: Array<'amazon' | 'blinkit' | 'swiggy_instamart' | 'zepto'>;
}> {
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
