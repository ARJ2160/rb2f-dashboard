import { normKey } from '@dash/shared/blinkit';
import * as XLSX from 'xlsx';

/**
 * Pure Swiggy Instamart workbook reader — buffer in, sheets out, no DB.
 *
 * Kept free of any database / env import so it can be loaded inside the parse
 * worker thread (see lib/parse-pool.ts). The detection and storing logic lives
 * in instamart/ingest.ts and runs on the main thread with the result below.
 */

export interface Sheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: unknown[][];
}

const TOKENS = new Set([
  'ordered date',
  'city',
  'area name',
  'store id',
  'item code',
  'product name',
  'units sold',
  'gmv',
  'base mrp',
  'metrics date',
  'campaign id',
  'campaign name',
  'ad property',
  'keyword',
  'total impressions',
  'total budget burnt',
  'sku',
  'category',
]);

function isBinary(buf: Buffer) {
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return true;
  return buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
}

/** Workbook / CSV → sheets with the header row found by content (first 20 rows). */
export function readInstamartWorkbook(buf: Buffer, fileName: string): Sheet[] {
  const binary = isBinary(buf);
  // CSV: never let SheetJS guess dates (ads write dd-mm-yyyy).
  const wb = XLSX.read(buf, {
    type: 'buffer',
    raw: !binary,
    cellDates: false,
    cellNF: false,
    cellStyles: false,
  });
  const out: Sheet[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: false,
    });
    let h = -1,
      best = 0;
    for (let i = 0; i < Math.min(grid.length, 20); i++) {
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
