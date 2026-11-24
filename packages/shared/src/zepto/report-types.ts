/**
 * Zepto report types. Every raw export Zepto sends is detected by its COLUMNS
 * (channel — SP/SB/SD — comes from the file/report-type name, since the ad
 * reports' columns are identical across channels).
 *
 * The ad reports (campaign / keyword / product) carry NO date column, so they
 * are stored against the export window (from the GCS filename `…_<YYYYMMDD>_<YYYYMMDD>`
 * or the date range chosen on manual upload), replace-by-period. Total Sales is
 * per-day (`Sales Date`); Inventory is a dated snapshot.
 */

export type ZpChannel = 'sp' | 'sb' | 'sd';

export type ZpReportType =
  | 'zp_sales' // SALES_OVERVIEW — day × city × SKU
  | 'zp_inventory' // city × SKU stock snapshot
  | 'zp_campaign' // SP/SB/SD campaign report (1 row per campaign)
  | 'zp_keyword' // SP/SB keyword report (1 row per keyword × campaign)
  | 'zp_product' // SP/SB/SD product report (1 row per SKU × campaign)
  | 'zp_sku_mapper' // SKU ID → category
  | 'zp_campaign_mapper' // campaign name → category
  | 'unknown';

export const ZP_REPORT_LABEL: Record<ZpReportType, string> = {
  zp_sales: 'Zepto Total Sales',
  zp_inventory: 'Zepto Inventory',
  zp_campaign: 'Zepto Campaign',
  zp_keyword: 'Zepto Keyword',
  zp_product: 'Zepto Product',
  zp_sku_mapper: 'Zepto SKU mapper',
  zp_campaign_mapper: 'Zepto Campaign mapper',
  unknown: 'Not recognised',
};

export const ZP_CHANNEL_LABEL: Record<ZpChannel, string> = {
  sp: 'Sponsored Product',
  sb: 'Sponsored Brand',
  sd: 'Sponsored Display',
};

/** Ad report kinds that have a channel (SP/SB/SD). */
export const ZP_AD_REPORTS: ReadonlySet<ZpReportType> = new Set<ZpReportType>([
  'zp_campaign',
  'zp_keyword',
  'zp_product',
]);
