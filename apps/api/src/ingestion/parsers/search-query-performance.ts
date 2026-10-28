import { monthFromName, datesFromFilename } from '../../lib/dates';
import { num, pick, str, type Row } from '../../lib/values';
import type { ParseContext, ParseResult } from './types';

/**
 * Brand Analytics "Search Query Performance" (Brand View) — ported from the
 * eigen amazon-data-processor.
 *
 * Unlike every other report this one is published per reporting PERIOD
 * (week / month / quarter) with no per-day breakdown, so rows are keyed on the
 * period's bounds instead of a date. It also has no ASIN or campaign, so
 * neither mapper applies and it carries no category.
 *
 * Only raw counts are stored. Amazon's own rate columns are ignored: their
 * denominators differ from the brand-vs-category comparison the SQP tab
 * makes, and a stored rate can't be re-aggregated.
 */
export interface SqpRecord {
  periodStart: string;
  periodEnd: string;
  searchQuery: string;
  volume: number;
  impressionsTotal: number;
  impressionsBrand: number;
  clicksTotal: number;
  clicksBrand: number;
  cartAddsTotal: number;
  cartAddsBrand: number;
  purchasesTotal: number;
  purchasesBrand: number;
}

const QUERY = ['Search Query', 'Search Term', 'Query'];
const VOLUME = ['Search Query Volume', 'Query Volume', 'Search Volume', 'Volume'];

/** Total = whole category for the query; Brand = this seller's share. Colon-joined and spaced spellings both occur. */
const COLUMNS = {
  impressionsTotal: ['Impressions: Total Count', 'Impressions Total Count', 'Total Impression Count'],
  impressionsBrand: ['Impressions: Brand Count', 'Impressions Brand Count', 'Brand Impression Count'],
  clicksTotal: ['Clicks: Total Count', 'Clicks Total Count', 'Total Click Count'],
  clicksBrand: ['Clicks: Brand Count', 'Clicks Brand Count', 'Brand Click Count'],
  cartAddsTotal: ['Cart Adds: Total Count', 'Cart Adds Total Count', 'Total Cart Add Count'],
  cartAddsBrand: ['Cart Adds: Brand Count', 'Cart Adds Brand Count', 'Brand Cart Add Count'],
  purchasesTotal: ['Purchases: Total Count', 'Purchases Total Count', 'Total Purchase Count'],
  purchasesBrand: ['Purchases: Brand Count', 'Purchases Brand Count', 'Brand Purchase Count'],
} as const;
type CountKey = keyof typeof COLUMNS;

