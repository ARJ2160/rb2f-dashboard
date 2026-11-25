/**
 * Nykaa report types, detected by COLUMNS. Product key is the **SKU**.
 * Two sales sources combine (like Amazon Seller+Vendor §4): MIS (Nykaa Fashion)
 * and Sales Report (Seller Portal), stored with a `source` column and deduped
 * by precedence per SKU per day. Ad reports are period-level. SKU SOV is a
 * demand/share feed. TODO: confirm column signatures + the source precedence.
 */
export type NkSalesSource = 'mis' | 'seller';

export type NkReportType =
  | 'nk_mis' // MIS (Nykaa Fashion) sales — sku × day
  | 'nk_sales_report' // Sales Report (Seller Portal) — sku × day
  | 'nk_ad_campaign' // Ad Report (period)
  | 'nk_ad_sku' // SKU Report (period)
  | 'nk_ad_placement' // Placement Report (period)
  | 'nk_ad_search_term' // only if the Ad Report carries search terms (period)
  | 'nk_sku_sov' // SKU SOV Report (period)
  | 'nk_sku_mapper'
  | 'nk_campaign_mapper'
  | 'unknown';

export const NK_REPORT_LABEL: Record<NkReportType, string> = {
  nk_mis: 'Nykaa MIS (Fashion)',
  nk_sales_report: 'Nykaa Sales Report (Seller)',
  nk_ad_campaign: 'Nykaa Ad Report',
  nk_ad_sku: 'Nykaa SKU Report',
  nk_ad_placement: 'Nykaa Placement',
  nk_ad_search_term: 'Nykaa Search Term',
  nk_sku_sov: 'Nykaa SKU SOV',
  nk_sku_mapper: 'Nykaa SKU mapper',
  nk_campaign_mapper: 'Nykaa Campaign mapper',
  unknown: 'Not recognised',
};

export const NK_AD_REPORTS: ReadonlySet<NkReportType> = new Set<NkReportType>([
  'nk_ad_campaign', 'nk_ad_sku', 'nk_ad_placement', 'nk_ad_search_term', 'nk_sku_sov',
]);
