import { deriveAd, type AdChannelFilter, type SearchTermResponse } from '@dash/shared';
import { sql, type SQL } from 'drizzle-orm';

import { db } from '../db/client';
import { getBrandTerms, targetTypeSql, termClassJoin } from './dims';
import { adFilterOptions, dimsJoin, dimsWhere, toBase, type AdFilters, type Agg } from './filters';

export type SearchTermSort = 'spend' | 'adSales' | 'clicks' | 'impressions' | 'adUnits';

const SORT_SQL: Record<SearchTermSort, string> = {
  spend: 'sum(st.spend)',
  adSales: 'sum(st.ad_sales)',
  clicks: 'sum(st.clicks)',
  impressions: 'sum(st.impressions)',
  adUnits: 'sum(st.ad_units)',
};

/**
 * Search Terms: SP + SB customer search terms and SD targets, grouped by term
 * across campaigns, with the targets that triggered each term and the
 * campaigns it ran in. Category / ad type come from campaign_dims (§3);
 * targeting type and Branded / Competitor / Generic are per row.
 */
export async function getSearchTerms(
  profileId: string,
  from: string,
  to: string,
  opts: AdFilters & { channel: AdChannelFilter; q?: string | undefined; sort: SearchTermSort; limit: number }
): Promise<SearchTermResponse> {
  const hasTerms = (await getBrandTerms(profileId)).length > 0;
  const st = sql.raw('st');
  const tType = targetTypeSql(sql`${st}.target`, sql`${st}.match_type`, sql`${st}.channel`);
  const tClass = sql`coalesce(tc.branding, 'Generic')`;

  const conds: SQL[] = [sql`st.profile_id = ${profileId}`, sql`st.date between ${from} and ${to}`];
  if (opts.channel !== 'all') conds.push(sql`st.channel = ${opts.channel}`);
  if (opts.q) conds.push(sql`st.search_term ilike ${'%' + opts.q.toLowerCase() + '%'}`);
  conds.push(...dimsWhere(opts, { targeting: tType, branding: tClass }));

  const base = sql`
    with f as (
      select st.search_term, st.channel, st.target, st.campaign_name,
             ${tType} as target_type, ${tClass} as branding,
             st.impressions, st.clicks, st.spend, st.ad_sales, st.ad_units
      from daily_search_terms st ${dimsJoin('st')} ${termClassJoin('st')}
      where ${sql.join(conds, sql` and `)}
    )`;

  const [rows, totals, options] = await Promise.all([
    db.execute<
      Agg & {
        search_term: string;
        channels: string;
        branding: string;
        target_types: string[];
        targets: string[];
        target_count: string;
        campaign_names: string[];
        campaigns: string;
      }
    >(sql`${base},
      top as (
        select search_term, ${sql.raw(SORT_SQL[opts.sort].replace('st.', ''))} as sort_v,
               sum(impressions) as impressions, sum(clicks) as clicks, sum(spend) as spend,
               sum(ad_sales) as ad_sales, sum(ad_units) as ad_units,
               string_agg(distinct channel, ',') as channels, min(branding) as branding,
               array_agg(distinct target_type) as target_types,
               count(distinct target) as target_count, count(distinct campaign_name) as campaigns
        from f group by search_term
        order by 2 desc, search_term
        limit ${opts.limit}
      ),
      tg as (
        select search_term, (array_agg(target order by s desc))[1:10] as targets
        from (select f.search_term, f.target, sum(f.spend) + 0.0001 * sum(f.impressions) as s
              from f join top using (search_term) group by 1, 2) x group by 1
      ),
      cp as (
        select search_term, (array_agg(campaign_name order by s desc))[1:10] as campaign_names
        from (select f.search_term, f.campaign_name, sum(f.spend) + 0.0001 * sum(f.impressions) as s
              from f join top using (search_term) group by 1, 2) x group by 1
      )
      select top.*, tg.targets, cp.campaign_names
      from top left join tg using (search_term) left join cp using (search_term)
      order by top.sort_v desc, top.search_term`),
    db.execute<Agg & { terms: string }>(sql`${base}
      select count(distinct search_term) as terms,
             sum(impressions) as impressions, sum(clicks) as clicks, sum(spend) as spend,
             sum(ad_sales) as ad_sales, sum(ad_units) as ad_units
      from f`),
    adFilterOptions(profileId),
  ]);

  const t = totals[0];
  const totalTerms = Number(t?.terms ?? 0);
  const notes: string[] = [];
  if (!hasTerms) notes.push('No brand terms set — nothing is classed "Branded" except own ASINs. Set them on the Ads Analysis tab.');
  if (totalTerms > rows.length) notes.push(`Showing the top ${rows.length} of ${totalTerms} terms by ${opts.sort}. Use search to find others.`);

  return {
    profileId,
    from,
    to,
    total: deriveAd(toBase(t)),
    totalTerms,
    truncated: totalTerms > rows.length,
    rows: rows.map((r) => ({
      searchTerm: r.search_term,
      channels: (r.channels ?? '')
        .split(',')
        .map((c) => c.toUpperCase())
        .sort((a, b) => ['SP', 'SB', 'SD'].indexOf(a) - ['SP', 'SB', 'SD'].indexOf(b))
        .join(' & '),
      branding: r.branding,
      targetTypes: (r.target_types ?? []).filter(Boolean),
      targets: (r.targets ?? []).filter(Boolean),
      targetCount: Number(r.target_count),
      campaignNames: (r.campaign_names ?? []).filter(Boolean),
      campaigns: Number(r.campaigns),
      ...deriveAd(toBase(r)),
    })),
    filterOptions: options,
    notes,
  };
}
