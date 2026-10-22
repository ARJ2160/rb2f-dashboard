import {
  addDsrBase,
  daysInRange,
  deriveDsr,
  emptyDsrBase,
  enumerateDates,
  scaleDsrBase,
  type DsrBase,
  type DsrResponse,
} from '@dash/shared';
import { and, between, eq, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { dailyAsinSales, products } from '../db/schema';
import { getAdMetrics, sumChannels } from './ad-metrics';
import { asinCategorySql, listCategories } from './filters';

/**
 * DSR — Daily Sales Report (rule book §10.1). One row per calendar day.
 *
 *   Sales / Units   = Seller Central + Vendor Central (summed per §4; a brand
 *                     with only one source simply has only those rows)
 *   Page Views      = Seller "Page Views - Total" + Vendor "Glance Views"
 *   Ad metrics      = SP + SB + SD, ASIN-level sources (see ad-metrics.ts)
 *   Ratios          = derived from the day's sums
 *
 * TOTAL sums every day; AVG = TOTAL ÷ days in range (ratios recomputed from
 * the averaged sums, which equals the TOTAL ratios).
 */
export async function getDsr(profileId: string, from: string, to: string, category?: string): Promise<DsrResponse> {
  const salesCat = category ? sql`and ${asinCategorySql('daily_asin_sales.asin', 'products')} = ${category}` : sql``;
  const [salesRows, ads, categories] = await Promise.all([
    db
      .select({
        date: dailyAsinSales.date,
        // Reported revenue + Vendor shipped units valued at the mapper's selling price.
        sales: sql<string>`coalesce(sum(${dailyAsinSales.sales}), 0) + coalesce(sum(${dailyAsinSales.unpricedUnits} * ${products.sellingPrice}), 0)`,
        units: sql<string>`coalesce(sum(${dailyAsinSales.units}), 0)`,
        pageViews: sql<string | null>`sum(${dailyAsinSales.pageViews})`,
        unpricedMissing: sql<string>`coalesce(sum(case when ${products.sellingPrice} is null then ${dailyAsinSales.unpricedUnits} else 0 end), 0)`,
      })
      .from(dailyAsinSales)
      .leftJoin(products, and(eq(products.profileId, dailyAsinSales.profileId), eq(products.asin, dailyAsinSales.asin)))
      .where(and(eq(dailyAsinSales.profileId, profileId), between(dailyAsinSales.date, from, to), sql`true ${salesCat}`))
      .groupBy(dailyAsinSales.date),
    getAdMetrics(profileId, from, to, category),
    listCategories(profileId),
  ]);

  const byChannel = (['sp', 'sb', 'sd'] as const).map((channel) => {
    const out = { channel, days: 0, asinDays: 0, campaignDays: 0, spend: 0, adSales: 0, impressions: 0, clicks: 0, adUnits: 0 };
    for (const [date, m] of ads.byDate) {
      const v = m[channel];
      if (!v || date < from || date > to) continue;
      out.days++;
      if (v.source === 'asin') out.asinDays++;
      else out.campaignDays++;
      out.spend += v.spend;
      out.adSales += v.adSales;
      out.impressions += v.impressions;
      out.clicks += v.clicks;
      out.adUnits += v.adUnits;
    }
    return out;
  });

  const byDate = new Map<string, DsrBase>();
  const get = (d: string) => byDate.get(d) ?? emptyDsrBase();

  for (const r of salesRows) {
    byDate.set(r.date, {
      ...get(r.date),
      sales: Number(r.sales),
      unitsSold: Number(r.units),
      pageViews: r.pageViews == null ? null : Number(r.pageViews),
    });
  }
  for (const [date, m] of ads.byDate) {
    const a = sumChannels(m);
    byDate.set(date, {
      ...get(date),
      impressions: a.impressions,
      clicks: a.clicks,
      spends: a.spend,
      adSales: a.adSales,
      adUnits: a.adUnits,
    });
  }
  const adDays = ads.byDate.size;

  const dates = enumerateDates(from, to);
  const days = daysInRange(from, to);
  let total = emptyDsrBase();
  const rows = dates.map((date) => {
    const base = get(date);
    total = addDsrBase(total, base);
    return { date, ...deriveDsr(base) };
  });

  const notes: string[] = [];
  if (category) {
    notes.push(
      `Category "${category}": sales of its ASINs (ASIN mapper); SP/SD ads of its ASINs; SB ad sales of its ASINs with spend prorated by attributed-sales share; days using the campaign-report fallback count campaigns whose category is "${category}".`
    );
  }
  const missingChannels = byChannel.filter((c) => c.days === 0).map((c) => c.channel.toUpperCase());
  if (adDays && missingChannels.length) {
    notes.push(`No ${missingChannels.join(' / ')} ad data in this range — upload those reports for these dates.`);
  }
  const fallback = byChannel.filter((c) => c.campaignDays > 0);
  if (fallback.length) {
    notes.push(
      `ASIN-level report missing on some days, campaign report used instead: ${fallback
        .map((c) => `${c.channel.toUpperCase()} ${c.campaignDays} day(s)`)
        .join(', ')}. Upload ${fallback
        .map((c) => (c.channel === 'sb' ? 'SB Attributed Purchases' : `${c.channel.toUpperCase()} Advertised Product`))
        .join(' / ')} for those dates to follow the rule book exactly.`
    );
  }
  if (ads.sbUnallocatedSpend > 0.5) {
    notes.push(
      `₹${ads.sbUnallocatedSpend.toFixed(2)} of SB spend sits on campaign-days with no attributed purchases and can't be allocated to an ASIN, so it isn't in Spends (rule book §5 — expected undercount, not a bug).`
    );
  }
  if (ads.sbUnmatchedCampaigns > 0) {
    notes.push(`${ads.sbUnmatchedCampaigns} SB attributed campaign-day(s) have no matching SB Campaign report row — their spend is 0. Upload the SB Campaign report for those dates.`);
  }
  const partial = byChannel.filter((c) => c.days > 0 && c.days < dates.length);
  if (partial.length) {
    notes.push(
      `Ad coverage differs by channel: ${partial.map((c) => `${c.channel.toUpperCase()} has ${c.days} of ${dates.length} days`).join(', ')} — days without a channel's report count it as 0.`
    );
  }
  const unvalued = salesRows.reduce((a, r) => a + Number(r.unpricedMissing), 0);
  if (unvalued > 0) {
    notes.push(
      `${unvalued} Vendor Central shipped unit(s) came with ₹0 revenue and have no selling price in the ASIN mapper — they count in Units but not in Sales. Add prices (Selling Price / BAU) to the mapper and re-upload it; no need to re-upload the Vendor file.`
    );
  }
  if (salesRows.length === 0) notes.push('No Business Report / Vendor Central data in this range.');
  if (adDays === 0) notes.push('No SP/SB/SD ad data in this range — ad columns are 0.');
  const missingSales = dates.length - salesRows.length;
  if (salesRows.length && missingSales > 0) notes.push(`${missingSales} day(s) in range have no sales data uploaded.`);
  const missingAds = dates.filter((d) => !ads.byDate.has(d)).length;
  if (adDays && missingAds > 0) notes.push(`${missingAds} day(s) in range have no ad data uploaded (ad columns show 0).`);

  return {
    profileId,
    from,
    to,
    days,
    total: deriveDsr(total),
    avg: deriveDsr(scaleDsrBase(total, 1 / days)),
    rows,
    byChannel,
    category: category ?? null,
    categories,
    notes,
  };
}
