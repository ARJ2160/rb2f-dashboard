import type { AdChannel, ReportType } from '@dash/shared';

import { hasColumn } from '../lib/values';

/** Header spellings for the ASIN column of a mapper sheet. */
export const ASIN_COLUMNS = ['ASIN', 'Amazon ASIN', 'Child ASIN', 'Asin'] as const;
/** Category column of an ASIN mapper, in priority order (first one present wins). */
export const CATEGORY_COLUMNS = ['Category', 'Article Type', 'Sub-Cat', 'Sub Category', 'Sub-category'] as const;

/**
 * Decide what a sheet is.
 *
 * 1. Column headers (most reliable — rule book §1: channel is a property of
 *    the file's own columns, not its folder or name).
 * 2. Sheet name (combined workbooks name tabs "SP campaign", "Business reports").
 * 3. Filename.
 */
export function detectReportType(
  headers: string[],
  sheetName: string,
  filename: string
): { reportType: ReportType; detectedBy: 'headers' | 'filename' } | null {
  const byHeaders = detectByHeaders(headers);
  if (byHeaders) return { reportType: byHeaders, detectedBy: 'headers' };
  const byName = detectByName(sheetName) ?? detectByName(filename);
  if (byName) return { reportType: byName, detectedBy: 'filename' };
  return null;
}

export function detectByHeaders(h: string[]): ReportType | null {
  const has = (...aliases: string[]) => hasColumn(h, aliases);

  // ── Sales sources ──
  // Vendor Central: Ordered and/or Shipped revenue & units per ASIN.
  if (has('ASIN') && has('Ordered Revenue', 'Ordered Units', 'Shipped Revenue', 'Shipped Units')) return 'vendor_central';
  if (has('Sessions - Total', 'Sessions') && has('Ordered Product Sales', 'Units Ordered')) return 'business_report';

  // ── Mappers (category columns, no performance metrics) ──
  const metricCols = has('Impressions', 'Clicks', 'Spend', 'Units Ordered', 'Ordered Revenue');
  if (!metricCols) {
    if (has(...ASIN_COLUMNS) && has(...CATEGORY_COLUMNS)) return 'asin_mapper';
    // Campaign mappers sometimes carry no Category column at all (only Type /
    // Targeting / Branded) — still recognisable by campaign name + those columns.
    if (has('Campaigns', 'Campaign Name', 'Campaign') && has('Category', 'Type', 'Branded/Non-Branded')) return 'campaign_mapper';
  }

  // ── Search-query / order / attribution reports ──
  if (has('Search Query') && has('Search Query Volume')) return 'search_query_performance';
  if (has('amazon-order-id', 'Order ID') && has('ship-state', 'Ship State')) return 'order_report';
  if (has('Purchased ASIN')) return 'sb_attributed_purchase';

  if (!has('Campaign Name', 'Campaign')) return null;
  const channel = detectAdChannel(h);

  if (has('Placement')) return channel === 'sb' ? 'sb_placement' : 'sp_placement';
  if (has('Customer Search Term')) return channel === 'sb' ? 'sb_search_term' : 'sp_search_term';
  if (has('Advertised ASIN')) return channel === 'sd' ? 'sd_advertised_product' : 'sp_advertised_product';
  if (channel === 'sd' && has('Targeting') && !has('Budget Amount')) return 'sd_targeting';

  if (has('Impressions') && has('Spend')) {
    if (channel === 'sd') return 'sd_campaign';
    if (channel === 'sb') return 'sb_campaign';
    if (channel === 'sp') return 'sp_campaign';
  }
  return null;
}

/**
 * Channel from columns. Verified against real Amazon India exports (YPLAYZ +
 * Cult), where SP can be on a 7-day OR 14-day attribution window, so the
 * attribution window alone is not a reliable signal.
 *
 *   SP — "Program Type"/"Campaign Type" column, 7-day columns, or no
 *        "Cost Type" + no "Viewable Impressions" (SB and SD exports always
 *        carry a cost type; SP is CPC-only and never reports viewability).
 *   SD — view-through attribution columns, "14 Day ATC Views",
 *        "Bid Optimisation"/"Bid Optimization", "Tactic".
 *   SB — video / store columns ("5 Second Views", "Video … Views",
 *        "Brand Store page views"), branded searches, or anything else with a
 *        cost type that isn't SD.
 */
export function detectAdChannel(h: string[]): AdChannel | null {
  const has = (...aliases: string[]) => hasColumn(h, aliases);
  const lower = h.map((x) => x.trim().toLowerCase());
  const any = (re: RegExp) => lower.some((x) => re.test(x));

  if (has('Program Type', 'Campaign Type')) return 'sp';
  if (has('7 Day Total Sales', '7 Day Total Sales (₹)', '7 Day Total Orders (#)')) return 'sp';
  const hasCostType = has('Cost type', 'Cost Type');
  if (!hasCostType && !has('Viewable Impressions')) return 'sp';

  if (any(/view-through conversions/) || has('14 Day ATC Views', 'Tactic', 'Bid Optimization', 'Bid Optimisation')) return 'sd';
  if (has('Brand Store page views', '5 Second Views', 'Video First Quartile Views', '14 Day Branded Searches')) return 'sb';
  if (has('14 Day Detail Page Views (DPV)', 'Detail Page Views (DPV)')) return 'sd';
  if (hasCostType) return 'sb';
  return null;
}

/** Name-based fallback (sheet tab or filename), mirroring the eigen filename resolver. */
export function detectByName(name: string): ReportType | null {
  const n = ` ${name
    .replace(/\.(xlsx|xls|csv)$/i, '')
    .replace(/[_\-().]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .replace(/sponsored products?/g, 'sp')
    .replace(/sponsored brands?/g, 'sb')
    .replace(/sponsored display/g, 'sd')} `;
  const has = (...words: string[]) => words.every((w) => n.includes(w));
  const word = (w: string) => n.includes(` ${w} `);

  if (has('asin', 'mapper')) return 'asin_mapper';
  if (has('campaign', 'mapper')) return 'campaign_mapper';
  if (has('vendor')) return 'vendor_central';
  if (has('business')) return 'business_report';
  if (has('search', 'query')) return 'search_query_performance';
  if (word('order') || has('order report')) return 'order_report';
  if (word('sp') && has('placement')) return 'sp_placement';
  if (word('sb') && has('placement')) return 'sb_placement';
  if (word('sp') && (has('search', 'term') || has('searchterm') || word('str'))) return 'sp_search_term';
  if (word('sb') && (has('search', 'term') || has('searchterm') || word('str'))) return 'sb_search_term';
  if (word('sd') && (has('match') || has('targeting'))) return 'sd_targeting';
  if (word('sb') && has('attributed')) return 'sb_attributed_purchase';
  if (word('sp') && (has('advertised') || has('ad asin'))) return 'sp_advertised_product';
  if (word('sd') && (has('advertised') || has('ad asin'))) return 'sd_advertised_product';
  if (has('hour')) return 'hourly';
  if (word('sp') && has('campaign')) return 'sp_campaign';
  if (word('sb') && has('campaign')) return 'sb_campaign';
  if (word('sd') && has('campaign')) return 'sd_campaign';
  return null;
}
