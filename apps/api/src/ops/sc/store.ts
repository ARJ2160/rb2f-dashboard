import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Tx } from '../../db/client';
import {
  dimProduct,
  scFbaInventory,
  scLedgerDetail,
  scLedgerSummary,
  scShipmentContents,
  scShipments,
  scShipmentsHistory,
} from '../../db/schema';
import { ensureWarehouses } from '../warehouses';
import type {
  ScFbaRecord,
  ScLedgerDetailRecord,
  ScLedgerRecord,
  ScProductDim,
  ScShipmentContentRecord,
  ScShipmentRecord,
} from './parse';

const CHUNK = 1000;
function chunks<T>(a: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < a.length; i += size) out.push(a.slice(i, i + size));
  return out;
}
const uniq = (xs: string[]) => [...new Set(xs)].sort();

/** short_name = title up to the first '|', capped at 70 chars. */
const shortNameOf = (title: string | null): string | null => {
  if (!title) return null;
  return title.split('|')[0]!.trim().slice(0, 70) || null;
};

/** Upsert the brand's product catalogue from whatever identifiers a file carried. */
export async function upsertProducts(tx: Tx, brandId: string, products: ScProductDim[]): Promise<void> {
  const rows = products.filter((p) => p.asin || p.msku || p.fnsku);
  for (const c of chunks(rows)) {
    await tx
      .insert(dimProduct)
      .values(
        c.map((p) => ({
          brandId,
          asin: p.asin,
          msku: p.msku,
          fnsku: p.fnsku,
          title: p.title,
          shortName: shortNameOf(p.title),
        }))
      )
      .onConflictDoUpdate({
        target: [dimProduct.brandId, dimProduct.asin, dimProduct.msku, dimProduct.fnsku],
        set: {
          title: sql`coalesce(excluded.title, ${dimProduct.title})`,
          shortName: sql`coalesce(excluded.short_name, ${dimProduct.shortName})`,
          updatedAt: sql`now()`,
        },
      });
  }
}

/** Replace-by-date: wipe this brand's ledger rows for the dates the file covers, then insert. */
export async function storeLedgerSummary(
  tx: Tx,
  brandId: string,
  uploadId: string,
  records: ScLedgerRecord[]
): Promise<void> {
  const dates = uniq(records.map((r) => r.date));
  for (const d of chunks(dates)) {
    await tx
      .delete(scLedgerSummary)
      .where(and(eq(scLedgerSummary.brandId, brandId), inArray(scLedgerSummary.date, d)));
  }
  for (const c of chunks(records)) {
    await tx.insert(scLedgerSummary).values(c.map((r) => ({ brandId, uploadId, ...r })));
  }
}

export async function storeLedgerDetail(
  tx: Tx,
  brandId: string,
  uploadId: string,
  records: ScLedgerDetailRecord[]
): Promise<void> {
  const dates = uniq(records.map((r) => r.date));
  for (const d of chunks(dates)) {
    await tx
      .delete(scLedgerDetail)
      .where(and(eq(scLedgerDetail.brandId, brandId), inArray(scLedgerDetail.date, d)));
  }
  for (const c of chunks(records)) {
    await tx.insert(scLedgerDetail).values(c.map((r) => ({ brandId, uploadId, ...r })));
  }
}

export async function storeFbaInventory(
  tx: Tx,
  brandId: string,
  uploadId: string,
  records: ScFbaRecord[]
): Promise<void> {
  const dates = uniq(records.map((r) => r.snapshotDate));
  for (const d of chunks(dates)) {
    await tx
      .delete(scFbaInventory)
      .where(and(eq(scFbaInventory.brandId, brandId), inArray(scFbaInventory.snapshotDate, d)));
  }
  for (const c of chunks(records)) {
    await tx.insert(scFbaInventory).values(c.map((r) => ({ brandId, uploadId, ...r })));
  }
}

/** Shipments: UPSERT current state on (brand, shipment), plus a dated history row. */
export async function storeShipments(
  tx: Tx,
  brandId: string,
  uploadId: string,
  records: ScShipmentRecord[],
  asOf: string | null
): Promise<void> {
  for (const c of chunks(records)) {
    await tx
      .insert(scShipments)
      .values(c.map((r) => ({ brandId, uploadId, ...r })))
      .onConflictDoUpdate({
        target: [scShipments.brandId, scShipments.shipmentId],
        set: {
          shipmentName: sql`excluded.shipment_name`,
          status: sql`excluded.status`,
          created: sql`excluded.created`,
          lastUpdated: sql`excluded.last_updated`,
          destination: sql`excluded.destination`,
          deliveryWindow: sql`excluded.delivery_window`,
          skus: sql`excluded.skus`,
          unitsExpected: sql`excluded.units_expected`,
          unitsLocated: sql`excluded.units_located`,
          uploadId: sql`excluded.upload_id`,
          updatedAt: sql`now()`,
        },
      });
  }
  if (asOf) {
    for (const c of chunks(records)) {
      await tx
        .insert(scShipmentsHistory)
        .values(
          c.map((r) => ({
            brandId,
            shipmentId: r.shipmentId,
            asOf,
            status: r.status,
            unitsExpected: r.unitsExpected,
            unitsLocated: r.unitsLocated,
            uploadId,
          }))
        )
        .onConflictDoUpdate({
          target: [scShipmentsHistory.brandId, scShipmentsHistory.shipmentId, scShipmentsHistory.asOf],
          set: {
            status: sql`excluded.status`,
            unitsExpected: sql`excluded.units_expected`,
            unitsLocated: sql`excluded.units_located`,
            uploadId: sql`excluded.upload_id`,
          },
        });
    }
  }
}

export async function storeShipmentContents(
  tx: Tx,
  brandId: string,
  uploadId: string,
  records: ScShipmentContentRecord[]
): Promise<void> {
  const shipmentIds = uniq(records.map((r) => r.shipmentId));
  for (const ids of chunks(shipmentIds)) {
    await tx
      .delete(scShipmentContents)
      .where(and(eq(scShipmentContents.brandId, brandId), inArray(scShipmentContents.shipmentId, ids)));
  }
  for (const c of chunks(records)) {
    await tx.insert(scShipmentContents).values(c.map((r) => ({ brandId, uploadId, ...r })));
  }
}

/** Register any FC codes a file introduced (new codes inserted + flagged for review). */
export async function registerWarehouses(tx: Tx, codes: string[]): Promise<void> {
  if (codes.length) await ensureWarehouses(tx, codes);
}
