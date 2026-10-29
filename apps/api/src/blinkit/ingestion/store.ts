import { and, eq, inArray, sql } from 'drizzle-orm';

import { db, type Tx } from '../../db/client';
import { bkCampaignMap, bkDailyAds, bkInventory, bkSalesLines, bkSkuMap } from '../schema';
import type { AdRow, AdType } from './parsers/ads';
import type { InventoryRow } from './parsers/inventory';
import type { CampaignMapRow, SkuMapRow } from './parsers/mappers';
import type { SalesLine } from './parsers/sales';

async function chunked<T>(rows: T[], size: number, fn: (part: T[]) => Promise<unknown>) {
  for (let i = 0; i < rows.length; i += size) await fn(rows.slice(i, i + size));
}

/* replace-by-date: the rows of that source for those dates are deleted and
   re-inserted in one transaction — re-ingesting a corrected export is safe and
   overlapping exports (Oct 1–27, then Oct 1–28) never double count. */

export async function storeSales(profileId: string, dates: string[], rows: SalesLine[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(bkSalesLines).where(and(eq(bkSalesLines.profileId, profileId), inArray(bkSalesLines.date, dates)));
    await chunked(rows, 1000, (part) =>
      tx
        .insert(bkSalesLines)
        .values(part.map((r) => ({ profileId, ...r })))
        .onConflictDoUpdate({
          target: [bkSalesLines.profileId, bkSalesLines.orderId, bkSalesLines.itemId],
          set: {
            date: sql`excluded.date`,
            quantity: sql`excluded.quantity`,
            revenue: sql`excluded.revenue`,
            customerCity: sql`excluded.customer_city`,
            customerState: sql`excluded.customer_state`,
            status: sql`excluded.status`,
          },
        })
    );
  });
  return rows.length;
}

export async function storeAds(profileId: string, adType: AdType, dates: string[], rows: AdRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx
      .delete(bkDailyAds)
      .where(and(eq(bkDailyAds.profileId, profileId), eq(bkDailyAds.adType, adType), inArray(bkDailyAds.date, dates)));
    await chunked(rows, 1000, (part) => tx.insert(bkDailyAds).values(part.map((r) => ({ profileId, ...r }))));
  });
  return rows.length;
}

export async function storeInventory(profileId: string, snapshotDate: string, rows: InventoryRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(bkInventory).where(and(eq(bkInventory.profileId, profileId), eq(bkInventory.snapshotDate, snapshotDate)));
    await chunked(rows, 1000, (part) => tx.insert(bkInventory).values(part.map((r) => ({ profileId, ...r }))));
  });
  return rows.length;
}

/** A SKU mapper replaces the previous mapping (like the Amazon ASIN mapper). */
export async function storeSkuMap(profileId: string, rows: SkuMapRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(bkSkuMap).where(eq(bkSkuMap.profileId, profileId));
    await chunked(rows, 1000, (part) => tx.insert(bkSkuMap).values(part.map((r) => ({ profileId, ...r }))));
  });
  return rows.length;
}

/** Replaces only rows from the same mapper source, so a category mapper and a city mapper can both be loaded. */
export async function storeCampaignMap(profileId: string, source: string, rows: CampaignMapRow[]) {
  await db.transaction(async (tx: Tx) => {
    await tx.delete(bkCampaignMap).where(and(eq(bkCampaignMap.profileId, profileId), eq(bkCampaignMap.source, source)));
    await chunked(rows, 1000, (part) => tx.insert(bkCampaignMap).values(part.map((r) => ({ profileId, source, ...r }))));
  });
  return rows.length;
}
