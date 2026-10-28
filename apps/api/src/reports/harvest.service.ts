import type { HarvestChannel, HarvestResponse, HarvestRow, HarvestSort } from '@dash/shared';
import { sql } from 'drizzle-orm';

import { db } from '../db/client';
import { targetTypeSql } from './dims';
import { decideHarvest, isAsinTerm } from './harvest-rules';

export interface HarvestOptions {
  days: number;
  minOrders: number;
  q?: string | undefined;
  harvestInto?: HarvestChannel | undefined;
  performingIn?: HarvestChannel | undefined;
  kind?: 'Keyword' | 'ASIN' | undefined;
  sort: HarvestSort;
  limit: number;
}

/** How far back a manual target counts as "already targeted" (a keyword with no traffic in a short window is still set up). */
const MANUAL_LOOKBACK_DAYS = 60;

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * Keyword harvesting from SP + SB search-term reports: customer search terms
 * with multiple orders in the last N days that aren't manually targeted in SP,
 * SB or both.
 *
 * "Manually targeted in a channel" = the term is a keyword target (exact /
 * phrase / broad — the keyword text equals the term) or an ASIN product target
 * (asin="…") in that channel, at any point in the last 60 days. GCS warehouse
 * search terms have no Targeting column, so for them it falls back to "ran in
 * a manual keyword / product campaign (KT / PT in the campaign name)".
 */
