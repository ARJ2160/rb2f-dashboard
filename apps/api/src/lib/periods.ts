/** MoM / WoW comparison windows (pure; UTC ISO dates, no timezone drift). */

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const iso = (x: Date) => x.toISOString().slice(0, 10);
const addDays = (s: string, n: number) => {
  const x = d(s);
  x.setUTCDate(x.getUTCDate() + n);
  return iso(x);
};
const lastDayOfMonth = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "1-21 Oct", "15-21 Oct", "28 Sep-4 Oct", "29 Dec 2026-4 Jan 2027". */
export function periodLabel(from: string, to: string): string {
  const a = d(from);
  const b = d(to);
  const day = (x: Date) => x.getUTCDate();
  const mon = (x: Date) => MONTHS[x.getUTCMonth()]!;
  if (from === to) return `${day(a)} ${mon(a)}`;
  if (a.getUTCFullYear() !== b.getUTCFullYear()) return `${day(a)} ${mon(a)} ${a.getUTCFullYear()}-${day(b)} ${mon(b)} ${b.getUTCFullYear()}`;
  if (a.getUTCMonth() !== b.getUTCMonth()) return `${day(a)} ${mon(a)}-${day(b)} ${mon(b)}`;
  return `${day(a)}-${day(b)} ${mon(b)}`;
}

/**
 * The four comparison windows for an "as of" date (the latest day with data):
 *   MTD  = 1st of the month → asOf
 *   PMTD = same days of the previous month (clamped: 31 Mar → 1–28/29 Feb)
 *   L7D  = asOf − 6 → asOf
 *   P7D  = the 7 days before L7D
 */
export function summaryPeriods(asOf: string) {
  const x = d(asOf);
  const y = x.getUTCFullYear();
  const m0 = x.getUTCMonth();
  const py = m0 === 0 ? y - 1 : y;
  const pm0 = m0 === 0 ? 11 : m0 - 1;
  const pDay = Math.min(x.getUTCDate(), lastDayOfMonth(py, pm0));
  const mtd = { from: iso(new Date(Date.UTC(y, m0, 1))), to: asOf };
  const pmtd = { from: iso(new Date(Date.UTC(py, pm0, 1))), to: iso(new Date(Date.UTC(py, pm0, pDay))) };
  const l7d = { from: addDays(asOf, -6), to: asOf };
  const p7d = { from: addDays(asOf, -13), to: addDays(asOf, -7) };
  return { mtd, pmtd, l7d, p7d };
}

/** Relative change in % ((cur − prev) / |prev|); null when there's nothing to compare against. */
export function changePct(cur: number | null, prev: number | null): number | null {
  if (cur == null || prev == null || prev === 0) return null;
  return ((cur - prev) / Math.abs(prev)) * 100;
}
