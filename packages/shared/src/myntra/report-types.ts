/**
 * Myntra report types, detected by COLUMNS. Product key is the **Style** (plays
 * the ASIN role). Total Sales is dated (replace-by-date) and carries State →
 * geography. The ad reports carry no date → stored against the export window
 * (replace-by-period). Product Targeting + Keyword Targeting fold into ONE
 * `targeting` table (target_type). Platform top search terms is a demand/SOV
 * feed, not tied to campaigns.
 *
 * TODO: confirm column signatures against real Myntra exports.
 */
export type MyReportType =
  | 'my_total_sales' // style × date × state — gross revenue, units
  | 'my_ad_campaign' // campaign report (period)
  | 'my_ad_placement' // placement report (period)
  | 'my_ad_product' // product report = ad-style (period)
  | 'my_ad_search_term' // keyword-targeting search term report (period)
  | 'my_ad_targeting' // product targeting + keyword targeting, merged (period)
  | 'my_top_search_terms' // platform-level top search terms — SOV / demand (period)
  | 'my_style_mapper' // style → category / title / price
  | 'my_campaign_mapper' // campaign → category
  | 'unknown';

export const MY_REPORT_LABEL: Record<MyReportType, string> = {
  my_total_sales: 'Myntra Total Sales',
  my_ad_campaign: 'Myntra Campaign',
  my_ad_placement: 'Myntra Placement',
  my_ad_product: 'Myntra Product',
  my_ad_search_term: 'Myntra Search Term',
  my_ad_targeting: 'Myntra Targeting',
  my_top_search_terms: 'Myntra Top Search Terms',
  my_style_mapper: 'Myntra Style mapper',
  my_campaign_mapper: 'Myntra Campaign mapper',
  unknown: 'Not recognised',
};

export type MyTargetType = 'product' | 'keyword';

export const MY_AD_REPORTS: ReadonlySet<MyReportType> = new Set<MyReportType>([
  'my_ad_campaign',
  'my_ad_placement',
  'my_ad_product',
  'my_ad_search_term',
  'my_ad_targeting',
  'my_top_search_terms',
]);
