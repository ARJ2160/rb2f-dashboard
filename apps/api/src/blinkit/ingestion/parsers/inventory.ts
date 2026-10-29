import type { SheetData } from '../sheet-grid';
import { col } from '../sheet-grid';
import { idStr, num, str } from '../clean';
import type { ParseResult } from './types';

export interface InventoryRow {
  snapshotDate: string; generatedAt: string; itemId: string; facilityId: string; itemName: string; facilityName: string; uom: string;
  netScheduled: number; incoming: number; recalled: number; sellable: number; warehouse: number; inBetween: number;
  darkstore: number; unsellable: number; damaged: number; lost: number; expired: number; nearExpiry: number;
  sold7d: number; sold15d: number; sold30d: number;
}

/** The snapshot has no per-row date. It comes from the "This sheet was
    generated at YYYY-MM-DD HH:MM:SS" line, else the file name
    ("InventoryData - 2026-10-27T191120.750.xlsx"). Neither → rejected. */
export function snapshotDateOf(s: SheetData): { date: string | null; generatedAt: string } {
  for (const row of s.preamble) for (const cell of row) {
    const m = String(cell ?? '').match(/generated at\s+(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/i);
    if (m?.[1]) return { date: m[1], generatedAt: `${m[1]} ${m[2] ?? ''}`.trim() };
  }
  const f = s.fileName.match(/(20\d{2})-(\d{2})-(\d{2})(?:T(\d{2})(\d{2})(\d{2}))?/);
  if (f) return { date: `${f[1]}-${f[2]}-${f[3]}`, generatedAt: f[4] ? `${f[1]}-${f[2]}-${f[3]} ${f[4]}:${f[5]}:${f[6]}` : '' };
  return { date: null, generatedAt: '' };
}

export function parseInventory(s: SheetData): ParseResult<InventoryRow> {
  const { date, generatedAt } = snapshotDateOf(s);
  if (!date)
    return { records: [], dates: [], rowsRead: s.rows.length,
      warnings: ['Inventory snapshot date not found (no "generated at" line and no date in the file name) — not stored'] };
  const H = s.headers;
  const c = {
    item: col(H, 'item id'), name: col(H, 'item name'), uom: col(H, 'uom'), fid: col(H, 'warehouse facility id'),
    fname: col(H, 'warehouse facility name'), net: col(H, 'net scheduled inventory'), inc: col(H, 'incoming scheduled inventory'),
    rec: col(H, 'recalled inventory'), sell: col(H, 'total sellable'), wh: col(H, 'warehouse'), ib: col(H, 'in between'),
    ds: col(H, 'darkstore'), uns: col(H, 'total unsellable'), dmg: col(H, 'damaged'), lost: col(H, 'lost'),
    exp: col(H, 'expired'), ne: col(H, 'near expiry'), l7: col(H, 'last 7 days'), l15: col(H, 'last 15 days'), l30: col(H, 'last 30 days'),
  };
  const v = (r: unknown[], i: number) => (i >= 0 ? num(r[i]) : 0);
  const out = new Map<string, InventoryRow>();
  let bad = 0;
  for (const r of s.rows) {
    const itemId = idStr(r[c.item]), facilityId = idStr(r[c.fid]);
    if (!itemId || !facilityId) { bad++; continue; }
    out.set(itemId + '|' + facilityId, {
      snapshotDate: date, generatedAt, itemId, facilityId, itemName: str(r[c.name]), facilityName: str(r[c.fname]), uom: str(r[c.uom]),
      netScheduled: v(r, c.net), incoming: v(r, c.inc), recalled: v(r, c.rec), sellable: v(r, c.sell), warehouse: v(r, c.wh),
      inBetween: v(r, c.ib), darkstore: v(r, c.ds), unsellable: v(r, c.uns), damaged: v(r, c.dmg), lost: v(r, c.lost),
      expired: v(r, c.exp), nearExpiry: v(r, c.ne), sold7d: v(r, c.l7), sold15d: v(r, c.l15), sold30d: v(r, c.l30),
    });
  }
  const warnings = bad ? [`${bad} rows without Item ID / Facility ID skipped`] : [];
  if (c.l7 < 0) warnings.push('No "Last 7 days" column — run rate and Days of Cover will be empty');
  return { records: [...out.values()], dates: [date], rowsRead: s.rows.length, warnings };
}
