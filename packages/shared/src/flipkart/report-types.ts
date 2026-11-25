/**
 * Flipkart report types. Each export is detected by its COLUMNS.
 *
 * Flipkart's product key is the **FSN** (plays the ASIN role). Two sales-side
 * reports are per-row-date (replace-by-date):
 *   - Traffic / Total Sales: FSN × day, gross revenue + units, and **combined
 *     ads+organic** impressions & clicks (so organic = total − ad is derivable).
 *   - Earn More: returns, cancellations, net revenue, net units (FSN × day).
 * All five ad reports are single-window summaries with no per-row date, so they
 * are stored against the export window (`period_from`…`period_to`),
 * replace-by-period — exactly the Zepto ad rule.
 */
export type FkReportType =
  | 'fk_traffic' // Total Sales / Traffic — FSN × day (gross rev/units, total impr/clicks)
  | 'fk_earn_more' // returns / cancellations / net rev / net units — FSN × day
  | 'fk_ad_campaign' // campaign report (period)
  | 'fk_ad_fsn' // Consolidated FSN (= Advertised Product) (period)
  | 'fk_ad_placement' // placement performance (period)
  | 'fk_ad_search_term' // search term report (period)
  | 'fk_ad_keyword' // keyword report (period)
  | 'fk_fsn_mapper' // FSN → category / title / selling price
  | 'fk_campaign_mapper' // campaign → category / sku / city
  | 'unknown';

export const FK_REPORT_LABEL: Record<FkReportType, string> = {
  fk_traffic: 'Flipkart Traffic / Total Sales',
  fk_earn_more: 'Flipkart Earn More (returns / net)',
  fk_ad_campaign: 'Flipkart Campaign',
  fk_ad_fsn: 'Flipkart Consolidated FSN',
  fk_ad_placement: 'Flipkart Placement',
  fk_ad_search_term: 'Flipkart Search Term',
  fk_ad_keyword: 'Flipkart Keyword',
  fk_fsn_mapper: 'Flipkart FSN mapper',
  fk_campaign_mapper: 'Flipkart Campaign mapper',
  unknown: 'Not recognised',
};

/** Ad report kinds (dateless → stored per export window). */
export const FK_AD_REPORTS: ReadonlySet<FkReportType> = new Set<FkReportType>([
  'fk_ad_campaign',
  'fk_ad_fsn',
  'fk_ad_placement',
  'fk_ad_search_term',
  'fk_ad_keyword',
]);