/** Lower-cased, whitespace-collapsed, Excel's leading apostrophe stripped — the join key to search-term targets. */
export function normaliseQuery(raw: unknown): string {
  return str(raw).replace(/^'+/, '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Some exports carry a two-row header: a group row ("Impressions", "Clicks",
 * "Cart Adds", "Purchases") above the row naming the columns ("Total Count",
 * "Brand Count"). The sheet reader then takes the group row as the header and
 * the real header arrives as the first data row. Detect that and rebuild the
 * keys as "Impressions: Brand Count", matching the single-row layout.
 */
export function rekeyTwoRowHeader(headers: string[], rows: Row[]): { headers: string[]; rows: Row[] } {
  const first = rows[0];
  if (!first || headers.some((h) => /^search query$/i.test(h.trim()))) return { headers, rows };
  const values = headers.map((h) => str(first[h]));
  const looksLikeHeader = values.some((v) => /^search query$/i.test(v)) && values.some((v) => /count$/i.test(v) || /^search query volume$/i.test(v));
  if (!looksLikeHeader) return { headers, rows };

  let group = '';
  const newHeaders = headers.map((h, i) => {
    if (!/^__col_\d+$/.test(h) && h.trim()) group = h.trim().replace(/\s*\(\d+\)$/, '');
    const own = values[i] ?? '';
    if (!own) return h;
    if (/^search query/i.test(own) || /^reporting date$/i.test(own) || !group) return own;
    return `${group}: ${own}`;
  });
  return {
    headers: newHeaders,
    rows: rows.slice(1).map((r) => Object.fromEntries(headers.map((h, i) => [newHeaders[i] ?? h, r[h]]))),
  };
}

const pad = (n: number) => String(n).padStart(2, '0');
const isoOf = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const order = (a: string, b: string) => (a <= b ? { from: a, to: b } : { from: b, to: a });

/**
 * Reporting period from Amazon's metadata line above the header, e.g.
 *   Brand=["Cult"] Reporting Range=["Weekly"] Select week=["Week 41 | 2026-10-05 - 2026-10-11 2026"]
 *   Select month=["October 2026"]      Select quarter=["Q3 2026"]
 */
export function periodFromPreamble(preamble: string[]): { from: string; to: string } | null {
  const text = preamble.join(' ');
  const isoPair = text.match(/(20\d{2}-\d{2}-\d{2})\s*(?:-|–|to)\s*(20\d{2}-\d{2}-\d{2})/i);
  if (isoPair) return order(isoPair[1]!, isoPair[2]!);

  const quarter = text.match(/\bQ([1-4])\s*[-/ ]?\s*(20\d{2})\b/i) ?? text.match(/\b(20\d{2})\s*[-/ ]?\s*Q([1-4])\b/i);
  if (quarter && /quarter/i.test(text)) {
    const [q, y] = /^20/.test(quarter[1]!) ? [Number(quarter[2]), Number(quarter[1])] : [Number(quarter[1]), Number(quarter[2])];
    const m1 = (q - 1) * 3 + 1;
    return { from: isoOf(y, m1, 1), to: isoOf(y, m1 + 2, lastDay(y, m1 + 2)) };
  }

  if (/month/i.test(text)) {
    const mm = text.match(/\b([A-Za-z]{3,9})\s+(20\d{2})\b/g) ?? [];
    for (const hit of mm) {
      const [name, year] = hit.split(/\s+/);
      const m = monthFromName(name!);
      if (m) {
        const y = Number(year);
        return { from: isoOf(y, m, 1), to: isoOf(y, m, lastDay(y, m)) };
      }
    }
  }
  return null;
}

/** "…_20261005_20261011.csv" (GCS warehouse naming), ISO dates or "1 July - 31 July" in a file or sheet name. */
export function periodFromName(name: string): { from: string; to: string } | null {
  const m = name.match(/(20\d{2})(\d{2})(\d{2})\D+(20\d{2})(\d{2})(\d{2})(?!\d)/);
  if (m) return order(isoOf(+m[1]!, +m[2]!, +m[3]!), isoOf(+m[4]!, +m[5]!, +m[6]!));
  const r = datesFromFilename(name);
  // A single date is not a period — SQP files are always a range.
  return r && r.from !== r.to ? r : null;
}

/** Parse a Search Query Performance (Brand View) sheet. `names` = sheet name and file name, tried in order. */
export function parseSearchQueryPerformance(
  headersIn: string[],
  rowsIn: Row[],
  ctx: ParseContext,
  names: string[]
): ParseResult<SqpRecord> & { period: { from: string; to: string } | null } {
  const { rows } = rekeyTwoRowHeader(headersIn, rowsIn);
  const period =
    periodFromPreamble(ctx.preamble) ??
    names.map(periodFromName).find((p) => p != null) ??
    (ctx.nameDates && ctx.nameDates.from !== ctx.nameDates.to ? ctx.nameDates : null);

  if (!period) {
    return {
      records: [],
      rowsRead: rows.length,
      warnings: [],
      period: null,
      error:
        'Search Query Performance is stored per reporting period, but this file has neither Amazon\'s "Select week / month / quarter" line above the header nor a date range in its name (e.g. "Search_Query_Performance_1_July_-_31_July.csv"). Nothing was stored.',
    };
  }

  const acc = new Map<string, SqpRecord>();
  let sawMetric = false;
  for (const r of rows) {
    const searchQuery = normaliseQuery(pick(r, QUERY));
    if (!searchQuery) continue;
    const counts = Object.fromEntries(
      (Object.keys(COLUMNS) as CountKey[]).map((k) => [k, num(pick(r, COLUMNS[k]))])
    ) as Record<CountKey, number>;
    if (Object.values(counts).some((v) => v > 0)) sawMetric = true;

    const cur =
      acc.get(searchQuery) ??
      {
        periodStart: period.from,
        periodEnd: period.to,
        searchQuery,
        volume: 0,
        impressionsTotal: 0,
        impressionsBrand: 0,
        clicksTotal: 0,
        clicksBrand: 0,
        cartAddsTotal: 0,
        cartAddsBrand: 0,
        purchasesTotal: 0,
        purchasesBrand: 0,
      };
    // Volume belongs to the query, not the row: casing variants of one query report the same volume.
    cur.volume = Math.max(cur.volume, num(pick(r, VOLUME)));
    for (const k of Object.keys(COLUMNS) as CountKey[]) cur[k] += counts[k];
    acc.set(searchQuery, cur);
  }

  const records = [...acc.values()].map((r) => {
    const out = { ...r };
    for (const k of ['volume', ...Object.keys(COLUMNS)] as Array<'volume' | CountKey>) out[k] = Math.round(out[k]);
    return out;
  });
  if (records.length && !sawMetric) {
    return {
      records: [],
      rowsRead: rows.length,
      warnings: [],
      period,
      error: `Recognised as Search Query Performance (${records.length} queries), but none of the Impressions / Clicks / Cart Adds / Purchases "Total Count" and "Brand Count" columns were found, so every number would be 0. Nothing was stored. Re-export the Brand View report without editing its header rows.`,
    };
  }
  return { records, rowsRead: rows.length, warnings: [], period };
}
