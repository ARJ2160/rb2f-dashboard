import type { AdChannel } from '@dash/shared';

import { parseDateCell, plausible } from '../../lib/dates';
import { hasColumn, num, pick, round2, str, type Row } from '../../lib/values';
import { collectAttrs, looksVideo, type CampaignAttr } from '../../lib/ad-type';
import { parseHourCell } from '../../lib/dates';
import { singleNameDate, type AdRecord, type ParseContext, type ParseResult } from './types';

export interface HourlyRecord extends AdRecord {
  hour: number;
}

export type CampaignParseResult = ParseResult<AdRecord> & { hourly: HourlyRecord[]; attrs: CampaignAttr[] };

const VIDEO_VIEWS = ['Video First Quartile Views', 'Video Complete Views', '5 Second Views'];

const CAMPAIGN = ['Campaign Name', 'Campaign'];
const IMPRESSIONS = ['Impressions'];
const CLICKS = ['Clicks'];
const SPEND = ['Spend', 'Spend (₹)', 'Cost'];
// SP attributes on 7 days, SB/SD on 14. Exact-name matching keeps
// "14 Day Total Sales - (Click)" from being picked up by mistake.
const SALES = ['7 Day Total Sales', '7 Day Total Sales (₹)', '14 Day Total Sales', '14 Day Total Sales (₹)', 'Total Sales', 'Sales'];
const UNITS = ['7 Day Total Units (#)', '14 Day Total Units (#)', '7 Day Total Units', '14 Day Total Units', 'Total Units', 'Units'];
const ORDERS = ['7 Day Total Orders (#)', '14 Day Total Orders (#)', 'Total Orders (#)', 'Orders'];

/**
 * SP / SB / SD campaign report → per-campaign per-day ad metrics.
 *
 * Row date: "Date" if present; otherwise "Start Date" when it equals
 * "End Date" (a daily export). A row spanning several days can't be placed
 * on a day, so it falls back to the file's single date or is skipped.
 */
export function parseCampaignReport(
  channel: AdChannel,
  headers: string[],
  rows: Row[],
  ctx: ParseContext
): CampaignParseResult {
  const warnings: string[] = [];
  const fallbackDate = singleNameDate(ctx);
  const hasUnits = hasColumn(headers, UNITS);
  if (!hasUnits && hasColumn(headers, ORDERS)) {
    warnings.push('No "Total Units" column in this export — Ad Units use "Total Orders (#)" instead.');
  }

  const hourlyExport = hasColumn(headers, ['Start Time']);
  if (hourlyExport) {
    warnings.push('Hourly export (has "Start Time") — stored per hour for Hour-wise, and summed per day everywhere else.');
  }

  const acc = new Map<string, AdRecord>();
  const hourAcc = new Map<string, HourlyRecord>();
  const attrs: CampaignAttr[] = [];
  let multiDay = 0;
  let undated = 0;

  for (const r of rows) {
    const campaignName = str(pick(r, CAMPAIGN));
    if (!campaignName) continue;

    let date = plausible(parseDateCell(pick(r, ['Date', 'Day'])));
    if (!date) {
      const start = plausible(parseDateCell(pick(r, ['Start Date'])));
      const end = plausible(parseDateCell(pick(r, ['End Date'])));
      if (start && (!end || end === start)) date = start;
      else if (start && end) multiDay++;
    }
    date ??= fallbackDate;
    if (!date) {
      undated++;
      continue;
    }

    const m = {
      impressions: num(pick(r, IMPRESSIONS)),
      clicks: num(pick(r, CLICKS)),
      spend: num(pick(r, SPEND)),
      adSales: num(pick(r, SALES)),
      adUnits: num(pick(r, hasUnits ? UNITS : ORDERS)),
    };
    const key = `${date}|${campaignName}`;
    const cur =
      acc.get(key) ??
      { date, channel, campaignName, impressions: 0, clicks: 0, spend: 0, adSales: 0, adUnits: 0 };
    cur.impressions += m.impressions;
    cur.clicks += m.clicks;
    cur.spend += m.spend;
    cur.adSales += m.adSales;
    cur.adUnits += m.adUnits;
    acc.set(key, cur);

    const videoViews = VIDEO_VIEWS.reduce((a, c) => a + num(pick(r, [c])), 0);
    attrs.push({ campaignName, channel, isVideo: looksVideo(campaignName) || (channel === 'sb' && videoViews > 0) });

    if (hourlyExport) {
      const hour = parseHourCell(pick(r, ['Start Time']));
      if (hour != null) {
        const hk = `${date}|${hour}|${campaignName}`;
        const h = hourAcc.get(hk) ?? { date, hour, channel, campaignName, impressions: 0, clicks: 0, spend: 0, adSales: 0, adUnits: 0 };
        h.impressions += m.impressions;
        h.clicks += m.clicks;
        h.spend += m.spend;
        h.adSales += m.adSales;
        h.adUnits += m.adUnits;
        hourAcc.set(hk, h);
      }
    }
  }

  if (multiDay)
    warnings.push(
      `${multiDay} row(s) span several days (Start Date ≠ End Date) and were ${fallbackDate ? `dated ${fallbackDate}` : 'skipped'} — export campaign reports with Daily time unit.`
    );
  if (undated) warnings.push(`${undated} row(s) skipped: no readable date.`);

  const records = [...acc.values()].map((r) => ({ ...r, spend: round2(r.spend), adSales: round2(r.adSales) }));
  const hourly = [...hourAcc.values()].map((r) => ({ ...r, spend: round2(r.spend), adSales: round2(r.adSales) }));
  const a = collectAttrs(attrs);
  if (records.length === 0 && rows.length > 0 && !warnings.length) {
    return { records, hourly, attrs: a, rowsRead: rows.length, warnings, error: 'No campaign rows with a date could be read.' };
  }
  return { records, hourly, attrs: a, rowsRead: rows.length, warnings };
}
