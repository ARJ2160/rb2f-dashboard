import { parseDateCell, plausible } from '../../lib/dates';
import { hasColumn, num, pick, round2, str, type Row } from '../../lib/values';
import { singleNameDate, type ParseContext, type ParseResult } from './types';

export interface PlacementRecord {
  date: string;
  channel: 'sp' | 'sb';
  campaignName: string;
  placement: string;
  rawPlacement: string;
  impressions: number;
  clicks: number;
  spend: number;
  adSales: number;
  adUnits: number;
}

const SPEND = ['Spend', 'Spend (₹)', 'Cost'];
const SALES = ['7 Day Total Sales', '7 Day Total Sales (₹)', '14 Day Total Sales', '14 Day Total Sales (₹)', 'Total Sales'];
const UNITS = ['7 Day Total Units (#)', '14 Day Total Units (#)', '7 Day Total Units', '14 Day Total Units', 'Total Units'];
const ORDERS = ['7 Day Total Orders (#)', '14 Day Total Orders (#)', 'Total Orders (#)'];

/** TOS / ROS / PDP (ported from eigen). Unrecognised labels are kept as-is, never dropped. */
export function normalizePlacement(raw: string): string {
  const l = raw.toLowerCase().trim();
  if (!l) return 'Unknown';
  if (l.includes('top of search') || l === 'tos') return 'TOS';
  if (l.includes('product page') || l.includes('detail page') || l === 'pdp') return 'PDP';
  if (l.includes('rest of search') || l === 'ros') return 'ROS';
  return raw.trim();
}

export function parsePlacements(
  channel: 'sp' | 'sb',
  headers: string[],
  rows: Row[],
  ctx: ParseContext
): ParseResult<PlacementRecord> {
  const warnings: string[] = [];
  const fallbackDate = singleNameDate(ctx);
  const hasUnits = hasColumn(headers, UNITS);
  if (!hasUnits) warnings.push('No "Total Units" column — Ad Units use "Total Orders (#)" instead.');
  const acc = new Map<string, PlacementRecord>();
  let undated = 0;
  for (const r of rows) {
    const campaignName = str(pick(r, ['Campaign Name', 'Campaign']));
    if (!campaignName) continue;
    const rawPlacement = str(pick(r, ['Placement', 'Placement Type'])) || 'Unknown';
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
    const key = `${date}|${campaignName}|${rawPlacement}`;
    const cur =
      acc.get(key) ??
      {
        date,
        channel,
        campaignName,
        placement: normalizePlacement(rawPlacement),
        rawPlacement,
        impressions: 0,
        clicks: 0,
        spend: 0,
        adSales: 0,
        adUnits: 0,
      };
    cur.impressions += num(pick(r, ['Impressions']));
    cur.clicks += num(pick(r, ['Clicks']));
    cur.spend += num(pick(r, SPEND));
    cur.adSales += num(pick(r, SALES));
    cur.adUnits += num(pick(r, hasUnits ? UNITS : ORDERS));
    acc.set(key, cur);
  }
  if (undated) warnings.push(`${undated} row(s) skipped: no single-day date.`);
  const records = [...acc.values()].map((r) => ({ ...r, spend: round2(r.spend), adSales: round2(r.adSales) }));
  if (!records.length && rows.length) return { records, rowsRead: rows.length, warnings, error: 'No dated placement rows.' };
  return { records, rowsRead: rows.length, warnings };
}
