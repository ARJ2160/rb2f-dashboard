import { isIsoDate } from '@dash/shared';

/** Excel serial (days since 1899-12-30) → ISO date. */
export function excelSerialToIso(serial: number): string | null {
  if (!Number.isFinite(serial) || serial <= 0) return null;
  const d = new Date(Math.round((serial - 25569) * 86_400_000));
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

export function monthFromName(name: string): number | null {
  const k = name.toLowerCase();
  return MONTHS[k] ?? MONTHS[k.slice(0, 3)] ?? null;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

function valid(s: string): string | null {
  return isIsoDate(s) ? s : null;
}

/**
 * Parse a report date cell to ISO YYYY-MM-DD.
 *
 * Handles Date objects, Excel serials, ISO strings/timestamps, D/M/Y and
 * M/D/Y (ambiguous slash dates default to D/M/Y — Amazon India locale; a
 * middle part > 12 forces M/D/Y), 2-digit years, and "10 Apr 2026" /
 * "Apr 10, 2026" free text.
 */
export function parseDateCell(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (raw instanceof Date) return Number.isNaN(raw.getTime()) ? null : raw.toISOString().slice(0, 10);
  if (typeof raw === 'number') return plausible(excelSerialToIso(raw));

  const s = String(raw).trim();
  if (!s) return null;

  const isoMatch = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoMatch) return valid(isoMatch.slice(1, 4).join('-'));

  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/);
  if (slash) {
    const a = Number(slash[1]);
    const b = Number(slash[2]);
    let y = Number(slash[3]);
    if (y < 100) y += 2000;
    // b > 12 → it can't be a month → M/D/Y; otherwise D/M/Y (India default).
    return b > 12 ? valid(iso(y, a, b)) : valid(iso(y, b, a));
  }

  const dmy = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s,-]+(\d{4})$/);
  if (dmy) {
    const m = monthFromName(dmy[2]!);
    if (m) return valid(iso(Number(dmy[3]), m, Number(dmy[1])));
  }
  const mdy = s.match(/^([A-Za-z]{3,9})[\s-]+(\d{1,2}),?[\s-]+(\d{4})$/);
  if (mdy) {
    const m = monthFromName(mdy[1]!);
    if (m) return valid(iso(Number(mdy[3]), m, Number(mdy[2])));
  }

  if (/^\d+(\.\d+)?$/.test(s)) return plausible(excelSerialToIso(Number(s)));
  return null;
}

/** Rejects values that parse but can't be a reporting date (e.g. a metric mistaken for a serial). */
export function plausible(isoDate: string | null): string | null {
  if (!isoDate) return null;
  const y = Number(isoDate.slice(0, 4));
  return y >= 2015 && y <= 2040 ? isoDate : null;
}

/** Most recent year in which (month, day) is not in the future. */
export function inferYear(month: number, day: number, now = new Date()): number {
  const y = now.getUTCFullYear();
  const candidate = Date.UTC(y, month - 1, day);
  return candidate > now.getTime() ? y - 1 : y;
}

const MONTH_RE =
  '(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)';

/**
 * Pull a date range out of a filename. Accepts
 *   "SP_Campaign_1_June_-_3_August.xlsx", "Business 10 april.xlsx",
 *   "1JUNE-3AUG", "report_2026-04-01_2026-04-30.csv".
 * Filenames carry no year in the D-Month form, so the year is inferred as the
 * most recent non-future occurrence (a Dec→Jan range wraps the start year).
 */
export function datesFromFilename(filename: string, now = new Date()): { from: string; to: string } | null {
  const base = filename.replace(/\.(xlsx|xls|csv)$/i, '');

  const isoAll = [...base.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)].map((m) => valid(`${m[1]}-${m[2]}-${m[3]}`));
  const isoDates = isoAll.filter((d): d is string => !!d);
  if (isoDates.length >= 1) {
    const from = isoDates[0]!;
    const to = isoDates[isoDates.length > 1 ? 1 : 0]!;
    return from <= to ? { from, to } : { from: to, to: from };
  }

  const re = new RegExp(`(?<![0-9])(\\d{1,2})[\\s_-]*${MONTH_RE}(?![a-z])`, 'gi');
  const hits = [...base.matchAll(re)]
    .map((m) => ({ day: Number(m[1]), month: monthFromName(m[2]!) }))
    .filter((h): h is { day: number; month: number } => h.month != null && h.day >= 1 && h.day <= 31);
  if (hits.length === 0) return null;

  const end = hits[hits.length > 1 ? 1 : 0]!;
  const start = hits[0]!;
  const endYear = inferYear(end.month, end.day, now);
  const wraps = start.month > end.month || (start.month === end.month && start.day > end.day);
  const from = valid(iso(wraps ? endYear - 1 : endYear, start.month, start.day));
  const to = valid(iso(endYear, end.month, end.day));
  return from && to ? { from, to } : null;
}

/** "13:00", "13:00 - 14:00", "1 PM", 13, or an Excel time fraction (0.5416) → 0–23. */
export function parseHourCell(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    if (Number.isInteger(raw) && raw >= 0 && raw < 24) return raw;
    if (raw >= 0 && raw < 1) return Math.floor(raw * 24 + 1e-9);
    return null;
  }
  const s = String(raw).trim();
  const ampm = s.match(/^(\d{1,2})(?::\d{2})?\s*(am|pm)$/i);
  if (ampm) {
    const h = Number(ampm[1]) % 12;
    return /pm/i.test(ampm[2]!) ? h + 12 : h;
  }
  const m = s.match(/^(\d{1,2})(?::|$|\s|-)/);
  if (m) {
    const h = Number(m[1]);
    if (h >= 0 && h <= 23) return h;
  }
  return null;
}
