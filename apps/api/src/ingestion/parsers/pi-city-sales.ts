import { normalizeIndianState } from '../../lib/states';
import { normalizeAsin, num, pick, round2, str, type Row } from '../../lib/values';
import type { ParseContext, ParseResult } from './types';

export interface PiCitySalesRecord {
  date: string;
  asin: string;
  state: string;
  city: string;
  postalCode: string;
  grossSales: number;
  grossUnits: number;
  netSales: number;
  netUnits: number;
  indexedGlanceViews: number;
  title: string | null;
}

/** "7","2026" with a day → 2026-07-01 (zero-padded). Returns null if day/month/year missing. */
function isoDate(r: Row): string | null {
  const d = Math.trunc(num(pick(r, ['orderDay', 'order day'])));
  const m = Math.trunc(num(pick(r, ['orderMonth', 'order month'])));
  const y = Math.trunc(num(pick(r, ['orderYear', 'order year'])));
  if (!d || !m || !y) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * Amazon Pi "ASIN-wise Sales + Indexed GVs at City Level" → one row per
 * ASIN × day × city (postal code). Several source rows for the same key are
 * summed. State is normalised to match the India map; city/postal kept as-is.
 */
export function parsePiCitySales(rows: Row[], ctx: ParseContext): ParseResult<PiCitySalesRecord> {
  const warnings: string[] = [];
  const acc = new Map<string, PiCitySalesRecord>();
  const titles = new Map<string, string>();
  let undated = 0;

  for (const r of rows) {
    const date = isoDate(r);
    if (!date) {
      undated++;
      continue;
    }
    const asin = normalizeAsin(pick(r, ['asin', 'ASIN']));
    const state = normalizeIndianState(pick(r, ['stateName', 'state name', 'state']));
    const city = str(pick(r, ['city', 'City'])).toUpperCase() || '(unknown)';
    const postalCode = str(pick(r, ['postalCode', 'postal code', 'pincode', 'postal_code']));
    const title = str(pick(r, ['itemName', 'item name', 'title'])) || null;
    if (asin && title) titles.set(asin, title);

    const key = `${date}|${asin}|${state}|${city}|${postalCode}`;
    const cur =
      acc.get(key) ??
      { date, asin, state, city, postalCode, grossSales: 0, grossUnits: 0, netSales: 0, netUnits: 0, indexedGlanceViews: 0, title };
    cur.grossSales += num(pick(r, ['grossSales', 'gross sales']));
    cur.grossUnits += num(pick(r, ['grossUnits', 'gross units']));
    cur.netSales += num(pick(r, ['netSales', 'net sales']));
    cur.netUnits += num(pick(r, ['netUnits', 'net units']));
    cur.indexedGlanceViews += num(pick(r, ['indexedGlanceViews', 'indexed glance views']));
    acc.set(key, cur);
  }

  if (undated) warnings.push(`${undated} row(s) skipped: missing order day / month / year.`);
  const records = [...acc.values()].map((r) => ({
    ...r,
    grossSales: round2(r.grossSales),
    netSales: round2(r.netSales),
    indexedGlanceViews: round2(r.indexedGlanceViews),
    title: r.asin ? (titles.get(r.asin) ?? r.title) : r.title,
  }));
  if (!records.length && rows.length) return { records, rowsRead: rows.length, warnings, error: 'No dated sales rows.' };
  return { records, rowsRead: rows.length, warnings };
}
