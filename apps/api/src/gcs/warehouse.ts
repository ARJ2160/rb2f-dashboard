import type { AdChannel } from '@dash/shared';

import { datesFromFilename } from '../lib/dates';
import { hasColumn, num, pick, str, type Row } from '../lib/values';

/**
 * The RB2F warehouse layout (GCS route only) — pure helpers, no I/O.
 *
 * The warehouse stores Amazon Ads exports in the NEW Amazon Ads console
 * format, which differs from the classic exports the upload parsers expect:
 *
 *   classic                         warehouse
 *   ─────────────────────────────── ─────────────────────────────────────
 *   Date / Start Date               Day of Month + Month + Year
 *   Campaign Name                   Campaign name
 *   Spend                           Total cost
 *   7/14 Day Total Sales            Sales            (promoted + halo)
 *   7/14 Day Total Units (#)        Units sold       (campaign file: only Purchases)
 *   one file per SP / SB / SD       ONE file for all ad products; only the
 *                                   campaign file says which ("Ad product")
 *   Advertised ASIN                 Advertised product ID
 *   Customer Search Term            Search term      (no Targeting / Match Type)
 *   Placement                       Placement classification
 *
 * and the Business Report's "Date" column holds only the day of the month
 * (1–31); month and year come from the file name (`…_20260401_20260430.csv`).
 *
 * Each warehouse sheet is rewritten into classic column names, split by ad
 * channel, and handed to the existing parsers, so every report screen uses
 * exactly the same logic for uploaded and warehouse data.
 */

export type WarehouseAdKind = 'campaign' | 'advertised' | 'placement' | 'search_term';

const DAY_PARTS = ['Day of Month', 'Month', 'Year'];

/** Which warehouse ad export a sheet is (by columns), or null. */
export function detectWarehouseAdKind(headers: string[]): WarehouseAdKind | null {
  const has = (...a: string[]) => hasColumn(headers, a);
  if (!DAY_PARTS.every((c) => has(c)) || !has('Campaign name')) return null;
  if (has('Ad product')) return 'campaign';
  if (has('Advertised product ID')) return 'advertised';
  if (has('Placement classification')) return 'placement';
  if (has('Search term')) return 'search_term';
  return null;
}

