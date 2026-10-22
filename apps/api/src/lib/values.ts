/**
 * Tolerant cell readers for Amazon exports (rule book §9).
 *
 * Exports vary in header casing/spacing, currency symbols, thousands
 * separators and even scientific notation ("₹2.26E+3"), and the same column
 * may arrive as a number in one file and a formatted string in the next.
 */

export type Row = Record<string, unknown>;

const normKey = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** Case/whitespace-insensitive column lookup with alias fallbacks (first non-empty wins). */
export function pick(row: Row, aliases: readonly string[]): unknown {
  for (const a of aliases) {
    const v = row[a];
    if (v !== undefined && v !== null && v !== '') return v;
  }
  const want = aliases.map(normKey);
  const keys = Object.keys(row);
  for (const w of want) {
    for (const k of keys) {
      if (normKey(k) === w) {
        const v = row[k];
        if (v !== undefined && v !== null && v !== '') return v;
      }
    }
  }
  return undefined;
}

/** True if any alias exists as a column (even when empty in this row). */
export function hasColumn(headers: readonly string[], aliases: readonly string[]): boolean {
  const set = new Set(headers.map(normKey));
  return aliases.some((a) => set.has(normKey(a)));
}

/**
 * Parse a money/count cell. Strips currency symbols, thousands separators,
 * whitespace and %; keeps sign, decimal point and exponent. Handles both
 * already-numeric cells and text cells — checking only one of the two is
 * how "13,643" silently becomes 0.
 */
export function num(raw: unknown): number {
  if (raw == null || raw === '') return 0;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : 0;
  const s = String(raw)
    .trim()
    .replace(/[₹$€£¥,\s%]/g, '')
    .replace(/^INR/i, '');
  if (s === '' || s === '-' || s === '—') return 0;
  const n = Number(s);
  if (!Number.isNaN(n)) return n;
  const cleaned = Number(s.replace(/[^0-9.eE+-]/g, ''));
  return Number.isNaN(cleaned) ? 0 : cleaned;
}

/** Like `num`, but returns null when the cell is absent/blank (for "no data" vs 0). */
export function numOrNull(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  return num(raw);
}

export function str(raw: unknown): string {
  return raw == null ? '' : String(raw).trim();
}

export function normalizeAsin(raw: unknown): string {
  return str(raw).toUpperCase();
}

export const round2 = (n: number) => Math.round(n * 100) / 100;
