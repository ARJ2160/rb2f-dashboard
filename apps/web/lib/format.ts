const intFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const moneyFmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const oneDp = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export const DASH = '—';

export const fmtInt = (v: number | null | undefined) => (v == null ? DASH : intFmt.format(v));
export const fmtMoney = (v: number | null | undefined) => (v == null ? DASH : moneyFmt.format(v));
export const fmtPct = (v: number | null | undefined) => (v == null ? DASH : `${moneyFmt.format(v)}%`);
export const fmtAvg = (v: number | null | undefined) => (v == null ? DASH : oneDp.format(v));

/** "2026-04-10" → "Apr 10" (UTC, no timezone drift). */
export function fmtDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
}

export function fmtDateLong(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

export function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export function isoAddDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** ₹ amount, whole rupees, Indian grouping (₹16,73,952) — for headline cards. */
const rupeeFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const fmtRupee = (v: number | null | undefined) => (v == null ? DASH : `${v < 0 ? '-' : ''}₹${rupeeFmt.format(Math.abs(v))}`);
/** ₹ with paise (CPM / CPC). */
const rupee2Fmt = new Intl.NumberFormat('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
export const fmtRupee2 = (v: number | null | undefined) => (v == null ? DASH : `₹${rupee2Fmt.format(v)}`);
