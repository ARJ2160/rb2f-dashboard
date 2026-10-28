import type { SqpLaunch, SqpPeriod, SqpResponse, SqpSort, SqpStrength, SqpTargeted, SqpView } from '@dash/shared';
import { sql } from 'drizzle-orm';

import { db } from '../db/client';
import { compareBy, scoreQuery, type SqpCounts, type Targeting } from './sqp-scoring';

export interface SqpOptions {
  periodStart?: string | undefined;
  periodEnd?: string | undefined;
  view: SqpView;
  q?: string | undefined;
  launchIn?: Exclude<SqpLaunch, null> | undefined;
  targeted?: SqpTargeted | undefined;
  strength?: SqpStrength | undefined;
  sort: SqpSort;
  minClicks: number;
  limit: number;
}

const days = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;

/**
 * SQP tab (eigen's "Search Opportunities"): brand-vs-category engagement per
 * customer query from Search Query Performance, joined to what is actually
 * targeted (daily_search_terms.target, SP + SB) in the same period.
 *
 * Picks a whole reporting period — never an arbitrary date range, because the
 * report has no daily breakdown. Defaults to the newest period.
 */
export async function getSqp(profileId: string, o: SqpOptions): Promise<SqpResponse> {
  const periodRows = await db.execute<{ from: string; to: string; queries: string }>(sql`
    select period_start::text as "from", period_end::text as "to", count(*) as queries
    from search_query_performance where profile_id = ${profileId}
    group by 1, 2 order by 1 desc, 2 desc`);
  const periods: SqpPeriod[] = periodRows.map((p) => ({ from: p.from, to: p.to, queries: Number(p.queries) }));

  const empty: SqpResponse = {
    profileId,
    periods,
    period: null,
    accountAcosPct: null,
    minBrandClicks: o.minClicks,
    kpis: { opportunities: 0, strong: 0, medium: 0, low: 0, launchSp: 0, launchSb: 0, launchBoth: 0, queries: 0 },
    rows: [],
    totalRows: 0,
    truncated: false,
    notes: [],
  };
  if (!periods.length) return empty;

  const period =
    periods.find((p) => p.from === o.periodStart && (!o.periodEnd || p.to === o.periodEnd)) ?? periods[0]!;

  const inPeriod = sql`st.profile_id = ${profileId} and st.date between ${period.from} and ${period.to}`;
  const [queryRows, targetRows, account] = await Promise.all([
    db.execute<Record<string, string | number>>(sql`
      select search_query, volume, impressions_total, impressions_brand, clicks_total, clicks_brand,
             cart_adds_total, cart_adds_brand, purchases_total, purchases_brand
      from search_query_performance
      where profile_id = ${profileId} and period_start = ${period.from} and period_end = ${period.to}`),
    // Bounded to queries in the report; product targets (asin="B0…") never match a phrase, which is right.
    db.execute<{ target: string; channel: string; spend: string; ad_sales: string }>(sql`
      select st.target, st.channel, sum(st.spend) as spend, sum(st.ad_sales) as ad_sales
      from daily_search_terms st
      where ${inPeriod} and st.channel in ('sp', 'sb')
        and st.target in (select search_query from search_query_performance
                          where profile_id = ${profileId} and period_start = ${period.from} and period_end = ${period.to})
      group by 1, 2`),
    db.execute<{ spend: string | null; ad_sales: string | null; days: string }>(sql`
      select sum(st.spend) as spend, sum(st.ad_sales) as ad_sales, count(distinct st.date) as days
      from daily_search_terms st where ${inPeriod}`),
  ]);

  const targeting = new Map<string, Targeting>();
  for (const r of targetRows) {
    const t = targeting.get(r.target) ?? { channels: [], spend: 0, adSales: 0 };
    const ch = r.channel === 'sp' ? 'SP' : 'SB';
    if (!t.channels.includes(ch)) t.channels.push(ch);
    t.spend += Number(r.spend ?? 0);
    t.adSales += Number(r.ad_sales ?? 0);
    targeting.set(r.target, t);
  }
  const a = account[0];
  const accSpend = Number(a?.spend ?? 0);
  const accSales = Number(a?.ad_sales ?? 0);
  const accountAcosPct = accSales ? Number(((accSpend / accSales) * 100).toFixed(2)) : null;

  const scored = queryRows.map((r) => {
    const c: SqpCounts = {
      searchQuery: String(r.search_query),
      volume: Number(r.volume),
      impressionsTotal: Number(r.impressions_total),
      impressionsBrand: Number(r.impressions_brand),
      clicksTotal: Number(r.clicks_total),
      clicksBrand: Number(r.clicks_brand),
      cartAddsTotal: Number(r.cart_adds_total),
      cartAddsBrand: Number(r.cart_adds_brand),
      purchasesTotal: Number(r.purchases_total),
      purchasesBrand: Number(r.purchases_brand),
    };
    return scoreQuery(c, targeting.get(c.searchQuery), accountAcosPct, o.minClicks);
  });

  // KPIs cover the whole period — they must not move while the user filters.
  const opps = scored.filter((s) => s.isOpportunity);
  const kpis = {
    opportunities: opps.length,
    strong: opps.filter((s) => s.strength === 'Strong').length,
    medium: opps.filter((s) => s.strength === 'Medium').length,
    low: opps.filter((s) => s.strength === 'Low').length,
    launchSp: opps.filter((s) => s.launchIn === 'SP').length,
    launchSb: opps.filter((s) => s.launchIn === 'SB').length,
    launchBoth: opps.filter((s) => s.launchIn === 'SP & SB').length,
    queries: scored.length,
  };

  const needle = o.q?.toLowerCase();
  const filtered = (o.view === 'report' ? scored : opps)
    .filter(
      (s) =>
        (!needle || s.query.includes(needle)) &&
        (!o.launchIn || s.launchIn === o.launchIn) &&
        (!o.targeted || s.targeted === o.targeted) &&
        (o.view === 'report' || !o.strength || s.strength === o.strength)
    )
    .sort(compareBy(o.sort));

  const notes: string[] = [];
  const stDays = Number(a?.days ?? 0);
  const pDays = days(period.from, period.to);
  if (stDays === 0)
    notes.push(
      `No SP / SB search-term data for ${period.from} – ${period.to}, so every query shows as Not Targeted and spend / ACoS are blank. Upload the search-term reports for this period to see targeting.`
    );
  else if (stDays < pDays)
    notes.push(`Search-term data covers ${stDays} of the period's ${pDays} days — targeting, spend and ACoS only count those days.`);
  if (filtered.length > o.limit) notes.push(`Showing the first ${o.limit} of ${filtered.length} queries. Use search to find others.`);
  notes.push(
    //`Opportunity strength = how many of the brand's CTR, add-to-cart % and purchase % beat the category for that query: 1 = Low, 2 = Medium, all 3 = Strong. Brand clicks must be above ${o.minClicks}, and queries already targeted in both SP and SB are left out.`,
    //'Targeted = the query is bid on as a keyword (SP / SB "Targeting"), not merely shown as a triggered search term. Spend and ACoS are that keyword\'s own and are blank when it isn\'t targeted; ACoS is green / red against the account ACoS for the period.'
  );

  return {
    ...empty,
    period,
    accountAcosPct,
    kpis,
    rows: filtered.slice(0, o.limit),
    totalRows: filtered.length,
    truncated: filtered.length > o.limit,
    notes,
  };
}
