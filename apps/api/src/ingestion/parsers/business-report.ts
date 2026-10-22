import { parseDateCell, plausible } from '../../lib/dates';
import { normalizeAsin, num, numOrNull, pick, round2, str, type Row } from '../../lib/values';
import { singleNameDate, type ParseContext, type ParseResult, type SalesRecord } from './types';

const ASIN = ['(Child) ASIN', 'Child ASIN', 'ASIN', '(Parent) ASIN', 'Parent ASIN'];
const TITLE = ['Title', 'Product Title', 'Item Name'];
const SESSIONS = ['Sessions - Total', 'Sessions', 'Sessions – Total'];
const PAGE_VIEWS = ['Page Views - Total', 'Page Views', 'Page Views – Total'];
const UNITS = ['Units Ordered', 'Units ordered'];
const SALES = ['Ordered Product Sales', 'Ordered product sales'];
const ORDER_ITEMS = ['Total Order Items', 'Total order items'];

const DATE_HEADER_RE = /^\d{1,2}\/\d{1,2}\/\d{4}$|^\d{4}-\d{2}-\d{2}$/;

/**
 * Amazon's Business Report has no column literally named "Date" in most
 * exports. Its per-row date arrives as an explicit Date column, a column whose
 * HEADER is a date string, or a mangled header (">", blank) whose VALUE is a
 * date. (Ported from the eigen business-report mapper.)
 */
function findDateColumn(headers: string[], sample: Row | undefined): string | null {
  for (const k of headers) if (/^date$/i.test(k.trim())) return k;
  for (const k of headers) if (DATE_HEADER_RE.test(k.trim())) return k;
  if (sample) {
    for (const k of headers) {
      const t = k.trim();
      if ((t === '>' || /^__col_/.test(t)) && plausible(parseDateCell(sample[k]))) return k;
    }
    const first = headers[0];
    if (first && !ASIN.some((a) => a.toLowerCase() === first.toLowerCase()) && plausible(parseDateCell(sample[first])))
      return first;
  }
  return null;
}

/** Seller Central "Detail Page Sales and Traffic by Child Item" → per-ASIN per-day sales. */
export function parseBusinessReport(headers: string[], rows: Row[], ctx: ParseContext): ParseResult<SalesRecord> {
  const warnings: string[] = [];
  const dateCol = findDateColumn(headers, rows[0]);
  const fallbackDate = singleNameDate(ctx);

  if (!dateCol && !fallbackDate) {
    const range = ctx.nameDates ? ` (${ctx.nameDates.from} → ${ctx.nameDates.to})` : '';
    return {
      records: [],
      rowsRead: rows.length,
      warnings,
      error:
        `This Business Report has no per-row date column and its name does not identify a single day${range}. ` +
        'Export it one day at a time, or with a date column, and include the date in the filename (e.g. "Business_Report_10_April.xlsx").',
    };
  }
  if (!dateCol) warnings.push(`No date column — all rows dated ${fallbackDate} from the file/sheet name.`);

  const acc = new Map<string, SalesRecord>();
  let undated = 0;

  for (const r of rows) {
    const date = (dateCol ? plausible(parseDateCell(r[dateCol])) : null) ?? fallbackDate;
    if (!date) {
      undated++;
      continue;
    }
    const asin = normalizeAsin(pick(r, ASIN));
    const title = str(pick(r, TITLE)) || null;
    // Skip a trailing "Total" summary line, which would double count.
    if (!asin && /^total/i.test(title ?? str(Object.values(r)[0]))) continue;

    const key = `${date}|${asin}`;
    const cur =
      acc.get(key) ??
      ({ date, asin, source: 'seller', sales: 0, units: 0, orderItems: 0, sessions: 0, pageViews: null, title, unpricedUnits: null } as SalesRecord);
    cur.sales += num(pick(r, SALES));
    cur.units += num(pick(r, UNITS));
    cur.orderItems = (cur.orderItems ?? 0) + num(pick(r, ORDER_ITEMS));
    cur.sessions = (cur.sessions ?? 0) + num(pick(r, SESSIONS));
    const pv = numOrNull(pick(r, PAGE_VIEWS));
    if (pv != null) cur.pageViews = (cur.pageViews ?? 0) + pv;
    cur.title ??= title;
    acc.set(key, cur);
  }

  if (undated) warnings.push(`${undated} row(s) skipped: no readable date.`);
  const records = [...acc.values()].map((r) => ({ ...r, sales: round2(r.sales) }));
  const blank = records.filter((r) => !r.asin).length;
  if (blank) warnings.push(`${blank} row(s) had no ASIN — kept under the "missing ASIN" bucket.`);
  return { records, rowsRead: rows.length, warnings };
}
