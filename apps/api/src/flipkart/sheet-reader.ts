import { normKey } from '@dash/shared/blinkit';
import * as XLSX from 'xlsx';

/**
 * Pure Flipkart workbook reader — buffer in, sheets out, no DB / env import.
 * The header row is found by content in the first 25 rows (Flipkart exports can
 * carry a title / metadata preamble above the header).
 */

export interface Sheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: unknown[][];
}

// NOTE: tokens are the normalised (lower-cased, space-collapsed) header cells we
// expect across Flipkart's exports. TODO: confirm against real export headers —
// Flipkart's exact column labels are not yet pinned, so add the real spellings
// here and in the `colOf(...)` alias lists in ingest.ts when a sample lands.
const TOKENS = new Set([
  'fsn',
  'product',
  'title',
  'date',
  // traffic / total sales
  'revenue',
  'gmv',
  'units',
  'quantity',
  'impressions',
  'views',
  'clicks',
  // earn more
  'returns',
  'return units',
  'cancellations',
  'cancelled units',
  'net revenue',
  'net units',
  // ads
  'campaign',
  'campaign name',
  'campaign id',
  'spend',
  'ad spend',
  'ad sales',
  'ad units',
  'placement',
  'search term',
  'customer search term',
  'keyword',
  'match type',
  // mappers
  'category',
  'selling price',
  'sku',
  'city',
]);

function isBinary(buf: Buffer) {
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return true;
  return buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
}

/** Workbook / CSV → sheets with the header row located by content. */
export function readFlipkartWorkbook(buf: Buffer, fileName: string): Sheet[] {
  const binary = isBinary(buf);
  const wb = XLSX.read(buf, { type: 'buffer', raw: !binary, cellDates: false, cellNF: false, cellStyles: false });
  const out: Sheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
    let h = -1,
      best = 0;
    for (let i = 0; i < Math.min(grid.length, 25); i++) {
      const score = (grid[i] ?? []).filter((c) => c != null && TOKENS.has(normKey(c))).length;
      if (score > best) {
        best = score;
        h = i;
      }
    }
    if (best < 2) {
      out.push({ fileName, sheetName: name, headers: [], rows: [] });
      continue;
    }
    out.push({
      fileName,
      sheetName: name,
      headers: (grid[h] ?? []).map((c) => normKey(c)),
      rows: grid.slice(h + 1).filter((r) => r.some((c) => c != null && c !== '')),
    });
  }
  return out;
}
