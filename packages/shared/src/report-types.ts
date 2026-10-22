/**
 * Every raw report the ingestion pipeline can recognise.
 *
 * `inScope` = parsed and stored today. Out-of-scope types are still
 * recognised (so an upload says "known report, not wired up yet" instead of
 * "unknown file"), which keeps the door open to add them one at a time.
 */
export const REPORT_TYPES = {
  business_report: { label: 'Business Report (Seller Central)', inScope: true },
  vendor_central: { label: 'Vendor Central Sales', inScope: true },
  sp_campaign: { label: 'SP Campaign', inScope: true },
  sb_campaign: { label: 'SB Campaign', inScope: true },
  sd_campaign: { label: 'SD Campaign', inScope: true },
  asin_mapper: { label: 'ASIN Mapper', inScope: true },
  campaign_mapper: { label: 'Campaign Mapper', inScope: true },
  sp_advertised_product: { label: 'SP Advertised Product', inScope: true },
  sd_advertised_product: { label: 'SD Advertised Product', inScope: true },
  sb_attributed_purchase: { label: 'SB Attributed Purchase', inScope: true },
  /** GCS warehouse only: the unified advertised-product export carries SB rows with their own spend. Never detected in uploads. */
  sb_advertised_product: { label: 'SB Advertised Product', inScope: false },
  sp_search_term: { label: 'SP Search Term', inScope: true },
  sb_search_term: { label: 'SB Search Term', inScope: true },
  sd_targeting: { label: 'SD Targeting', inScope: true },
  sp_placement: { label: 'SP Placement', inScope: true },
  sb_placement: { label: 'SB Placement', inScope: true },
  hourly: { label: 'Hourly Campaign', inScope: false },
  order_report: { label: 'Order Report', inScope: true },
  search_query_performance: { label: 'Search Query Performance', inScope: false },
} as const satisfies Record<string, { label: string; inScope: boolean }>;

export type ReportType = keyof typeof REPORT_TYPES;

export type SalesSource = 'seller' | 'vendor';
export type AdChannel = 'sp' | 'sb' | 'sd';
