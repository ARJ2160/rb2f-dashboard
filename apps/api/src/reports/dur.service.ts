import { daysInRange, enumerateDates, type DurMetric, type DurResponse, type DurRow } from '@dash/shared';
import { and, between, eq, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { dailyAsinSales, products } from '../db/schema';
import { listCategories } from './filters';

/**
 * DUR — Daily Units Report (rule book §10.2). Pivot: one row per ASIN, one
 * column per date, plus Totals and Avg (Totals ÷ days in range).
 *
 * metric = 'units'  → Seller Units Ordered + Vendor Ordered Units
 * metric = 'orders' → Seller "Total Order Items" (Vendor reports no order
 *                     count, so Vendor-only cells are null, not 0)
 *
 * The rule book leaves units-vs-orders open, so the metric is an explicit
 * request parameter and echoed back in the response — never a silent default
 * on the client.
 *
 * Rows with a blank source ASIN form their own bucket (asin = null), kept
 * separate from "Unmapped" (an ASIN that the mapper doesn't know).
 */
export async function getDur(profileId: string, from: string, to: string, metric: DurMetric, category?: string): Promise<DurResponse> {
  const categories = await listCategories(profileId);
  const rows = await db
    .select({
      asin: dailyAsinSales.asin,
      date: dailyAsinSales.date,
      units: sql<string>`coalesce(sum(${dailyAsinSales.units}), 0)`,
      orders: sql<string | null>`sum(${dailyAsinSales.orderItems})`,
      category: sql<string | null>`max(${products.mapperCategory})`,
      title: sql<string | null>`max(coalesce(${products.mapperTitle}, ${products.reportTitle}))`,
    })
    .from(dailyAsinSales)
    .leftJoin(products, and(eq(products.profileId, dailyAsinSales.profileId), eq(products.asin, dailyAsinSales.asin)))
    .where(and(eq(dailyAsinSales.profileId, profileId), between(dailyAsinSales.date, from, to)))
    .groupBy(dailyAsinSales.asin, dailyAsinSales.date);

  const dates = enumerateDates(from, to);
  const days = daysInRange(from, to);
  const byAsin = new Map<string, DurRow>();
  // A date that has any upload means "no row for this ASIN" = 0 sold that day
  // (Amazon omits ASINs with no activity). A date with no upload stays null.
  const datesWithData = new Set<string>();
  const datesWithSeller = new Set<string>();
  const sellerAsins = new Set<string>();

  for (const r of rows) {
    datesWithData.add(r.date);
    if (r.orders != null) {
      datesWithSeller.add(r.date);
      sellerAsins.add(r.asin);
    }
    const key = r.asin;
    let row = byAsin.get(key);
    if (!row) {
      row = {
        asin: key === '' ? null : key,
        itemName: key === '' ? '(ASIN missing in source report)' : r.title,
        category: key === '' ? '—' : (r.category ?? 'Unmapped'),
        totals: null,
        avg: null,
        values: Object.fromEntries(dates.map((d) => [d, null])),
      };
      byAsin.set(key, row);
    }
    const v = metric === 'units' ? Number(r.units) : r.orders == null ? null : Number(r.orders);
    row.values[r.date] = v;
    if (v != null) row.totals = (row.totals ?? 0) + v;
  }

  for (const [key, row] of byAsin) {
    for (const d of dates) {
      if (row.values[d] != null) continue;
      const known = metric === 'units' ? datesWithData.has(d) : datesWithSeller.has(d) && sellerAsins.has(key);
      if (known) {
        row.values[d] = 0;
        row.totals ??= 0;
      }
    }
  }

  // Category filter on rows only, so "no row that day = 0" still uses every upload.
  const out = [...byAsin.values()].filter(
    (r) => !category || (r.asin === null ? category === '(missing ASIN)' : r.category === category)
  );
  for (const row of out) row.avg = row.totals == null ? null : row.totals / days;
  out.sort((a, b) => {
    if (a.asin === null) return -1; // missing-ASIN bucket pinned first (as in the sample sheet)
    if (b.asin === null) return 1;
    return (b.totals ?? -1) - (a.totals ?? -1) || a.asin.localeCompare(b.asin);
  });

  const notes: string[] = [
    ...(category ? [`Category "${category}": ${out.length} ASIN(s).`] : []),
    metric === 'units'
      ? 'Values = units sold (Seller "Units Ordered" + Vendor "Ordered Units").'
      : 'Values = order items (Seller "Total Order Items"). Vendor Central has no order count, so Vendor-only ASINs show "—".',
  ];
  const noData = dates.length - datesWithData.size;
  if (rows.length && noData > 0) notes.push(`${noData} day(s) in range have no sales upload — shown as "—".`);
  const unmapped = out.filter((r) => r.asin && r.category === 'Unmapped').length;
  const withAsin = out.filter((r) => r.asin).length;
  if (withAsin && unmapped / withAsin > 0.5) {
    notes.push(`${unmapped} of ${withAsin} ASINs are not in the ASIN mapper (match rate under 50%) — upload/refresh the mapper.`);
  }

  return { profileId, from, to, days, metric, dates, rows: out, category: category ?? null, categories, notes };
}
