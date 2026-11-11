import { normalizeAsin, num, pick, round2, str, type Row } from '../../lib/values';
import type { ParseContext, ParseResult } from './types';

export interface AsinGvRecord {
  date: string;
  asin: string;
  glanceViews: number;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
}

const MONTHS: Record<string, number> = {
  january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/** "OCTOBER"/"10" → 10. */
function monthNum(raw: unknown): number {
  const s = str(raw).toLowerCase();
  if (MONTHS[s]) return MONTHS[s]!;
  const n = Math.trunc(num(raw));
  return n >= 1 && n <= 12 ? n : 0;
}

/** Amazon Pi "Total Indexed Glance Views — ASIN level" → one snapshot day per ASIN. */
export function parseAsinGv(rows: Row[], _ctx: ParseContext): ParseResult<AsinGvRecord> {
  const warnings: string[] = [];
  const acc = new Map<string, AsinGvRecord>();
  let undated = 0;
  for (const r of rows) {
    const asin = normalizeAsin(pick(r, ['asin', 'ASIN']));
    const d = Math.trunc(num(pick(r, ['snapshotDay', 'snapshot day', 'day'])));
    const m = monthNum(pick(r, ['monthName', 'month name', 'month']));
    const y = Math.trunc(num(pick(r, ['snapshotYear', 'snapshot year', 'year'])));
    if (!asin || !d || !m || !y) {
      undated++;
      continue;
    }
    const date = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    acc.set(`${date}|${asin}`, {
      date,
      asin,
      glanceViews: round2(num(pick(r, ['glanceViews', 'glance views']))),
      category: str(pick(r, ['category'])) || null,
      subcategory: str(pick(r, ['subcategory', 'sub category'])) || null,
      brand: str(pick(r, ['lbrBrandName', 'brandName', 'brand'])) || null,
    });
  }
  if (undated) warnings.push(`${undated} row(s) skipped: missing ASIN / snapshot date.`);
  const records = [...acc.values()];
  if (!records.length && rows.length) return { records, rowsRead: rows.length, warnings, error: 'No dated glance-view rows.' };
  return { records, rowsRead: rows.length, warnings };
}
