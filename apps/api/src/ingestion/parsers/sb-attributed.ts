import { parseDateCell, plausible } from '../../lib/dates';
import { normalizeAsin, num, pick, round2, str, type Row } from '../../lib/values';
import { singleNameDate, type ParseContext, type ParseResult } from './types';

export interface SbAttributedRecord {
  date: string;
  campaignName: string;
  asin: string;
  adSales: number;
  adUnits: number;
}

const SALES = ['14 Day Total Sales', '14 Day Total Sales (₹)', 'Total Sales', 'Sales'];
const UNITS = ['14 Day Total Units (#)', '14 Day Total Units', 'Total Units', 'Units'];

/**
 * SB Attributed Purchases → per campaign × purchased ASIN per day. Both
 * attribution types ("Promoted" and "Brand Halo") are SB-attributed sales and
 * are kept. Spend is NOT in this report — it is prorated from the SB campaign
 * report at query time (rule book §5).
 */
export function parseSbAttributed(rows: Row[], ctx: ParseContext): ParseResult<SbAttributedRecord> {
  const warnings: string[] = [];
  const fallbackDate = singleNameDate(ctx);
  const acc = new Map<string, SbAttributedRecord>();
  let undated = 0;
  for (const r of rows) {
    const asin = normalizeAsin(pick(r, ['Purchased ASIN', 'ASIN']));
    const campaignName = str(pick(r, ['Campaign Name', 'Campaign']));
    if (!asin || !campaignName) continue;
    const date = plausible(parseDateCell(pick(r, ['Date', 'Start Date']))) ?? fallbackDate;
    if (!date) {
      undated++;
      continue;
    }
    const key = `${date}|${campaignName}|${asin}`;
    const cur = acc.get(key) ?? { date, campaignName, asin, adSales: 0, adUnits: 0 };
    cur.adSales += num(pick(r, SALES));
    cur.adUnits += num(pick(r, UNITS));
    acc.set(key, cur);
  }
  if (undated) warnings.push(`${undated} row(s) skipped: no readable date.`);
  const records = [...acc.values()].map((r) => ({ ...r, adSales: round2(r.adSales) }));
  if (!records.length && rows.length) return { records, rowsRead: rows.length, warnings, error: 'No dated rows with a campaign and purchased ASIN.' };
  return { records, rowsRead: rows.length, warnings };
}
