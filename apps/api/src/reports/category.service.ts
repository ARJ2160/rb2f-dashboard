import { daysInRange, deriveDsr, emptyDsrBase, addDsrBase, pct, type CategoryResponse, type DsrBase } from '@dash/shared';
import { sql } from 'drizzle-orm';

import { db } from '../db/client';
import { getAdMetrics } from './ad-metrics';
import { getAdsByAsin } from './asin-ads';

const MISSING = '(missing ASIN)';

/**
 * Category-wise view (rule book §10.4): DSR columns grouped by the ASIN-mapper
 * category (§3 — a property of the ASIN, never of what is targeted).
 * Sales: Seller + Vendor per ASIN (§4). Ads: ASIN-level sources (SP/SD
 * Advertised Product + prorated SB). ASINs not in the mapper → "Unmapped";
 * rows with no ASIN in the source → "(missing ASIN)". Nothing is dropped.
 */
export async function getCategoryView(
  profileId: string,
  from: string,
  to: string,
  opts: { category?: string | undefined; asinLimit?: number } = {}
): Promise<CategoryResponse> {
  const [sales, ads, cats, dayAds] = await Promise.all([
    db.execute<{ asin: string; sales: string; units: string; page_views: string | null; unvalued: string }>(sql`
      select s.asin,
             coalesce(sum(s.sales), 0) + coalesce(sum(s.unpriced_units * p.selling_price), 0) as sales,
             coalesce(sum(s.units), 0) as units,
             sum(s.page_views) as page_views,
             coalesce(sum(case when p.selling_price is null then s.unpriced_units else 0 end), 0) as unvalued
      from daily_asin_sales s
      left join products p on p.profile_id = s.profile_id and p.asin = s.asin
      where s.profile_id = ${profileId} and s.date between ${from} and ${to}
      group by s.asin`),
    getAdsByAsin(profileId, from, to),
    db.execute<{ asin: string; category: string | null; title: string | null }>(
      sql`select asin, mapper_category as category, coalesce(mapper_title, report_title) as title from products where profile_id = ${profileId}`
    ),
    getAdMetrics(profileId, from, to),
  ]);

  const catOf = new Map(cats.map((c) => [c.asin, c.category]));
  const titleOf = new Map(cats.map((c) => [c.asin, c.title]));
  const perAsin = new Map<string, DsrBase>();
  const addAsin = (asin: string, b: DsrBase) => perAsin.set(asin, addDsrBase(perAsin.get(asin) ?? emptyDsrBase(), b));
  const category = (asin: string) => (asin === '' ? MISSING : (catOf.get(asin) ?? 'Unmapped'));

  const acc = new Map<string, { base: DsrBase; asins: Set<string> }>();
  const slot = (c: string) => {
    let v = acc.get(c);
    if (!v) acc.set(c, (v = { base: emptyDsrBase(), asins: new Set() }));
    return v;
  };
  let unvalued = 0;
  for (const r of sales) {
    const v = slot(category(r.asin));
    v.asins.add(r.asin);
    unvalued += Number(r.unvalued);
    const b = {
      ...emptyDsrBase(),
      sales: Number(r.sales),
      unitsSold: Number(r.units),
      pageViews: r.page_views == null ? null : Number(r.page_views),
    };
    v.base = addDsrBase(v.base, b);
    addAsin(r.asin, b);
  }
  for (const [asin, a] of ads) {
    const v = slot(category(asin));
    v.asins.add(asin);
    const b = {
      ...emptyDsrBase(),
      impressions: a.impressions,
      clicks: a.clicks,
      spends: a.spend,
      adSales: a.adSales,
      adUnits: a.adUnits,
    };
    v.base = addDsrBase(v.base, b);
    addAsin(asin, b);
  }

  let total = emptyDsrBase();
  for (const v of acc.values()) total = addDsrBase(total, v.base);
  const rows = [...acc.entries()]
    .map(([cat, v]) => ({ category: cat, asins: v.asins.size, salesSharePct: pct(v.base.sales, total.sales), ...deriveDsr(v.base) }))
    .sort((a, b) => b.sales - a.sales || b.spends - a.spends);

  const notes: string[] = [];
  const unmapped = rows.find((r) => r.category === 'Unmapped');
  if (unmapped && total.sales > 0) {
    const share = (unmapped.sales / total.sales) * 100;
    notes.push(`${unmapped.asins} ASIN(s) are not in the ASIN mapper — ${share.toFixed(1)}% of Sales is "Unmapped".${share > 50 ? ' Match rate is under 50% — refresh the mapper.' : ''}`);
  }
  if (unvalued > 0) notes.push(`${unvalued} Vendor shipped unit(s) have no selling price in the mapper — counted in Units, not Sales.`);
  if (dayAds.sbUnallocatedSpend > 0.5)
    notes.push(`₹${dayAds.sbUnallocatedSpend.toFixed(2)} SB spend on campaign-days with no attributed purchase can't be given to a category (rule book §5).`);
  let campaignOnly = 0;
  for (const m of dayAds.byDate.values()) for (const v of Object.values(m)) if (v?.source === 'campaign') campaignOnly += v.spend;
  if (campaignOnly > 0.5)
    notes.push(`₹${campaignOnly.toFixed(2)} spend comes only from campaign reports (no Advertised Product / SB Attributed Purchases for those days) and can't be split by category.`);

  const allAsins = [...perAsin.entries()]
    .map(([asin, b]) => ({ asin, title: asin ? (titleOf.get(asin) ?? null) : '(ASIN missing in source report)', category: category(asin), ...deriveDsr(b) }))
    .filter((r) => !opts.category || r.category === opts.category)
    .sort((a, b) => b.sales - a.sales || b.spends - a.spends || a.asin.localeCompare(b.asin));

  return {
    profileId,
    from,
    to,
    days: daysInRange(from, to),
    total: deriveDsr(total),
    rows,
    asinRows: allAsins.slice(0, opts.asinLimit ?? 1000),
    asinTotal: allAsins.length,
    categories: rows.map((r) => r.category).sort(),
    notes,
  };
}
