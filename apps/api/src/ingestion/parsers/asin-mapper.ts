import { hasColumn, normalizeAsin, num, pick, str, type Row } from '../../lib/values';
import { ASIN_COLUMNS, CATEGORY_COLUMNS } from '../detect-report';
import type { MapperRecord, ParseResult } from './types';

const TITLE = ['Title', 'Product Title', 'Item Name'];
/**
 * Selling price, first non-empty per row. "BAU" (business-as-usual price) is
 * the Cult mastersheet's regular selling price; "Event Price" is the sale
 * price and only used when BAU is blank. MRP is deliberately NOT used — it is
 * a list price, not what the customer paid.
 */
export const PRICE_COLUMNS = ['Selling Price', 'Selling price', 'SP', 'Price', 'BAU', 'BAU Price', 'Event Price'] as const;
const ASIN_RE = /^[A-Z0-9]{10}$/;
const JUNK = /^(#n\/a|n\/a|na|-|—|0)$/i;

/**
 * ASIN → Category (+ optional Title). Category is the only source of truth
 * for categories (rule book §3).
 *
 * Mapper sheets differ per brand: YPLAYZ uses "ASIN" + "Category"; the Cult
 * mastersheet uses "Amazon ASIN" and has no "Category" column, only
 * "Sub-Cat" (Sports / Casual…) and "Article Type" (Running / Walking…). The
 * first column present from CATEGORY_COLUMNS is used, and the upload result
 * says which one.
 */
export function parseAsinMapper(headers: string[], rows: Row[]): ParseResult<MapperRecord> {
  const warnings: string[] = [];
  const categoryCol = CATEGORY_COLUMNS.find((c) => hasColumn(headers, [c]));
  if (!hasColumn(headers, ASIN_COLUMNS)) {
    return {
      records: [],
      rowsRead: rows.length,
      warnings,
      error: `No ASIN column found. Expected one of: ${ASIN_COLUMNS.join(', ')}.`,
    };
  }
  if (!categoryCol) {
    return {
      records: [],
      rowsRead: rows.length,
      warnings,
      error: `No category column found. Expected one of: ${CATEGORY_COLUMNS.join(', ')}.`,
    };
  }
  if (categoryCol !== 'Category') warnings.push(`No "Category" column — using "${categoryCol}" as the category.`);

  const seen = new Map<string, MapperRecord>();
  let blankCategory = 0;
  let notAsin = 0;
  let conflicting = 0;

  for (const r of rows) {
    const asin = normalizeAsin(pick(r, ASIN_COLUMNS));
    if (!asin) continue;
    // Skips repeated header rows / stray text pasted into the ASIN column.
    if (!ASIN_RE.test(asin)) {
      notAsin++;
      continue;
    }
    const rawCat = str(pick(r, [categoryCol]));
    const category = rawCat && !JUNK.test(rawCat) ? rawCat : null;
    const title = str(pick(r, TITLE)) || null;
    const priceRaw = pick(r, PRICE_COLUMNS);
    const priceNum = priceRaw == null || JUNK.test(str(priceRaw)) ? 0 : num(priceRaw);
    const sellingPrice = priceNum > 0 ? priceNum : null;
    const brand = str(pick(r, ['Brand', 'Brand Name'])) || null;

    const prev = seen.get(asin);
    if (prev) {
      // Mastersheets list the same ASIN more than once; keep the first
      // non-empty category and count genuine disagreements.
      if (prev.category && category && prev.category !== category) conflicting++;
      seen.set(asin, {
        asin,
        category: prev.category ?? category,
        title: prev.title ?? title,
        sellingPrice: prev.sellingPrice ?? sellingPrice,
        brand: prev.brand ?? brand,
      });
      continue;
    }
    seen.set(asin, { asin, category, title, sellingPrice, brand });
  }

  let noPrice = 0;
  for (const m of seen.values()) {
    if (!m.category) blankCategory++;
    if (m.sellingPrice == null) noPrice++;
  }
  const priceCol = PRICE_COLUMNS.filter((c) => hasColumn(headers, [c]));
  if (priceCol.length === 0) warnings.push('No selling-price column (Selling Price / Price / BAU / Event Price) — Vendor shipped units with ₹0 revenue cannot be valued.');
  else if (noPrice) warnings.push(`${noPrice} of ${seen.size} ASIN(s) have no selling price in ${priceCol.join(' / ')} — Vendor shipped units for them can't be valued.`);
  if (notAsin) warnings.push(`${notAsin} row(s) skipped: the ASIN cell isn't a 10-character ASIN (repeated headers, notes…).`);
  if (conflicting) warnings.push(`${conflicting} ASIN(s) appear more than once with different categories — the first one was kept.`);
  if (blankCategory) warnings.push(`${blankCategory} ASIN(s) have no ${categoryCol} — they will show as "Unmapped".`);
  if (seen.size === 0) return { records: [], rowsRead: rows.length, warnings, error: 'No ASIN rows found.' };
  return { records: [...seen.values()], rowsRead: rows.length, warnings };
}
