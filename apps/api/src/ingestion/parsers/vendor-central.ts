import { parseDateCell, plausible } from '../../lib/dates';
import { hasColumn, normalizeAsin, num, numOrNull, pick, round2, str, type Row } from '../../lib/values';
import { normalizeIndianState } from '../../lib/states';
import type { StateRecord } from './order-report';
import { singleNameDate, type ParseContext, type ParseResult, type SalesRecord } from './types';

export type VendorParseResult = ParseResult<SalesRecord> & { states: StateRecord[] };

const DATE = ['Date', 'Day', 'Start Date'];
const TITLE = ['Product Title', 'Title', 'Item Name'];
const ORDERED_REVENUE = ['Ordered Revenue'];
const ORDERED_UNITS = ['Ordered Units'];
const SHIPPED_REVENUE = ['Shipped Revenue'];
const SHIPPED_UNITS = ['Shipped Units'];
const GLANCE_VIEWS = ['Glance Views', 'Page Views'];

const ASIN_RE = /^[A-Z0-9]{10}$/;
const RANGE_RE = /(?:viewing range|reporting range)\s*=?\s*\[\s*([^\]\-–]+?)\s*[-–]\s*([^\]]+?)\s*\]/i;

/** "Viewing Range=[24/09/26 - 24/09/26]" → "2026-09-24" when the range is a single day. */
function singleDayFromText(text: string): string | null {
  const m = text.match(RANGE_RE);
  if (!m || m[1]!.trim() !== m[2]!.trim()) return null;
  return plausible(parseDateCell(m[1]!.trim()));
}

function rowText(r: Row): string {
  return Object.values(r)
    .map((v) => (v == null ? '' : String(v)))
    .join(' ');
}

/**
 * Vendor Central sales → per-ASIN per-day Sales and Units.
 *
 * Which numbers count (agreed rules, Oct 2026 — supersedes rule book §4's
 * "Ordered only"):
 *   1. Ordered Revenue / Ordered Units columns present → use those, even when
 *      Shipped columns are also present.
 *   2. No Ordered columns → use Shipped Revenue / Shipped Units.
 *   3. Shipped Revenue = 0 but Shipped Units > 0 → revenue = units × the ASIN
 *      mapper's selling price. This is done at QUERY time (the units are stored
 *      as `unpricedUnits`), so uploading or fixing the mapper later corrects
 *      revenue without re-uploading this file.
 * Vendor Central never provides Sessions (rule book §4) — left null.
 *
 * Layout: one export, or many daily exports pasted one under another (each
 * with its own "Viewing Range=[d - d]" line and header row). The row's own
 * Date column wins; otherwise the date of the block it sits in; otherwise the
 * file name. Repeated header and metadata rows are skipped. "State" view
 * exports are summed across states.
 */
