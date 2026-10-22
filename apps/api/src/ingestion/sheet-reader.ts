import * as XLSX from 'xlsx';

import type { Row } from '../lib/values';

export interface SheetData {
  sheetName: string;
  headers: string[];
  rows: Row[];
  /** Text of any metadata lines above the header row (Vendor Central puts "Viewing Range=[…]" here). */
  preamble: string[];
  /** True when read with `maxRows` — `rows` is only the first few rows. */
  partial?: boolean;
}

/** Header cells that identify "this is the real header row" in an Amazon export. */
const HEADER_TOKENS = [
  'asin',
  '(child) asin',
  '(parent) asin',
  'campaign name',
  'campaigns',
  'date',
  'start date',
  'sessions - total',
  'ordered revenue',
  'ordered units',
  'ordered product sales',
  'impressions',
  'category',
  'search query',
  'customer search term',
];

const HEADER_SCAN_ROWS = 20;

/**
 * Read every non-empty sheet of an .xlsx/.xls/.csv buffer into keyed rows.
 *
 * The header row is located by content rather than assumed to be row 1:
 * Vendor Central and Brand Analytics exports prepend metadata lines, and
 * hand-assembled workbooks sometimes leave a blank row at the top.
 */
export function readWorkbook(buffer: Buffer, opts: { maxRows?: number } = {}): SheetData[] {
  // For CSV/text, `raw: true` stops SheetJS from guessing types: otherwise it
  // reads "10/04/2026" as US M/D (4 Oct) before our India-aware date parser
  // ever sees the text. Numbers stay strings and are cleaned by `num()`.
  const wb = XLSX.read(buffer, {
    type: 'buffer',
    cellDates: false,
    cellNF: false,
    cellStyles: false,
    raw: !isSpreadsheetBinary(buffer),
    // Header-only preview: lets the pipeline identify a 30 MB search-term
    // export (and skip it) without parsing every row.
    ...(opts.maxRows ? { sheetRows: opts.maxRows } : {}),
  });
  const out: SheetData[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws || !ws['!ref']) continue;

    // Values (raw numbers / serial dates) for the body…
    const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: '', blankrows: false });
    if (aoa.length === 0) continue;
    // …and formatted text for header detection (a date-typed header cell
    // would otherwise come back as a serial number).
    const textAoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
      header: 1,
      raw: false,
      defval: '',
      blankrows: false,
      range: headerRange(ws),
    });

    const headerIdx = findHeaderRow(textAoa);
    if (headerIdx < 0) continue;

    const headers = dedupeHeaders((textAoa[headerIdx] ?? []).map((c) => String(c ?? '').trim()));
    const preamble = textAoa
      .slice(0, headerIdx)
      .map((r) => r.map((c) => String(c ?? '').trim()).filter(Boolean).join(' '))
      .filter(Boolean);

    const rows: Row[] = [];
    for (let i = headerIdx + 1; i < aoa.length; i++) {
      const arr = aoa[i] ?? [];
      if (arr.every((c) => c === '' || c == null)) continue;
      const row: Row = {};
      headers.forEach((h, c) => {
        row[h] = arr[c] ?? '';
      });
      // Keep cells beyond the header width (e.g. a metadata line of a second
      // export pasted below the first) so parsers can still read them.
      for (let c = headers.length; c < arr.length; c++) {
        if (arr[c] !== '' && arr[c] != null) row[`__extra_${c}`] = arr[c];
      }
      rows.push(row);
    }

    out.push({ sheetName, headers, rows, preamble, ...(opts.maxRows ? { partial: true } : {}) });
  }
  return out;
}

/** .xlsx (zip, "PK") or legacy .xls (OLE2 compound file) — anything else is treated as text/CSV. */
function isSpreadsheetBinary(buf: Buffer): boolean {
  if (buf.length >= 2 && buf[0] === 0x50 && buf[1] === 0x4b) return true;
  return buf.length >= 4 && buf[0] === 0xd0 && buf[1] === 0xcf && buf[2] === 0x11 && buf[3] === 0xe0;
}

function headerRange(ws: XLSX.WorkSheet): XLSX.Range {
  const r = XLSX.utils.decode_range(ws['!ref']!);
  return { s: r.s, e: { r: Math.min(r.e.r, r.s.r + HEADER_SCAN_ROWS - 1), c: r.e.c } };
}

function findHeaderRow(textAoa: unknown[][]): number {
  let firstNonTrivial = -1;
  for (let i = 0; i < Math.min(textAoa.length, HEADER_SCAN_ROWS); i++) {
    const cells = (textAoa[i] ?? []).map((c) => String(c ?? '').trim().toLowerCase()).filter(Boolean);
    if (cells.length < 2) continue;
    if (firstNonTrivial < 0) firstNonTrivial = i;
    if (cells.some((c) => HEADER_TOKENS.includes(c))) return i;
  }
  return firstNonTrivial;
}

function dedupeHeaders(raw: string[]): string[] {
  const seen = new Map<string, number>();
  return raw.map((h, i) => {
    const base = h || `__col_${i}`;
    const n = seen.get(base) ?? 0;
    seen.set(base, n + 1);
    return n === 0 ? base : `${base} (${n + 1})`;
  });
}
