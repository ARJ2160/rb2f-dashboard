import { normKey } from '@dash/shared/blinkit';
import * as XLSX from 'xlsx';

/**
 * Pure Zepto workbook reader — buffer in, sheets out, no DB / env import.
 * The header row is found by content in the first 25 rows (the mapper CSVs have
 * a title + blank preamble above their header).
 */

export interface Sheet {
  fileName: string;
  sheetName: string;
  headers: string[];
  rows: unknown[][];
}

const TOKENS = new Set([
  // total sales
  'sales date',
  'sku id',
  'sku name',
  'gmv',
  'quantity',
  'city',
  'sku category',
  'brand name',
  'manufacturer id',
  'manufacturer name',
  // inventory
  'sku code',
  'ean',
  'sku sub category',
  'units',
  // ad reports (campaign / keyword / product)
  'campaignname',
  'campaigntype',
  'keywordname',
  'productid',
  'productname',
  'campaign id',
  'campaign name',
  'spend',
  'revenue',
  'impressions',
  'orders',
  'clicks',
  'atc',
  'category',
  // mappers
  'pvid sku id',
]);

function isBinary(buf: Buffer) {
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return true;
  return buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
}

/** Workbook / CSV → sheets with the header row located by content. */
export function readZeptoWorkbook(buf: Buffer, fileName: string): Sheet[] {
  const binary = isBinary(buf);
  // CSV: keep cells raw (Sales Date is dd-mm-yyyy; let our own date parser handle it).
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
