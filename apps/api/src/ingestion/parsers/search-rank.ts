import { normalizeAsin, num, pick, str, type Row } from '../../lib/values';
import type { ParseContext, ParseResult } from './types';

export interface SearchRankRecord {
  asin: string;
  period: string; // YYYY-MM-01
  searchRank: number;
  category: string | null;
  subcategory: string | null;
  brand: string | null;
  title: string | null;
}

/** Amazon Pi "Product Search Ranking" → monthly organic search rank per ASIN. */
export function parseSearchRank(rows: Row[], _ctx: ParseContext): ParseResult<SearchRankRecord> {
  const warnings: string[] = [];
  const acc = new Map<string, SearchRankRecord>();
  let undated = 0;
  for (const r of rows) {
    const asin = normalizeAsin(pick(r, ['asin', 'ASIN']));
    const m = Math.trunc(num(pick(r, ['searchMonth', 'search month', 'month'])));
    const y = Math.trunc(num(pick(r, ['searchYear', 'search year', 'year'])));
    if (!asin || !m || !y || m < 1 || m > 12) {
      undated++;
      continue;
    }
    const period = `${y}-${String(m).padStart(2, '0')}-01`;
    acc.set(`${asin}|${period}`, {
      asin,
      period,
      searchRank: num(pick(r, ['searchRank', 'search rank', 'rank'])),
      category: str(pick(r, ['category'])) || null,
      subcategory: str(pick(r, ['subcategory', 'sub category'])) || null,
      brand: str(pick(r, ['lbrBrandName', 'brandName', 'brand'])) || null,
      title: str(pick(r, ['itemName', 'item name', 'title'])) || null,
    });
  }
  if (undated) warnings.push(`${undated} row(s) skipped: missing ASIN / month / year.`);
  const records = [...acc.values()];
  if (!records.length && rows.length) return { records, rowsRead: rows.length, warnings, error: 'No ranked rows.' };
  return { records, rowsRead: rows.length, warnings };
}
