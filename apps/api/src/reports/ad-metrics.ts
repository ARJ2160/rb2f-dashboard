import type { AdChannel } from '@dash/shared';
import { and, between, eq, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { dailyAsinAds, dailyCampaignAds, products } from '../db/schema';
import { asinCategorySql } from './filters';

export interface AdSums {
  impressions: number;
  clicks: number;
  spend: number;
  adSales: number;
  adUnits: number;
}

export type AdSource = 'asin' | 'campaign';

export interface DayChannelAds extends AdSums {
  source: AdSource;
}

export interface AdMetrics {
  /** date → channel → metrics used for reporting */
  byDate: Map<string, Partial<Record<AdChannel, DayChannelAds>>>;
  /** SB spend on campaign-days with no attributed purchases (rule book §5.6 — can't be allocated). */
  sbUnallocatedSpend: number;
  /** SB attributed campaign names that have no matching SB campaign-report row (their spend is unknown). */
  sbUnmatchedCampaigns: number;
}

const zero = (): AdSums => ({ impressions: 0, clicks: 0, spend: 0, adSales: 0, adUnits: 0 });
const toSums = (r: { impressions: unknown; clicks: unknown; spend: unknown; adSales: unknown; adUnits: unknown }): AdSums => ({
  impressions: Number(r.impressions ?? 0),
  clicks: Number(r.clicks ?? 0),
  spend: Number(r.spend ?? 0),
  adSales: Number(r.adSales ?? 0),
  adUnits: Number(r.adUnits ?? 0),
});

/** Same normalisation as the campaign mapper join: case-, space- and padding-insensitive. */
const campaignKey = (col: string) => sql.raw(`lower(regexp_replace(btrim(${col}), '\\s+', ' ', 'g'))`);

/**
 * Ad-side metrics per day per channel, sourced per the rule book (§7, §10.1:
 * "same ad-side sources as the Main View"):
 *
 *   SP → SP Advertised Product report (ASIN level)
 *   SD → SD Advertised Product report (ASIN level)
 *   SB → SB rows of the Advertised Product report when present (GCS
 *        warehouse export — it carries SB spend per ASIN); otherwise
 *        Ad Sales / Ad Units from SB Attributed Purchases (never prorated);
 *        Spend / Impressions / Clicks prorated from the SB Campaign report by
 *        each ASIN's share of its campaign-day's attributed sales (§5).
 *
 * If a channel has no ASIN-level report for a given day, that day falls back
 * to the channel's campaign report so the day is not silently 0. The source
 * used is returned so the UI can say so.
 */
export async function getAdMetrics(profileId: string, from: string, to: string, category?: string): Promise<AdMetrics> {
  // Category filter: ASIN-level rows by the ASIN's mapper category; the
  // campaign-report fallback by the campaign's category (campaign_dims).
  const asinCat = category
    ? sql`and ${asinCategorySql('daily_asin_campaign_ads.asin', 'products')} = ${category}`
    : sql``;
  const campCat = category
    ? sql`and coalesce((select cd.category from campaign_dims cd where cd.profile_id = ${dailyCampaignAds.profileId} and cd.campaign_key = ${campaignKey('daily_campaign_ads.campaign_name')}), 'Unmapped') = ${category}`
    : sql``;
  const sbCat = category ? sql`and ${asinCategorySql('a.asin')} = ${category}` : sql``;
  const [asinRows, campRows, sbRows] = await Promise.all([
    db
      .select({
        date: dailyAsinAds.date,
        channel: dailyAsinAds.channel,
        impressions: sql<string>`sum(${dailyAsinAds.impressions})`,
        clicks: sql<string>`sum(${dailyAsinAds.clicks})`,
        spend: sql<string>`sum(${dailyAsinAds.spend})`,
        adSales: sql<string>`sum(${dailyAsinAds.adSales})`,
        adUnits: sql<string>`sum(${dailyAsinAds.adUnits})`,
      })
      .from(dailyAsinAds)
      .leftJoin(products, and(eq(products.profileId, dailyAsinAds.profileId), eq(products.asin, dailyAsinAds.asin)))
      .where(and(eq(dailyAsinAds.profileId, profileId), between(dailyAsinAds.date, from, to), sql`true ${asinCat}`))
      .groupBy(dailyAsinAds.date, dailyAsinAds.channel),
    db
      .select({
        date: dailyCampaignAds.date,
        channel: dailyCampaignAds.channel,
        impressions: sql<string>`sum(${dailyCampaignAds.impressions})`,
        clicks: sql<string>`sum(${dailyCampaignAds.clicks})`,
        spend: sql<string>`sum(${dailyCampaignAds.spend})`,
        adSales: sql<string>`sum(${dailyCampaignAds.adSales})`,
        adUnits: sql<string>`sum(${dailyCampaignAds.adUnits})`,
      })
      .from(dailyCampaignAds)
      .where(and(eq(dailyCampaignAds.profileId, profileId), between(dailyCampaignAds.date, from, to), sql`true ${campCat}`))
      .groupBy(dailyCampaignAds.date, dailyCampaignAds.channel),
    db.execute<{
      date: string;
      impressions: string;
      clicks: string;
      spend: string;
      ad_sales: string;
      ad_units: string;
      unmatched: string;
    }>(sql`
      with attr as (
        select date, ${campaignKey('campaign_name')} as ck, asin, ad_sales, ad_units
        from sb_attributed_daily
        where profile_id = ${profileId} and date between ${from} and ${to}
      ),
      tot as (select date, ck, sum(ad_sales) as s from attr group by date, ck),
      camp as (
        select date, ${campaignKey('campaign_name')} as ck,
               sum(impressions) as i, sum(clicks) as c, sum(spend) as sp
        from daily_campaign_ads
        where profile_id = ${profileId} and channel = 'sb' and date between ${from} and ${to}
        group by date, ck
      )
      select a.date::text as date,
             coalesce(sum(case when t.s > 0 then c.i  * a.ad_sales / t.s end), 0) as impressions,
             coalesce(sum(case when t.s > 0 then c.c  * a.ad_sales / t.s end), 0) as clicks,
             coalesce(sum(case when t.s > 0 then c.sp * a.ad_sales / t.s end), 0) as spend,
             sum(a.ad_sales) as ad_sales,
             sum(a.ad_units) as ad_units,
             count(distinct case when c.ck is null then a.ck end) as unmatched
      from attr a
      join tot t on t.date = a.date and t.ck = a.ck
      left join camp c on c.date = a.date and c.ck = a.ck
      left join products p on p.profile_id = ${profileId} and p.asin = a.asin
      where true ${sbCat}
      group by a.date
    `),
  ]);

  const byDate: AdMetrics['byDate'] = new Map();
  const put = (date: string, ch: AdChannel, v: DayChannelAds) => {
    const m = byDate.get(date) ?? {};
    m[ch] = v;
    byDate.set(date, m);
  };

  const asin = new Map(asinRows.map((r) => [`${r.date}|${r.channel}`, toSums(r)]));
  const camp = new Map(campRows.map((r) => [`${r.date}|${r.channel}`, toSums(r)]));
  const sb = new Map(
    sbRows.map((r) => [
      r.date,
      { sums: toSums({ ...r, adSales: r.ad_sales, adUnits: r.ad_units }), unmatched: Number(r.unmatched) },
    ])
  );

  let sbUnallocatedSpend = 0;
  let sbUnmatchedCampaigns = 0;
  const dates = new Set([...asinRows.map((r) => r.date), ...campRows.map((r) => r.date), ...sb.keys()]);

  for (const date of dates) {
    for (const ch of ['sp', 'sd'] as const) {
      const a = asin.get(`${date}|${ch}`);
      const c = camp.get(`${date}|${ch}`);
      if (a) put(date, ch, { ...a, source: 'asin' });
      else if (c) put(date, ch, { ...c, source: 'campaign' });
    }
    const s = sb.get(date);
    const c = camp.get(`${date}|sb`);
    // SB at ASIN level with its own spend (GCS warehouse advertised export) beats the §5 proration.
    const sbAsin = asin.get(`${date}|sb`);
    if (sbAsin) {
      put(date, 'sb', { ...sbAsin, source: 'asin' });
    } else if (s) {
      put(date, 'sb', { ...s.sums, source: 'asin' });
      sbUnmatchedCampaigns += s.unmatched;
      // Unallocated SB spend is only meaningful unfiltered (a category sees only its share).
      if (c && !category) sbUnallocatedSpend += Math.max(0, c.spend - s.sums.spend);
    } else if (c) {
      put(date, 'sb', { ...c, source: 'campaign' });
    }
  }
  return { byDate, sbUnallocatedSpend, sbUnmatchedCampaigns };
}

export function sumChannels(m: Partial<Record<AdChannel, AdSums>> | undefined): AdSums {
  const out = zero();
  for (const v of Object.values(m ?? {})) {
    out.impressions += v.impressions;
    out.clicks += v.clicks;
    out.spend += v.spend;
    out.adSales += v.adSales;
    out.adUnits += v.adUnits;
  }
  return out;
}
