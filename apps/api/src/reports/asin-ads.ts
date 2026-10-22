import { addAdBase, emptyAdBase, type AdBase } from '@dash/shared';
import { sql } from 'drizzle-orm';

import { db } from '../db/client';
import { campaignKeySql } from './filters';

/**
 * Ad metrics per ASIN for a date range (rule book Main View sources):
 * SP / SD Advertised Product + SB Attributed Purchases with SB spend /
 * impressions / clicks prorated from the SB Campaign report (§5).
 */
export async function getAdsByAsin(profileId: string, from: string, to: string): Promise<Map<string, AdBase>> {
  const [spsd, sb] = await Promise.all([
    db.execute<{ asin: string; impressions: string; clicks: string; spend: string; ad_sales: string; ad_units: string }>(sql`
      select asin, sum(impressions) as impressions, sum(clicks) as clicks, sum(spend) as spend,
             sum(ad_sales) as ad_sales, sum(ad_units) as ad_units
      from daily_asin_campaign_ads
      where profile_id = ${profileId} and date between ${from} and ${to}
      group by asin`),
    db.execute<{ asin: string; impressions: string; clicks: string; spend: string; ad_sales: string; ad_units: string }>(sql`
      with attr as (
        select date, ${campaignKeySql('campaign_name')} as ck, asin, ad_sales, ad_units
        from sb_attributed_daily where profile_id = ${profileId} and date between ${from} and ${to}
      ),
      tot as (select date, ck, sum(ad_sales) as s from attr group by date, ck),
      camp as (
        select date, ${campaignKeySql('campaign_name')} as ck, sum(impressions) as i, sum(clicks) as c, sum(spend) as sp
        from daily_campaign_ads
        where profile_id = ${profileId} and channel = 'sb' and date between ${from} and ${to}
        group by date, ck
      )
      select a.asin,
             coalesce(sum(case when t.s > 0 then c.i  * a.ad_sales / t.s end), 0) as impressions,
             coalesce(sum(case when t.s > 0 then c.c  * a.ad_sales / t.s end), 0) as clicks,
             coalesce(sum(case when t.s > 0 then c.sp * a.ad_sales / t.s end), 0) as spend,
             sum(a.ad_sales) as ad_sales, sum(a.ad_units) as ad_units
      from attr a
      join tot t on t.date = a.date and t.ck = a.ck
      left join camp c on c.date = a.date and c.ck = a.ck
      group by a.asin`),
  ]);
  const out = new Map<string, AdBase>();
  for (const r of [...spsd, ...sb]) {
    const v: AdBase = {
      impressions: Number(r.impressions),
      clicks: Number(r.clicks),
      spend: Number(r.spend),
      adSales: Number(r.ad_sales),
      adUnits: Number(r.ad_units),
    };
    out.set(r.asin, addAdBase(out.get(r.asin) ?? emptyAdBase(), v));
  }
  return out;
}