const iso = (y: number, m: number, d: number) =>
  `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;

/** Day of Month + Month + Year → ISO date (null when any part is missing/invalid). */
export function rowDate(r: Row): string | null {
  const d = Math.trunc(num(pick(r, ['Day of Month'])));
  const m = Math.trunc(num(pick(r, ['Month'])));
  const y = Math.trunc(num(pick(r, ['Year'])));
  if (!(y >= 2015 && y <= 2040 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const out = iso(y, m, d);
  // Rejects 31 April etc.
  return new Date(`${out}T00:00:00Z`).getUTCDate() === d ? out : null;
}

/** "Sponsored Products" → sp, "Sponsored Brands (Video)" → sb, "Sponsored Display" → sd. */
export function channelFromAdProduct(raw: unknown): AdChannel | null {
  const s = str(raw).toLowerCase();
  if (s.includes('product')) return 'sp';
  if (s.includes('brand')) return 'sb';
  if (s.includes('display')) return 'sd';
  return null;
}

/** RB naming convention "RB/SP/KT/…", "RB/SBV/…", "…/SD/…" → channel. */
export function channelFromCampaignName(name: string): AdChannel | null {
  const m = name.match(/(?:^|[/|_\s-])(SP|SBV|SB|SDV|SD)(?=$|[/|_\s-])/i);
  if (!m) return null;
  const t = m[1]!.toUpperCase();
  return t === 'SP' ? 'sp' : t.startsWith('SB') ? 'sb' : 'sd';
}

/**
 * Warehouse placement classification → a label the shared placement
 * normaliser maps to TOS / ROS / PDP. Amazon's new console reports Rest of
 * Search as "Other on-Amazon".
 */
export function placementLabel(raw: unknown): string {
  const s = str(raw);
  const l = s.toLowerCase();
  if (!s) return 'Unknown';
  if (l.startsWith('other on-amazon') || l === 'other') return 'Rest of Search (Other on-Amazon)';
  if (l.startsWith('homepage')) return 'Homepage';
  return s;
}

/** Targeting type from the RB campaign naming convention ("RB/SP/KT/…"). */
export function targetingFromCampaignName(name: string): 'KT' | 'PT' | 'CT' | 'AUTO' | null {
  const n = `/${name.toUpperCase()}/`;
  if (/[/\s]AUTO[/\s]/.test(n)) return 'AUTO';
  const m = n.match(/\/\s*(KT|PT|CT)\s*\//);
  return (m?.[1] as 'KT' | 'PT' | 'CT' | undefined) ?? null;
}

/** ASIN used for advertised rows whose product can't be identified (spend still counts; category "Unmapped"). */
export const UNRESOLVED_ASIN = 'UNKNOWN';

/** Title key for matching "Advertised product name" to an ASIN: case- and whitespace-insensitive. */
export const titleKey = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * Title → ASIN lookup from rows that carry both (advertised rows with an ID)
 * plus known product titles. Ambiguous titles (two ASINs) resolve to nothing.
 */
export function buildTitleIndex(
  pairs: Array<[title: string, asin: string]>
): (title: string) => string | null {
  const m = new Map<string, string | null>();
  for (const [title, asin] of pairs) {
    const k = titleKey(title);
    const a = asin.trim().toUpperCase();
    if (!k || !a) continue;
    const prev = m.get(k);
    m.set(k, prev === undefined || prev === a ? a : null);
  }
  return (title) => m.get(titleKey(title)) ?? null;
}

export interface ClassicSheet {
  headers: string[];
  rows: Row[];
}

/**
 * Rewrite warehouse rows into the classic export columns the upload parsers
 * read, grouped by ad channel. `resolveChannel` maps a campaign to SP/SB/SD.
 */
export function toClassicByChannel(
  kind: WarehouseAdKind,
  rows: Row[],
  resolveChannel: (campaignName: string, row: Row) => AdChannel | null,
  resolveAsinByTitle: (title: string) => string | null = () => null
): {
  byChannel: Map<AdChannel, ClassicSheet>;
  undated: number;
  unknownChannel: number;
  unresolvedAsin: number;
} {
  const byChannel = new Map<AdChannel, ClassicSheet>();
  let undated = 0;
  let unknownChannel = 0;
  let unresolvedAsin = 0;
  for (const r of rows) {
    const campaignName = str(pick(r, ['Campaign name']));
    if (!campaignName) continue;
    const date = rowDate(r);
    if (!date) {
      undated++;
      continue;
    }
    const channel =
      (kind === 'campaign' ? channelFromAdProduct(pick(r, ['Ad product'])) : null) ??
      resolveChannel(campaignName, r);
    if (!channel) {
      unknownChannel++;
      continue;
    }
    const base: Row = {
      Date: date,
      'Campaign Name': campaignName,
      'Ad Group Name': str(pick(r, ['Ad group name'])),
      Impressions: pick(r, ['Impressions']) ?? 0,
      Clicks: pick(r, ['Clicks']) ?? 0,
      Spend: pick(r, ['Total cost']) ?? 0,
      'Total Sales': pick(r, ['Sales']) ?? 0,
    };
    let row: Row;
    if (kind === 'campaign') {
      // The campaign export has no unit count — orders stand in (the parser warns).
      row = { ...base, 'Total Orders (#)': pick(r, ['Purchases']) ?? 0 };
    } else {
      row = { ...base, 'Total Units': pick(r, ['Units sold']) ?? 0 };
      if (kind === 'advertised') {
        // SB rows come without "Advertised product ID" — only the product name — so the ASIN is looked up by title.
        let asin =
          str(pick(r, ['Advertised product ID'])) ||
          resolveAsinByTitle(str(pick(r, ['Advertised product name'])));
        if (!asin) {
          unresolvedAsin++;
          asin = UNRESOLVED_ASIN;
        }
        row['Advertised ASIN'] = asin;
      }
      if (kind === 'placement') row.Placement = placementLabel(pick(r, ['Placement classification']));
      if (kind === 'search_term') {
        row['Customer Search Term'] = str(pick(r, ['Search term']));
        // No targeting columns in this export: the targeting type comes from the campaign name (KT/PT/CT/Auto).
        row['Match Type'] = targetingFromCampaignName(campaignName) ?? '';
      }
    }
    const sheet = byChannel.get(channel) ?? { headers: [], rows: [] };
    sheet.rows.push(row);
    byChannel.set(channel, sheet);
  }
  for (const s of byChannel.values()) s.headers = Object.keys(s.rows[0] ?? {});
  return { byChannel, undated, unknownChannel, unresolvedAsin };
}

// ── Business Report: "Date" = day of month, month/year from the file name ──

/** `…_20260401_20260430.csv` (also ISO / "1 April" forms) → date range. */
export function warehouseNameDates(filename: string): { from: string; to: string } | null {
  const m = filename.match(/(20\d{2})(\d{2})(\d{2})\D+(20\d{2})(\d{2})(\d{2})(?!\d)/);
  if (m) {
    const from = iso(+m[1]!, +m[2]!, +m[3]!);
    const to = iso(+m[4]!, +m[5]!, +m[6]!);
    if (!Number.isNaN(Date.parse(from)) && !Number.isNaN(Date.parse(to)))
      return from <= to ? { from, to } : { from: to, to: from };
  }
  const one = filename.match(/(?:^|\D)(20\d{2})(\d{2})(\d{2})(?!\d)/);
  if (one) {
    const d = iso(+one[1]!, +one[2]!, +one[3]!);
    if (!Number.isNaN(Date.parse(d))) return { from: d, to: d };
  }
  return datesFromFilename(filename);
}

const isDayNumber = (v: unknown) => /^\s*([1-9]|[12]\d|3[01])\s*$/.test(String(v ?? ''));

/** True when the sheet's Date column carries only day-of-month numbers. */
export function hasDayOfMonthDates(headers: string[], rows: Row[]): boolean {
  if (!hasColumn(headers, ['Date'])) return false;
  const vals = rows.map((r) => pick(r, ['Date'])).filter((v) => v !== undefined && v !== '');
  return vals.length > 0 && vals.every(isDayNumber);
}

/**
 * Replace day-of-month "Date" cells with ISO dates inside `range`. Rows are
 * in date order; when the day number drops (31 → 1) the month advances, so a
 * multi-month export is dated correctly. Rows whose date falls outside the
 * range are left blank (the parser then reports them as undated).
 */
export function resolveDayOfMonth(
  rows: Row[],
  range: { from: string; to: string }
): { rows: Row[]; outOfRange: number } {
  let y = Number(range.from.slice(0, 4));
  let m = Number(range.from.slice(5, 7));
  let prev = 0;
  let outOfRange = 0;
  const out = rows.map((r) => {
    const raw = pick(r, ['Date']);
    if (!isDayNumber(raw)) return r;
    const d = Number(String(raw).trim());
    if (d < prev) {
      m++;
      if (m > 12) {
        m = 1;
        y++;
      }
    }
    prev = d;
    let date = iso(y, m, d);
    if (new Date(`${date}T00:00:00Z`).getUTCDate() !== d || date < range.from || date > range.to) {
      outOfRange++;
      date = '';
    }
    return { ...r, Date: date };
  });
  return { rows: out, outOfRange };
}

// ── Encoding ──

/**
 * Warehouse CSVs come as UTF-8 or Windows-1252 (titles with "–", "’").
 * SheetJS would read 1252 bytes as Latin-1 control characters, and campaign
 * names / search terms must be byte-identical across files to join, so
 * non-UTF-8 text files are converted to UTF-8 first. Binary workbooks pass
 * through untouched.
 */
export function toUtf8Csv(buf: Buffer): Buffer {
  const binary = (buf[0] === 0x50 && buf[1] === 0x4b) || (buf[0] === 0xd0 && buf[1] === 0xcf);
  if (binary) return buf;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return buf;
  } catch {
    return Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(decodeWindows1252(buf), 'utf8')]);
  }
}

// Node's TextDecoder('windows-1252') decodes as plain Latin-1 in some builds, so map 0x80–0x9F by hand.
const CP1252_HIGH = [
  0x20ac, 0x81, 0x201a, 0x192, 0x201e, 0x2026, 0x2020, 0x2021, 0x2c6, 0x2030, 0x160, 0x2039, 0x152, 0x8d,
  0x17d, 0x8f, 0x90, 0x2018, 0x2019, 0x201c, 0x201d, 0x2022, 0x2013, 0x2014, 0x2dc, 0x2122, 0x161, 0x203a,
  0x153, 0x9d, 0x17e, 0x178,
];

export function decodeWindows1252(buf: Buffer): string {
  let out = '';
  for (let i = 0; i < buf.length; i += 8192) {
    const codes = Array.from(buf.subarray(i, i + 8192), (b) =>
      b >= 0x80 && b <= 0x9f ? CP1252_HIGH[b - 0x80]! : b
    );
    out += String.fromCharCode(...codes);
  }
  return out;
}