export function parseVendorCentral(headers: string[], rows: Row[], ctx: ParseContext): VendorParseResult {
  const warnings: string[] = [];
  const hasDateCol = hasColumn(headers, DATE);
  const useOrdered = hasColumn(headers, ORDERED_REVENUE) || hasColumn(headers, ORDERED_UNITS);
  const hasShipped = hasColumn(headers, SHIPPED_REVENUE) || hasColumn(headers, SHIPPED_UNITS);
  const hasGlance = hasColumn(headers, GLANCE_VIEWS);

  if (!useOrdered && !hasShipped) {
    return { records: [], states: [], rowsRead: rows.length, warnings, error: 'No Ordered or Shipped Revenue/Units columns found.' };
  }
  warnings.push(
    useOrdered
      ? `Using Ordered Revenue / Ordered Units${hasShipped ? ' (Shipped columns ignored)' : ''}.`
      : 'No Ordered columns — using Shipped Revenue / Shipped Units.'
  );
  if (!hasGlance) warnings.push('No Glance Views column — Page Views will be blank for Vendor data.');

  const fileDate = singleNameDate(ctx) ?? ctx.preamble.map(singleDayFromText).find((d) => d) ?? null;
  let blockDate: string | null = fileDate;

  const acc = new Map<string, SalesRecord>();
  // "View By = State" exports also feed State Wise Data.
  const hasState = hasColumn(headers, ['State', 'Ship State', 'Ship-to State']);
  const stateAcc = new Map<string, StateRecord>();
  let undated = 0;
  let skippedLines = 0;
  let blocks = 0;
  let pricedLater = 0;

  for (const r of rows) {
    const rawAsin = normalizeAsin(pick(r, ['ASIN']));

    // A metadata line inside the sheet starts a new daily block.
    const text = rawAsin && !ASIN_RE.test(rawAsin) ? rowText(r) : '';
    if (text && RANGE_RE.test(text)) {
      blockDate = singleDayFromText(text);
      blocks++;
      continue;
    }
    // Repeated header row ("ASIN") or other non-ASIN text.
    if (rawAsin && !ASIN_RE.test(rawAsin)) {
      skippedLines++;
      continue;
    }

    const date = (hasDateCol ? plausible(parseDateCell(pick(r, DATE))) : null) ?? blockDate;
    if (!date) {
      undated++;
      continue;
    }
    const asin = rawAsin;
    const title = str(pick(r, TITLE)) || null;
    if (!asin && /^total/i.test(title ?? str(Object.values(r)[0]))) continue;

    let revenue: number;
    let units: number;
    let unpriced = 0;
    if (useOrdered) {
      revenue = num(pick(r, ORDERED_REVENUE));
      units = num(pick(r, ORDERED_UNITS));
    } else {
      revenue = num(pick(r, SHIPPED_REVENUE));
      units = num(pick(r, SHIPPED_UNITS));
      if (revenue === 0 && units > 0) {
        unpriced = units;
        pricedLater++;
      }
    }
    // Rows with nothing in them (common in State view) carry no information.
    if (revenue === 0 && units === 0) continue;

    const key = `${date}|${asin}`;
    const cur =
      acc.get(key) ??
      ({
        date,
        asin,
        source: 'vendor',
        sales: 0,
        units: 0,
        orderItems: null,
        sessions: null,
        pageViews: null,
        title,
        unpricedUnits: 0,
      } as SalesRecord);
    cur.sales += revenue;
    cur.units += units;
    cur.unpricedUnits = (cur.unpricedUnits ?? 0) + unpriced;
    if (hasGlance) {
      const gv = numOrNull(pick(r, GLANCE_VIEWS));
      cur.pageViews = (cur.pageViews ?? 0) + (gv ?? 0);
    }
    cur.title ??= title;
    acc.set(key, cur);

    if (hasState) {
      const state = normalizeIndianState(pick(r, ['State', 'Ship State', 'Ship-to State']));
      const sk = `${date}|${state}|${asin}`;
      const sc = stateAcc.get(sk) ?? { date, state, asin, units: 0, sales: 0, orders: null, unpricedUnits: 0 };
      sc.units += units;
      sc.sales += revenue;
      sc.unpricedUnits += unpriced;
      stateAcc.set(sk, sc);
    }
  }

  const days = new Set([...acc.values()].map((r) => r.date)).size;
  if (blocks) warnings.push(`Several exports stacked in one sheet — ${days} day(s) read.`);
  if (pricedLater)
    warnings.push(
      `${pricedLater} row(s) had Shipped Units but ₹0 Shipped Revenue — revenue = units × ASIN-mapper selling price.`
    );
  if (skippedLines) warnings.push(`${skippedLines} repeated header / note row(s) skipped.`);
  if (undated) warnings.push(`${undated} row(s) skipped: no date (no Date column, no single-day "Viewing Range").`);

  const records = [...acc.values()].map((r) => ({ ...r, sales: round2(r.sales) }));
  const states = [...stateAcc.values()].map((r) => ({ ...r, sales: round2(r.sales) }));
  if (hasState) warnings.push(`State view — ${new Set(states.map((x) => x.state)).size} state(s) also stored for State Wise Data.`);
  if (records.length === 0) {
    return {
      records,
      states,
      rowsRead: rows.length,
      warnings,
      error: undated
        ? 'No row could be dated. Add a Date column, keep the "Viewing Range=[d - d]" line for each day, or put a single day in the file name.'
        : 'No rows with revenue or units.',
    };
  }
  return { records, states, rowsRead: rows.length, warnings };
}
