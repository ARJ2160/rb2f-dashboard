import { addAdBase, deriveAd, emptyAdBase, pct, type AdBase, type AdGroupRow, type AdsResponse } from '@dash/shared';
import { sql, type SQL } from 'drizzle-orm';

import { db } from '../db/client';
import { getBrandTerms, targetTypeSql, termClassJoin } from './dims';
import { adFilterOptions, dimsJoin, dimsWhere, toBase, type AdFilters, type Agg } from './filters';

const ORDER = {
  adTypes: ['SP', 'SB', 'SBV', 'SD', 'SDV', 'Unknown'],
  targeting: ['Keyword', 'Product', 'Category', 'Auto', 'Audience', 'Other'],
  branding: ['Branded', 'Competitor', 'Generic'],
};

function group(rows: Array<Agg & { key: string; n: string }>, order: string[]) {
  const total: AdBase = rows.reduce((a, r) => addAdBase(a, toBase(r)), emptyAdBase());
  const out: AdGroupRow[] = rows
    .map((r) => ({ key: r.key, count: Number(r.n), spendSharePct: pct(Number(r.spend), total.spend), ...deriveAd(toBase(r)) }))
    .sort((a, b) => (order.indexOf(a.key) + 1 || 99) - (order.indexOf(b.key) + 1 || 99) || b.spend - a.spend);
  return { total: deriveAd(total), rows: out };
}

/**
 * Ads analysis.
 *   Ad types (SP / SB / SBV / SD / SDV) — campaign level. SP and SD come from
 *     the Advertised Product reports (falling back to the campaign report on
 *     days without one); SB / SBV from the SB Campaign report, i.e. the FULL
 *     SB spend (the §5 proration only matters when splitting SB by ASIN) —
 *     unless SB has ASIN-level rows with spend (GCS warehouse), used like SP.
 *   Targeting types and Branded / Competitor / Generic — search-term level
 *     (SP + SB search term reports, SD targeting), classified per row.
 */
export async function getAds(profileId: string, from: string, to: string, f: AdFilters): Promise<AdsResponse> {
  const terms = await getBrandTerms(profileId);
  const st = sql.raw('st');
  const tType = targetTypeSql(sql`${st}.target`, sql`${st}.match_type`, sql`${st}.channel`);
  const tClass = sql`coalesce(tc.branding, 'Generic')`;

  const factConds = dimsWhere(f);
  const stConds: SQL[] = [
    sql`st.profile_id = ${profileId}`,
    sql`st.date between ${from} and ${to}`,
    ...dimsWhere(f, { targeting: tType, branding: tClass }),
  ];

  const [adTypes, targeting, branding, options] = await Promise.all([
    db.execute<Agg & { key: string; n: string }>(sql`
      with facts as (
        select a.profile_id, a.date, a.channel, a.campaign_name, sum(a.impressions) as impressions, sum(a.clicks) as clicks,
               sum(a.spend) as spend, sum(a.ad_sales) as ad_sales, sum(a.ad_units) as ad_units
        from daily_asin_campaign_ads a
        where a.profile_id = ${profileId} and a.date between ${from} and ${to}
        group by 1, 2, 3, 4
        union all
        select c.profile_id, c.date, c.channel, c.campaign_name, c.impressions, c.clicks, c.spend, c.ad_sales, c.ad_units
        from daily_campaign_ads c
        where c.profile_id = ${profileId} and c.date between ${from} and ${to}
          and not exists (
            select 1 from daily_asin_campaign_ads a
            where a.profile_id = c.profile_id and a.date = c.date and a.channel = c.channel)
      )
      select coalesce(cd.ad_type, upper(x.channel)) as key, count(distinct x.campaign_name) as n,
             sum(x.impressions) as impressions, sum(x.clicks) as clicks, sum(x.spend) as spend,
             sum(x.ad_sales) as ad_sales, sum(x.ad_units) as ad_units
      from facts x ${dimsJoin('x')}
      ${factConds.length ? sql`where ${sql.join(factConds, sql` and `)}` : sql``}
      group by 1`),
    db.execute<Agg & { key: string; n: string }>(sql`
      select ${tType} as key, count(distinct st.search_term) as n,
             sum(st.impressions) as impressions, sum(st.clicks) as clicks, sum(st.spend) as spend,
             sum(st.ad_sales) as ad_sales, sum(st.ad_units) as ad_units
      from daily_search_terms st ${dimsJoin('st')} ${termClassJoin('st')}
      where ${sql.join(stConds, sql` and `)}
      group by 1`),
    db.execute<Agg & { key: string; n: string }>(sql`
      select ${tClass} as key, count(distinct st.search_term) as n,
             sum(st.impressions) as impressions, sum(st.clicks) as clicks, sum(st.spend) as spend,
             sum(st.ad_sales) as ad_sales, sum(st.ad_units) as ad_units
      from daily_search_terms st ${dimsJoin('st')} ${termClassJoin('st')}
      where ${sql.join(stConds, sql` and `)}
      group by 1`),
    adFilterOptions(profileId),
  ]);

  const notes: string[] = [
    'Ad types use full campaign spend (SB from the SB Campaign report); the DSR shows only the SB spend that can be allocated to ASINs (rule book §5), so SB here can be higher.',
    'Targeting and Branded / Competitor / Generic come from the search term reports, so their totals match the Search Terms tab, not the DSR.',
  ];
  if (!terms.length) notes.push('No brand terms set — only your own ASINs count as Branded.');
  return {
    profileId,
    from,
    to,
    adTypes: group(adTypes, ORDER.adTypes),
    targeting: group(targeting, ORDER.targeting),
    branding: group(branding, ORDER.branding),
    brandTerms: terms,
    filterOptions: options,
    notes,
  };
}
