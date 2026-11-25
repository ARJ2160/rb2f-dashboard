/**
 * Meesho report types, detected by COLUMNS. Product key is the **SKU**.
 * No ads feed from the marketplace (POC only) → ad metrics come from manually
 * entered spend (me_manual_ads). BR = gross sales; Orders Report → net via
 * order status (delivered / returned / RTO / cancelled). TODO: confirm columns.
 */
export type MeReportType =
  | 'me_br' // Business Report — sku × day (gross)
  | 'me_orders' // Orders Report — status → net
  | 'me_sku_mapper'
  | 'unknown';
export const ME_REPORT_LABEL: Record<MeReportType, string> = {
  me_br: 'Meesho Business Report', me_orders: 'Meesho Orders Report', me_sku_mapper: 'Meesho SKU mapper', unknown: 'Not recognised',
};