export async function getHarvest(profileId: string, o: HarvestOptions): Promise<HarvestResponse> {
  const empty: HarvestResponse = {
    profileId,
    days: o.days,
    from: null,
    to: null,
    minOrders: o.minOrders,
    kpis: { terms: 0, intoBoth: 0, intoSp: 0, intoSb: 0, orders: 0, adSales: 0 },
    rows: [],
    totalRows: 0,
    truncated: false,
    approximateTargeting: false,
    notes: [],
  };
  const [latest] = await db.execute<{ to: string | null }>(sql`
    select max(date)::text as "to" from daily_search_terms where profile_id = ${profileId} and channel in ('sp', 'sb')`);
  const to = latest?.to ?? null;
  if (!to) return { ...empty, notes: ['No SP / SB search-term reports uploaded for this profile yet.'] };
  const from = addDays(to, -(o.days - 1));
  const manualFrom = addDays(to, -(Math.max(o.days, MANUAL_LOOKBACK_DAYS) - 1));

  const st = sql.raw('st');
  const tType = targetTypeSql(sql`${st}.target`, sql`${st}.match_type`, sql`${st}.channel`);
  const via = sql`upper(st.channel) || ' · ' || case
      when st.match_type in ('EXACT', 'PHRASE', 'BROAD') then initcap(st.match_type)
      when st.match_type like '%BROAD%' then 'Broad'
      else ${tType} end`;

  const rows = await db.execute<{
    search_term: string;
    orders: string;
    sp_orders: string | null;
    sb_orders: string | null;
    impressions: string;
    clicks: string;
    spend: string;
    ad_sales: string;
    found_via: string[] | null;
    campaigns: string;
    top_campaigns: string[] | null;
    manual_sp: boolean;
    manual_sb: boolean;
  }>(sql`
    with w as (
      select st.search_term, st.channel, st.campaign_name, st.impressions, st.clicks, st.spend, st.ad_sales,
             coalesce(st.ad_orders, st.ad_units) as orders, ${via} as via
      from daily_search_terms st
      where st.profile_id = ${profileId} and st.date between ${from} and ${to}
        and st.channel in ('sp', 'sb') and st.search_term <> ''
    ),
    agg as (
      select search_term, sum(orders) as orders,
             coalesce(sum(orders) filter (where channel = 'sp'), 0) as sp_orders,
             coalesce(sum(orders) filter (where channel = 'sb'), 0) as sb_orders,
             sum(impressions) as impressions, sum(clicks) as clicks, sum(spend) as spend, sum(ad_sales) as ad_sales,
             array_agg(distinct via) filter (where orders > 0) as found_via,
             count(distinct campaign_name) as campaigns
      from w group by 1 having sum(orders) >= ${o.minOrders}
    ),
    manual as (
      select distinct st.channel,
             case when st.target like 'asin="%' then split_part(st.target, '"', 2)
                  when st.target <> '' then st.target
                  else st.search_term end as term
      from daily_search_terms st
      where st.profile_id = ${profileId} and st.date between ${manualFrom} and ${to} and st.channel in ('sp', 'sb')
        and ((st.target <> '' and (st.match_type in ('EXACT', 'PHRASE', 'BROAD') or st.match_type like '%BROAD%'))
             or st.target like 'asin="%'
             or (st.target = '' and st.match_type in ('KT', 'PT')))
    ),
    cp as (
      select search_term, (array_agg(campaign_name order by o desc, campaign_name))[1:3] as top_campaigns
      from (select w.search_term, w.campaign_name, sum(w.orders) as o
            from w join agg using (search_term) group by 1, 2) x
      group by 1
    )
    select agg.*, cp.top_campaigns,
           exists (select 1 from manual m where m.channel = 'sp' and m.term = agg.search_term) as manual_sp,
           exists (select 1 from manual m where m.channel = 'sb' and m.term = agg.search_term) as manual_sb
    from agg left join cp using (search_term)`);

  const [approx] = await db.execute<{ n: string }>(sql`
    select count(*) as n from daily_search_terms
    where profile_id = ${profileId} and date between ${manualFrom} and ${to} and channel in ('sp', 'sb') and target = ''`);
  const approximateTargeting = Number(approx?.n ?? 0) > 0;

  const all: HarvestRow[] = [];
  for (const r of rows) {
    const orders = Number(r.orders);
    const spOrders = Number(r.sp_orders ?? 0);
    const sbOrders = Number(r.sb_orders ?? 0);
    const d = decideHarvest({ orders, spOrders, sbOrders, manualSp: r.manual_sp, manualSb: r.manual_sb, minOrders: o.minOrders });
    if (!d) continue;
    const clicks = Number(r.clicks);
    const spend = Number(r.spend);
    const adSales = Number(r.ad_sales);
    all.push({
      searchTerm: r.search_term,
      kind: isAsinTerm(r.search_term) ? 'ASIN' : 'Keyword',
      orders,
      spOrders,
      sbOrders,
      impressions: Number(r.impressions),
      clicks,
      spend,
      adSales,
      acosPct: adSales ? (spend / adSales) * 100 : null,
      cvrPct: clicks ? (orders / clicks) * 100 : null,
      performingIn: d.performingIn,
      manualSp: r.manual_sp,
      manualSb: r.manual_sb,
      harvestInto: d.harvestInto,
      foundVia: (r.found_via ?? []).filter(Boolean).sort(),
      campaigns: (r.top_campaigns ?? []).filter(Boolean),
      campaignCount: Number(r.campaigns),
    });
  }

  const kpis = {
    terms: all.length,
    intoBoth: all.filter((r) => r.harvestInto === 'SP & SB').length,
    intoSp: all.filter((r) => r.harvestInto === 'SP').length,
    intoSb: all.filter((r) => r.harvestInto === 'SB').length,
    orders: all.reduce((a, r) => a + r.orders, 0),
    adSales: all.reduce((a, r) => a + r.adSales, 0),
  };

  const needle = o.q?.toLowerCase();
  const key: Record<HarvestSort, (r: HarvestRow) => number | null> = {
    orders: (r) => r.orders,
    adSales: (r) => r.adSales,
    spend: (r) => r.spend,
    // Lowest ACoS first for this one; terms with no sales last.
    acos: (r) => (r.acosPct == null ? null : -r.acosPct),
    cvr: (r) => r.cvrPct,
  };
  const k = key[o.sort];
  const filtered = all
    .filter(
      (r) =>
        (!needle || r.searchTerm.includes(needle)) &&
        (!o.harvestInto || r.harvestInto === o.harvestInto) &&
        (!o.performingIn || r.performingIn === o.performingIn) &&
        (!o.kind || r.kind === o.kind)
    )
    .sort((a, b) => {
      const av = k(a);
      const bv = k(b);
      if (av == null || bv == null) return av == null && bv == null ? b.orders - a.orders : av == null ? 1 : -1;
      return bv - av || b.orders - a.orders || a.searchTerm.localeCompare(b.searchTerm);
    });

  const notes = [
    `Search terms with ${o.minOrders}+ orders across SP and SB in the last ${o.days} days (${from} – ${to}, ending on the latest search-term data) that aren't a manual target in SP, SB or both.`,
    `Manual target = the term is an exact / phrase / broad keyword, or an ASIN target (asin="…"), in that channel at any time in the last ${Math.max(o.days, MANUAL_LOOKBACK_DAYS)} days. Terms already targeted manually in both SP and SB are left out.`,
    'Orders are "Total Orders (#)"; search-term data uploaded before this change only has units, which stand in for orders until it is re-uploaded.',
  ];
  if (approximateTargeting)
    notes.unshift(
      'Some search-term data here has no Targeting column (GCS warehouse export), so for it "manual target" means the term ran in a manual keyword / product campaign (KT / PT in the campaign name). A broad or phrase keyword in such a campaign can make a term look targeted when it isn\'t — upload the console search-term report with the Targeting column for an exact check.'
    );
  if (filtered.length > o.limit) notes.push(`Showing the first ${o.limit} of ${filtered.length} terms. Use search to find others.`);

  return {
    ...empty,
    from,
    to,
    kpis,
    rows: filtered.slice(0, o.limit),
    totalRows: filtered.length,
    truncated: filtered.length > o.limit,
    approximateTargeting,
    notes,
  };
}
