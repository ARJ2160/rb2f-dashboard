import { normalizeAsin, num, pick, str, type Row } from '../../lib/values';
import type { ParseContext, ParseResult } from './types';

export interface KeywordSovRecord {
  duration: string;
  snapshotDate: string;
  keyword: string;
  keywordType: string;
  category: string | null;
  searches: string | null;
  rank: number | null;
  mostClickedOrganicAsin: string | null;
  mostClickedSpAsin: string | null;
  metrics: Record<string, number | string | null>;
}

/** Numeric metric columns kept in the JSON blob (surfaced by the metric picker). */
const NUMBER_METRICS = [
  'firstPageOrganicCoverage', 'firstPageSpSOV', 'overallSpSOV', 'overallSpACOS', 'overallSbSOV', 'overallSbACOS',
  'firstPageTopSpSOV', 'firstPageSpCTR', 'firstPageSpCPC', 'firstPageSpACOS', 'firstPageSpConversions',
  'overallSpCTR', 'overallSpCPC', 'overallSpConversions', 'restOfSearchSpSOV', 'totalFirstPageCoverage',
  'firstPageSpCoverage', 'firstPageSbSOV', 'firstPageSbCTR', 'firstPageSbACOS', 'firstPageSbCPC',
  'firstPageSbConversions', 'firstPageTopSbSOV', 'overallSbCTR', 'overallSbCPC', 'overallSbConversions',
  'restOfSearchSbSOV', 'overallOrganicSOV',
] as const;
/** ASIN-valued metrics (kept as strings). */
const ASIN_METRICS = ['topDisplayedSPAsin', 'topDisplayedOrganicAsin'] as const;

/** "15days" / "15 Days" / "15-Days" → "15days". */
function normDuration(raw: string): string {
  const m = raw.toLowerCase().match(/(7|15|30)\s*-?\s*days?/);
  return m ? `${m[1]}days` : raw.trim().toLowerCase().replace(/[\s-]+/g, '') || 'unknown';
}

/** Find an export date in a file name: YYYY-MM-DD or DD-MM-YYYY (Indian) → YYYY-MM-DD. */
function dateFromNames(names: string[]): string | null {
  for (const n of names) {
    const ymd = n.match(/(20\d{2})[-_](\d{1,2})[-_](\d{1,2})/);
    if (ymd) return `${ymd[1]}-${ymd[2]!.padStart(2, '0')}-${ymd[3]!.padStart(2, '0')}`;
    const dmy = n.match(/(\d{1,2})[-_](\d{1,2})[-_](20\d{2})/);
    if (dmy) return `${dmy[3]}-${dmy[2]!.padStart(2, '0')}-${dmy[1]!.padStart(2, '0')}`;
  }
  return null;
}

/**
 * Amazon Pi "Search Performance" keyword report → one row per keyword per
 * duration window. Headline fields are columns; every SOV / CTR / CPC / ACoS /
 * coverage metric goes into a JSON blob for the metric picker.
 */
export function parseKeywordSov(rows: Row[], ctx: ParseContext, names: string[] = []): ParseResult<KeywordSovRecord> {
  const warnings: string[] = [];
  const fromName = names.map((n) => normDuration(n)).find((d) => /^(7|15|30)days$/.test(d));
  const snapshotDate = ctx.nameDates?.from ?? dateFromNames(names) ?? new Date().toISOString().slice(0, 10);
  if (!ctx.nameDates && !dateFromNames(names)) warnings.push('No export date in the file name — used today; rename the file with its date to keep pulls separate.');
  const acc = new Map<string, KeywordSovRecord>();
  let skipped = 0;

  for (const r of rows) {
    const keyword = str(pick(r, ['keyword'])).toLowerCase();
    if (!keyword) {
      skipped++;
      continue;
    }
    const durationRaw = str(pick(r, ['duration']));
    const duration = durationRaw ? normDuration(durationRaw) : (fromName ?? 'unknown');
    const metrics: Record<string, number | string | null> = {};
    for (const k of NUMBER_METRICS) {
      const v = pick(r, [k]);
      metrics[k] = v == null || v === '' ? null : num(v);
    }
    for (const k of ASIN_METRICS) metrics[k] = normalizeAsin(pick(r, [k])) || null;

    acc.set(`${duration}|${keyword}`, {
      duration,
      snapshotDate,
      keyword,
      keywordType: str(pick(r, ['keywordType', 'keyword type'])).toUpperCase() || 'GENERIC',
      category: str(pick(r, ['category'])) || null,
      searches: str(pick(r, ['trafficAcrossAmazon', 'trafficSelectedSubcats', '# of Searches'])) || null,
      rank: pick(r, ['rank']) == null ? null : Math.trunc(num(pick(r, ['rank']))),
      mostClickedOrganicAsin: normalizeAsin(pick(r, ['mostClickedOrganicAsin'])) || null,
      mostClickedSpAsin: normalizeAsin(pick(r, ['mostClickedSpAsin'])) || null,
      metrics,
    });
  }
  if (skipped) warnings.push(`${skipped} row(s) skipped: no keyword.`);
  const records = [...acc.values()];
  if (!records.length && rows.length) return { records, rowsRead: rows.length, warnings, error: 'No keyword rows.' };
  return { records, rowsRead: rows.length, warnings };
}
