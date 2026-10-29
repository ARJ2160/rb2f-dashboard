import { normKey } from '@dash/shared/blinkit';
import type { SheetData } from '../sheet-grid';
import { idStr, num, str } from '../clean';
import type { ParseResult } from './types';

export interface SkuMapRow { key: string; productName: string; sku: string; category: string; price: number | null }

/** Product Name (or Item Name / Item ID) → SKU, Category, Price. */
export function parseSkuMapper(s: SheetData): ParseResult<SkuMapRow> {
  const H = s.headers;
  const idx = (...n: string[]) => { for (const x of n) { const i = H.indexOf(x); if (i >= 0) return i; } return -1; };
  const c = { id: idx('item id', 'item code', 'pid'), name: idx('product name', 'item name'), sku: idx('sku', 'sku name'),
    cat: idx('category'), price: idx('price', 'selling price', 'bau') };
  const out = new Map<string, SkuMapRow>();
  for (const r of s.rows) {
    const id = c.id >= 0 ? idStr(r[c.id]) : '';
    const name = c.name >= 0 ? str(r[c.name]) : '';
    if (!id && !name) continue;
    if (/\|/.test(name)) continue; // stray campaign names pasted into the SKU mapper
    const row: SkuMapRow = {
      key: id ? `id:${id}` : `name:${normKey(name)}`, productName: name,
      sku: c.sku >= 0 ? str(r[c.sku]) : '', category: c.cat >= 0 ? str(r[c.cat]) : '',
      price: c.price >= 0 && num(r[c.price]) > 0 ? num(r[c.price]) : null,
    };
    const prev = out.get(row.key);
    out.set(row.key, prev ? { ...prev, ...Object.fromEntries(Object.entries(row).filter(([, v]) => v !== '' && v != null)) } as SkuMapRow : row);
  }
  return { records: [...out.values()], dates: [], rowsRead: s.rows.length, warnings: [] };
}

export interface CampaignMapRow {
  key: string; campaignId: string; campaignName: string; category: string; sku: string; city: string; targeting: string;
}

/** Handles both the simple layout (Campaign Name | Category | SKU | City) and
    side-by-side blocks like the master sheet's "City & Product Mapper"
    (Campaign ID (Product Listing) | Campaign Name | City | Product | … ). */
export function parseCampaignMapper(s: SheetData): ParseResult<CampaignMapRow> {
  const H = s.headers;
  type Block = { id: number; name: number; cat: number; sku: number; city: number; tgt: number };
  const blocks: Block[] = [];
  let cur: Block | null = null;
  const close = () => { if (cur && (cur.id >= 0 || cur.name >= 0)) blocks.push(cur); cur = null; };
  // An unlabelled column right after "Campaign Name" holding short labels (Jam, Honey…)
  // is that block's Category — the warehouse mapper has blocks like that.
  const looksLikeCategory = (i: number) => {
    const vals = s.rows.map((r) => str(r[i])).filter(Boolean);
    return vals.length > 0 && vals.filter((v) => v.length <= 30 && !/[|/]/.test(v)).length / vals.length >= 0.9;
  };
  for (let i = 0; i < H.length; i++) {
    const h = H[i];
    if (!h && cur && cur.name === i - 1 && cur.cat < 0 && looksLikeCategory(i)) { cur.cat = i; continue; }
    if (!h) { close(); continue; }
    const isId = h.startsWith('campaign id');
    const isName = h.startsWith('campaign name');
    if (isId || (isName && (!cur || cur.name >= 0))) {
      close();
      cur = { id: -1, name: -1, cat: -1, sku: -1, city: -1, tgt: -1 };
    }
    if (!cur) continue;
    if (isId) cur.id = i;
    else if (isName) cur.name = i;
    else if (h === 'category' && cur.cat < 0) cur.cat = i;
    else if ((h === 'sku' || h === 'product') && cur.sku < 0) cur.sku = i;
    else if ((h === 'city' || h === 'cities' || h === 'city targeted' || h === 'geo') && cur.city < 0) cur.city = i;
    else if ((h === 'targeting type' || h === 'targeting') && cur.tgt < 0) cur.tgt = i;
  }
  close();
  const useful = blocks.filter((b) => b.cat >= 0 || b.sku >= 0 || b.city >= 0);
  const out = new Map<string, CampaignMapRow>();
  const g = (r: unknown[], i: number) => (i >= 0 ? str(r[i]) : '');
  for (const b of useful) for (const r of s.rows) {
    const id = b.id >= 0 ? idStr(r[b.id]) : '';
    const name = g(r, b.name);
    if (!id && !name) continue;
    if (/^=/.test(name)) continue; // uncached formula
    const row: CampaignMapRow = {
      key: id ? `id:${id}` : `name:${normKey(name)}`, campaignId: id, campaignName: name,
      category: g(r, b.cat), sku: g(r, b.sku), city: g(r, b.city), targeting: g(r, b.tgt),
    };
    for (const k of ['category', 'sku', 'city', 'targeting'] as const) if (/^=|#n\/a/i.test(row[k])) row[k] = '';
    const prev = out.get(row.key);
    if (!prev) out.set(row.key, row);
    else for (const k of ['campaignId', 'campaignName', 'category', 'sku', 'city', 'targeting'] as const) if (!prev[k] && row[k]) prev[k] = row[k];
  }
  const warnings = useful.length ? [] : ['No Campaign Name / ID column with Category, SKU or City next to it'];
  return { records: [...out.values()], dates: [], rowsRead: s.rows.length, warnings };
}
