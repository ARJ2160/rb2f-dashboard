import {
  runRate, daysOfCover, docStatus, feederCity, type BkInventoryResponse, type BkInventoryTrendResponse,
} from '@dash/shared/blinkit';
import { bkConfig } from '../config';
import { getDims } from './dims';
import { q } from './queries';

export async function snapshots(profileId: string): Promise<string[]> {
  const r = await q(`select distinct snapshot_date::text d from bk_inventory where profile_id=$1 order by 1 desc`, [profileId]);
  return r.map((x) => String(x.d));
}

/** Item × feeder Days of Cover for one snapshot (default: latest). */
export async function inventory(a: { profileId: string; snapshot?: string; category?: string }): Promise<BkInventoryResponse> {
  const snaps = await snapshots(a.profileId);
  const snap = a.snapshot && snaps.includes(a.snapshot) ? a.snapshot : snaps[0] ?? null;
  if (!snap) return { snapshot: null, snapshots: snaps, rows: [], bands: bkConfig.docBands };
  const d = await getDims(a.profileId);
  const rows = await q(`select * from bk_inventory where profile_id=$1 and snapshot_date=$2`, [a.profileId, snap]);
  const out = rows.map((r) => {
    const it = d.items.get(String(r.item_id));
    const sellable = Number(r.sellable), incoming = Number(r.incoming);
    const s7 = Number(r.sold_7d), s30 = Number(r.sold_30d);
    const drr = runRate(s7);
    return {
      itemId: String(r.item_id), itemName: String(r.item_name), sku: it?.sku ?? String(r.item_name), category: it?.category ?? 'Unmapped',
      facilityId: String(r.facility_id), facility: String(r.facility_name), feederCity: feederCity(String(r.facility_name)),
      sellable, warehouse: Number(r.warehouse), inBetween: Number(r.in_between), darkstore: Number(r.darkstore),
      incoming, unsellable: Number(r.unsellable), nearExpiry: Number(r.near_expiry),
      sold7d: s7, sold15d: Number(r.sold_15d), sold30d: s30,
      drr7: drr, drr30: s30 / 30,
      doc: daysOfCover(sellable, drr), docWithIncoming: daysOfCover(sellable + incoming, drr),
      status: docStatus(sellable, s7, s30, bkConfig.docBands),
    };
  }).filter((r) => !a.category || r.category === a.category);
  return { snapshot: snap, snapshots: snaps, rows: out, bands: bkConfig.docBands };
}

/** DOC history across daily snapshots for one item (optionally one feeder). */
export async function inventoryTrend(a: { profileId: string; itemId?: string; facilityId?: string; category?: string }): Promise<BkInventoryTrendResponse> {
  const d = await getDims(a.profileId);
  const params: unknown[] = [a.profileId];
  let where = 'profile_id=$1';
  if (a.itemId) { params.push(a.itemId); where += ` and item_id=$${params.length}`; }
  else if (a.category) {
    const ids = [...d.items.values()].filter((i) => i.category === a.category).map((i) => i.itemId);
    params.push(ids); where += ` and item_id = any($${params.length}::text[])`;
  }
  if (a.facilityId) { params.push(a.facilityId); where += ` and facility_id=$${params.length}`; }
  const rows = await q(`select snapshot_date::text s, sum(sellable) sell, sum(sold_7d) s7 from bk_inventory where ${where} group by 1 order by 1`, params);
  return { points: rows.map((r) => ({ snapshot: String(r.s), sellable: Number(r.sell), sold7d: Number(r.s7), doc: daysOfCover(Number(r.sell), runRate(Number(r.s7))) })) };
}
