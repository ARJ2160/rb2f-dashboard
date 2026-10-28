import type { AdChannel } from '@dash/shared';

import { parseDateCell, plausible } from '../../lib/dates';
import { hasColumn, num, pick, round2, str, type Row } from '../../lib/values';
import { singleNameDate, type ParseContext, type ParseResult } from './types';

export interface SearchTermRecord {
  date: string;
  channel: AdChannel;
  campaignName: string;
  target: string;
  matchType: string;
  searchTerm: string;
  impressions: number;
  clicks: number;
  spend: number;
  adSales: number;
  adUnits: number;
  /** "Total Orders (#)" — null when the export has no orders column. */
  adOrders: number | null;
}

const SPEND = ['Spend', 'Spend (₹)', 'Cost'];
const SALES = ['7 Day Total Sales', '7 Day Total Sales (₹)', '14 Day Total Sales', '14 Day Total Sales (₹)', 'Total Sales'];
const UNITS = ['7 Day Total Units (#)', '14 Day Total Units (#)', '7 Day Total Units', '14 Day Total Units', 'Total Units'];
const ORDERS = ['7 Day Total Orders (#)', '14 Day Total Orders (#)', 'Total Orders (#)'];

/** Excel exports prefix text that looks like a formula/number with an apostrophe ("'shoes for men"). */
export function cleanTerm(raw: unknown): string {
  return str(raw).replace(/^'+/, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * SP / SB Search Term report, or SD Targeting report → per-day rows keyed by
 * campaign × target × match type × search term (ad groups summed).
 * The triggered search term and the targeted keyword are kept separately
 * (rule book §6: deliberate-targeting joins use `target`). SD has no customer
 * search term, so its search term is the targeting expression.
 */
export function parseSearchTerms(
  channel: AdChannel,
  headers: string[],
  rows: Row[],
  ctx: ParseContext
): ParseResult<SearchTermRecord> {
  const warnings: string[] = [];
  const fallbackDate = singleNameDate(ctx);
  const hasUnits = hasColumn(headers, UNITS);
  const hasOrders = hasColumn(headers, ORDERS);
  if (!hasUnits) warnings.push('No "Total Units" column — Ad Units use "Total Orders (#)" instead.');

  const acc = new Map<string, SearchTermRecord>();
  let undated = 0;
  for (const r of rows) {
    const campaignName = str(pick(r, ['Campaign Name', 'Campaign']));
    if (!campaignName) continue;
    const target = cleanTerm(pick(r, ['Targeting', 'Target', 'Keyword']));
    const searchTerm = channel === 'sd' ? target : cleanTerm(pick(r, ['Customer Search Term', 'Search Term']));
    if (!searchTerm && !target) continue;
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
    const matchType = str(pick(r, ['Match Type'])).toUpperCase() || '-';
    const key = `${date}|${campaignName}|${target}|${matchType}|${searchTerm}`;
    const cur =
      acc.get(key) ??
      { date, channel, campaignName, target, matchType, searchTerm, impressions: 0, clicks: 0, spend: 0, adSales: 0, adUnits: 0, adOrders: hasOrders ? 0 : null };
    cur.impressions += num(pick(r, ['Impressions']));
    cur.clicks += num(pick(r, ['Clicks']));
    cur.spend += num(pick(r, SPEND));
    cur.adSales += num(pick(r, SALES));
    cur.adUnits += num(pick(r, hasUnits ? UNITS : ORDERS));
    if (cur.adOrders != null) cur.adOrders += num(pick(r, ORDERS));
    acc.set(key, cur);
  }
  if (undated) warnings.push(`${undated} row(s) skipped: no single-day date (export with Daily time unit).`);
  const records = [...acc.values()].map((r) => ({ ...r, spend: round2(r.spend), adSales: round2(r.adSales) }));
  if (!records.length && rows.length) return { records, rowsRead: rows.length, warnings, error: 'No dated search-term rows.' };
  return { records, rowsRead: rows.length, warnings };
}
