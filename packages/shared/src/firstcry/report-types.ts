/**
 * Firstcry report types, detected by COLUMNS. Product key is the **SKU**.
 * Sales is dated (replace-by-date). Performance reports are period-level.
 * Performance Category is PRE-ROLLED to category → direct Category-Advertised,
 * no campaign mapper needed. TODO: confirm column signatures.
 */
export type FcReportType =
  | 'fc_sales' // Sales Report — sku × day
  | 'fc_perf_product' // Performance Product (period) — sku ad
  | 'fc_perf_category' // Performance Category (period) — already category-level
  | 'fc_perf_keyword' // Performance Keyword (period)
  | 'fc_sku_mapper'
  | 'fc_campaign_mapper'
  | 'unknown';
export const FC_REPORT_LABEL: Record<FcReportType, string> = {
  fc_sales: 'Firstcry Sales', fc_perf_product: 'Firstcry Performance Product', fc_perf_category: 'Firstcry Performance Category',
  fc_perf_keyword: 'Firstcry Performance Keyword', fc_sku_mapper: 'Firstcry SKU mapper', fc_campaign_mapper: 'Firstcry Campaign mapper', unknown: 'Not recognised',
};
export const FC_AD_REPORTS: ReadonlySet<FcReportType> = new Set<FcReportType>(['fc_perf_product', 'fc_perf_category', 'fc_perf_keyword']);
