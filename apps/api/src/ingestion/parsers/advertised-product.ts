import type { AdChannel } from '@dash/shared';

import { parseDateCell, plausible } from '../../lib/dates';
import { hasColumn, normalizeAsin, num, pick, round2, str, type Row } from '../../lib/values';
import { collectAttrs, looksVideo, type CampaignAttr } from '../../lib/ad-type';
import { singleNameDate, type ParseContext, type ParseResult } from './types';

export interface AsinAdRecord {
  date: string;
  campaignName: string;
  asin: string;
  impressions: number;
  clicks: number;
  spend: number;
  adSales: number;
  adUnits: number;
}

const ASIN = ['Advertised ASIN', 'ASIN'];
const SPEND = ['Spend', 'Spend (₹)', 'Cost'];
// Exact names only — "14 Day Total Sales – (Click)" must not match.
const SALES = ['7 Day Total Sales', '7 Day Total Sales (₹)', '14 Day Total Sales', '14 Day Total Sales (₹)', 'Total Sales'];
const UNITS = ['7 Day Total Units (#)', '14 Day Total Units (#)', '7 Day Total Units', '14 Day Total Units', 'Total Units'];
const ORDERS = ['7 Day Total Orders (#)', '14 Day Total Orders (#)', 'Total Orders (#)'];

/**
 * SP / SD Advertised Product report → per day × campaign × ASIN ad metrics (ad groups summed).
 * (SB only from the GCS warehouse export, whose SB rows carry their own spend.)
 */
export function parseAdvertisedProduct(
  channel: AdChannel,
  headers: string[],
  rows: Row[],
  ctx: ParseContext
): ParseResult<AsinAdRecord> & { attrs: CampaignAttr[] } {
  const warnings: string[] = [];
  const fallbackDate = singleNameDate(ctx);
  const hasUnits = hasColumn(headers, UNITS);
  if (!hasUnits) warnings.push('No "Total Units" column — Ad Units use "Total Orders (#)" instead.');

  const acc = new Map<string, AsinAdRecord>();
  const attrs: CampaignAttr[] = [];
  let undated = 0;
  let noAsin = 0;
  for (const r of rows) {
    const asin = normalizeAsin(pick(r, ASIN));
    if (!asin) {
      if (str(pick(r, ['Campaign Name']))) noAsin++;
      continue;
    }
    let date = plausible(parseDateCell(pick(r, ['Date', 'Day'])));
    if (!date) {
      const start = plausible(parseDateCell(pick(r, ['Start Date'])));
      const end = plausible(parseDateCell(pick(r, ['End Date'])));
      if (start && (!end || end === start)) date = start;
    }
    date ??= fallbackDate;
    if (!date) {
      undated++;
      continue;
    }
    const campaignName = str(pick(r, ['Campaign Name', 'Campaign']));
    attrs.push({ campaignName, channel, isVideo: looksVideo(campaignName, str(pick(r, ['Ad Group Name']))) });
    const key = `${date}|${campaignName}|${asin}`;
    const cur =
      acc.get(key) ?? { date, campaignName, asin, impressions: 0, clicks: 0, spend: 0, adSales: 0, adUnits: 0 };
    cur.impressions += num(pick(r, ['Impressions']));
    cur.clicks += num(pick(r, ['Clicks']));
    cur.spend += num(pick(r, SPEND));
    cur.adSales += num(pick(r, SALES));
    cur.adUnits += num(pick(r, hasUnits ? UNITS : ORDERS));
    acc.set(key, cur);
  }
  if (noAsin) warnings.push(`${noAsin} row(s) skipped: no Advertised ASIN.`);
  if (undated) warnings.push(`${undated} row(s) skipped: no single-day date (export with Daily time unit).`);
  const records = [...acc.values()].map((r) => ({ ...r, spend: round2(r.spend), adSales: round2(r.adSales) }));
  const a = collectAttrs(attrs.filter((x) => x.campaignName));
  if (!records.length && rows.length)
    return { records, attrs: a, rowsRead: rows.length, warnings, error: 'No dated ASIN rows could be read.' };
  return { records, attrs: a, rowsRead: rows.length, warnings };
}
