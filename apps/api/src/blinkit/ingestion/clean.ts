/** Numeric cleaning: ₹, commas, %, "--", blanks, scientific notation. */
export function num(v: unknown): number {
  if (v == null) return 0;
  if (typeof v === 'number') return Number.isFinite(v) ? v : 0;
  const s = String(v).replace(/[₹,%\s]/g, '').replace(/^Rs\.?/i, '');
  if (!s || s === '-' || s === '--' || /^n\/?a$/i.test(s)) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

export const str = (v: unknown): string => (v == null ? '' : String(v).trim());

/** Item / campaign IDs arrive as 10205042, 10205042.0 or "10205042". */
export function idStr(v: unknown): string {
  if (v == null || v === '') return '';
  if (typeof v === 'number') return String(Math.round(v));
  const s = String(v).trim();
  return /^\d+\.0+$/.test(s) ? s.replace(/\.0+$/, '') : s;
}

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Day-first or month-first? Blinkit's own exports are day-first (01-10-2026 =
 * 1 Oct), but the GCS warehouse's total_sales CSV is month-first (2/1/2026 =
 * 1 Feb). Decided per COLUMN, never per cell:
 *   1. a first part > 12 anywhere → day-first; a second part > 12 → month-first;
 *   2. still ambiguous (every value ≤ 12/12) → the order that puts more dates
 *      inside the file name's range (…_20260201_20260228.csv);
 *   3. otherwise day-first.
 */
export type DateOrder = 'dmy' | 'mdy';
const PARTS = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/;

/** `…_20260201_20260228…` in a file name → ['2026-02-01', '2026-02-28']. */
export function fileDateRange(fileName: string): [string, string] | null {
  const m = fileName.match(/(20\d{2})(\d{2})(\d{2})\D+(20\d{2})(\d{2})(\d{2})/);
  return m ? [`${m[1]}-${m[2]}-${m[3]}`, `${m[4]}-${m[5]}-${m[6]}`] : null;
}

export function inferDateOrder(values: unknown[], fileName = ''): DateOrder {
  let dayFirst = 0, monthFirst = 0;
  const amb: [number, number, string][] = [];
  for (const v of values) {
    if (typeof v !== 'string') continue;
    const m = v.trim().match(PARTS);
    if (!m) continue;
    const a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) dayFirst++;
    else if (b > 12 && a <= 12) monthFirst++;
    else amb.push([a, b, m[3] ?? '']);
  }
  if (dayFirst || monthFirst) return monthFirst > dayFirst ? 'mdy' : 'dmy';
  const range = fileDateRange(fileName);
  if (range && amb.length) {
    const inside = (y: string, mo: number, d: number) => {
      const iso = `${y}-${pad(mo)}-${pad(d)}`;
      return iso >= range[0] && iso <= range[1];
    };
    let dmy = 0, mdy = 0;
    for (const [a, b, y] of amb.slice(0, 2000)) {
      if (inside(y, b, a)) dmy++;
      if (inside(y, a, b)) mdy++;
    }
    if (mdy > dmy) return 'mdy';
  }
  return 'dmy';
}

/** Dates → 'YYYY-MM-DD'. Text dates are day-first unless `order` says month-first (see inferDateOrder). */
export function toISODate(v: unknown, order: DateOrder = 'dmy'): string | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') {
    // Excel serial (1900 system): day 0 = 1899-12-30 (accounts for the 1900 leap bug)
    if (v < 36526 || v > 73051) return null; // 2000-01-01 … 2099-12-31
    const d = new Date(Date.UTC(1899, 11, 30) + Math.floor(v) * 864e5);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }
  if (v instanceof Date) return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  const s = String(v).trim();
  const g = (m: RegExpMatchArray, i: number) => m[i] ?? '';
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return `${g(m, 1)}-${pad(+g(m, 2))}-${pad(+g(m, 3))}`;
  m = s.match(PARTS);
  if (m) {
    const [day, mon] = order === 'mdy' ? [+g(m, 2), +g(m, 1)] : [+g(m, 1), +g(m, 2)];
    if (mon < 1 || mon > 12 || day < 1 || day > 31) return null;
    return `${g(m, 3)}-${pad(mon)}-${pad(day)}`;
  }
  m = s.match(/^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s,]+(\d{4})/);
  if (m) {
    const mon = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'].indexOf(g(m, 2).toLowerCase());
    if (mon >= 0) return `${g(m, 3)}-${pad(mon + 1)}-${pad(+g(m, 1))}`;
  }
  return null;
}
