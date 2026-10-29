import * as XLSX from 'xlsx';

import { sheetFromGrid, type SheetData } from './sheet-grid';

/** Large multi-tab workbooks (e.g. a brand master sheet) are only scanned for
    tabs that can hold a Blinkit report or mapper, to keep memory sane. */
const LARGE_BOOK_BYTES = 15 * 1024 * 1024;
const RELEVANT_TAB = /(mapper|sku|inventory|stock|soh|sales summary|product_listing|banner_listing|product_recommendation)/i;

/** .xlsx (zip "PK") or legacy .xls (OLE2) — anything else is text / CSV. */
function isBinary(buf: Buffer): boolean {
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return true;
  return buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
}

export function readBlinkitWorkbook(buf: Buffer, fileName: string): { sheets: SheetData[]; skippedTabs: string[] } {
  const binary = isBinary(buf);
  let only: string[] | undefined;
  const skippedTabs: string[] = [];
  if (binary && buf.length > LARGE_BOOK_BYTES) {
    const names = XLSX.read(buf, { type: 'buffer', bookSheets: true }).SheetNames;
    only = names.filter((n) => RELEVANT_TAB.test(n));
    skippedTabs.push(...names.filter((n) => !RELEVANT_TAB.test(n)));
  }
  const wb = XLSX.read(buf, {
    type: 'buffer',
    // CSV: never let SheetJS guess dates — Blinkit writes dd-mm-yyyy.
    raw: !binary,
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    ...(only ? { sheets: only } : {}),
  });
  const sheets: SheetData[] = [];
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name];
    if (!ws || !ws['!ref']) continue;
    const grid = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: null, blankrows: false });
    sheets.push(sheetFromGrid(grid, fileName, name));
  }
  return { sheets, skippedTabs };
}
