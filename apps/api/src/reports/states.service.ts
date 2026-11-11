import { pct, type StateResponse } from '@dash/shared';
import { sql, type SQL } from 'drizzle-orm';

import { db } from '../db/client';
import { piActive } from './pi-sales';

/**
 * State Wise Data (name per rule book §8). Seller: Order report ship-state
 * (§2 — Business Report totals carry no state). Vendor: Vendor Central
 * "View By = State" export. Vendor shipped units with ₹0 revenue are valued at
 * the ASIN mapper's selling price, as in the DSR. Category = ASIN mapper (§3).
 *
 * When Amazon Pi is present it replaces the Order report entirely: geography
 * comes from Pi's city rows rolled up to state (gross sales/units, no order
 * count), and the Seller/Vendor source filter no longer applies.
 */
export async function getStates(
  profileId: string,
  from: string,
  to: string,
  opts: { source: 'all' | 'seller' | 'vendor'; category?: string | undefined }
): Promise<StateResponse> {
  const pi = await piActive(profileId, from, to);

  // Table and metric expressions differ by source; the downstream shaping is identical.
  const base = pi ? sql`daily_pi_city_sales s` : sql`daily_state_sales s`;
  const join = sql`left join products p on p.profile_id = s.profile_id and p.asin = s.asin`;
  const salesExpr = pi
    ? sql`coalesce(sum(s.gross_sales), 0)`
    : sql`coalesce(sum(s.sales), 0) + coalesce(sum(s.unpriced_units * p.selling_price), 0)`;
  const unitsExpr = pi ? sql`coalesce(sum(s.gross_units), 0)` : sql`coalesce(sum(s.units), 0)`;
  const ordersExpr = pi ? sql`null::int` : sql`sum(s.orders)`;
  const unvaluedExpr = pi ? sql`0` : sql`coalesce(sum(case when p.selling_price is null then s.unpriced_units else 0 end), 0)`;

  const conds: SQL[] = [sql`s.profile_id = ${profileId}`, sql`s.date between ${from} and ${to}`];
  if (!pi && opts.source !== 'all') conds.push(sql`s.source = ${opts.source}`);
  if (opts.category) conds.push(sql`coalesce(p.mapper_category, 'Unmapped') = ${opts.category}`);
  const where = sql.join(conds, sql` and `);
  const fromSql = sql`${base} ${join}`;

  const [rows, totals, sources, cats] = await Promise.all([
    db.execute<{ state: string; units: string; sales: string; orders: string | null; asins: string }>(sql`
      select s.state, ${unitsExpr} as units, ${salesExpr} as sales,
             ${ordersExpr} as orders, count(distinct s.asin) as asins
      from ${fromSql} where ${where}
      group by s.state`),
    db.execute<{ units: string; sales: string; orders: string | null; asins: string; unvalued: string }>(sql`
      select ${unitsExpr} as units, ${salesExpr} as sales,
             ${ordersExpr} as orders, count(distinct s.asin) as asins, ${unvaluedExpr} as unvalued
      from ${fromSql} where ${where}`),
    pi
      ? Promise.resolve([] as { source: 'seller' | 'vendor'; days: string }[])
      : db.execute<{ source: 'seller' | 'vendor'; days: string }>(sql`
          select source, count(distinct date) as days from daily_state_sales
          where profile_id = ${profileId} and date between ${from} and ${to} group by source`),
    db.execute<{ category: string }>(sql`
      select distinct coalesce(p.mapper_category, 'Unmapped') as category
      from ${base} ${join}
      where s.profile_id = ${profileId} order by 1`),
  ]);
  const t = totals[0];
  const total = {
    units: Number(t?.units ?? 0),
    sales: Number(t?.sales ?? 0),
    orders: t?.orders == null ? null : Number(t.orders),
    asins: Number(t?.asins ?? 0),
  };
  const notes: string[] = [];
  const src = new Map(sources.map((s) => [s.source, Number(s.days)]));
  if (pi) {
    notes.push('Geography comes from Amazon Pi — delivery cities rolled up to state (gross sales/units). The Seller/Vendor source filter and order counts do not apply.');
  } else {
    if (!src.get('seller'))
      notes.push('No Seller Central Order report in this range — Seller sales have no state breakdown (Business Report totals carry none). Upload the Order report to include them.');
    if (!src.get('vendor')) notes.push('No Vendor Central State-view data in this range.');
    if (Number(t?.unvalued ?? 0) > 0)
      notes.push(`${Number(t!.unvalued)} Vendor shipped unit(s) have no selling price in the ASIN mapper — counted in Units, not Sales.`);
    if (src.get('vendor')) notes.push('Vendor Central has no order count, so Orders covers Seller only.');
  }

  return {
    profileId,
    from,
    to,
    total,
    rows: rows
      .map((r) => ({
        state: r.state,
        units: Number(r.units),
        sales: Number(r.sales),
        orders: r.orders == null ? null : Number(r.orders),
        asins: Number(r.asins),
        unitsSharePct: pct(Number(r.units), total.units),
        salesSharePct: pct(Number(r.sales), total.sales),
      }))
      .sort((a, b) => b.sales - a.sales || b.units - a.units),
    sources: (['seller', 'vendor'] as const).map((s) => ({ source: s, days: src.get(s) ?? 0 })),
    categories: cats.map((c) => c.category),
    notes,
  };
}
