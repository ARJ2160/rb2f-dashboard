import { normKey } from '@dash/shared/blinkit';

export interface SheetData {
  fileName: string;
  sheetName: string;
  /** rows above the header row (e.g. "This sheet was generated at …") */
  preamble: unknown[][];
  /** normKey'd header cells, positional (duplicates allowed) */
  headers: string[];
  rawHeaders: string[];
  rows: unknown[][];
}

/** Header cells that identify a real header row for any Blinkit report. */
const HEADER_TOKENS = new Set([
  'order id', 'order date', 'item id', 'product name', 'quantity', 'total gross bill amount', 'customer city',
  'date', 'campaign id', 'campaign name', 'targeting type', 'targeting value', 'impressions', 'estimated budget consumed',
  'warehouse facility id', 'warehouse facility name', 'total sellable', 'last 7 days', 'item name',
  'sku', 'category', 'city', 'price',
]);

export function findHeaderRow(grid: unknown[][]): number {
  let best = -1, bestScore = 0;
  for (let i = 0; i < Math.min(grid.length, 20); i++) {
    const score = (grid[i] ?? []).filter((c) => c != null && HEADER_TOKENS.has(normKey(c))).length;
    if (score > bestScore) { best = i; bestScore = score; }
    if (score >= 4) return i;
  }
  return bestScore >= 2 ? best : -1;
}

/** First column index whose normalised header equals / starts with one of `names`. */
export function col(headers: string[], ...names: string[]): number {
  for (const n of names) { const i = headers.indexOf(n); if (i >= 0) return i; }
  for (const n of names) { const i = headers.findIndex((h) => h.startsWith(n)); if (i >= 0) return i; }
  return -1;
}

/** Raw grid (array of rows) → SheetData with the header row located by content. */
export function sheetFromGrid(grid: unknown[][], fileName: string, sheetName: string): SheetData {
  const h = findHeaderRow(grid);
  if (h < 0) return { fileName, sheetName, preamble: grid.slice(0, 5), headers: [], rawHeaders: [], rows: [] };
  const rawHeaders = (grid[h] ?? []).map((c) => (c == null ? '' : String(c).trim()));
  return {
    fileName, sheetName, preamble: grid.slice(0, h), rawHeaders, headers: rawHeaders.map(normKey),
    rows: grid.slice(h + 1).filter((r) => r.some((c) => c != null && c !== '')),
  };
}
