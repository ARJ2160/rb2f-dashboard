import {
  addInto,
  blank,
  type Sums,
  type FkAsinResponse,
  type FkCampaignsResponse,
  type FkCatAdvResponse,
  type FkDailyResponse,
  type FkDurResponse,
  type FkGroupsResponse,
  type FkKeywordsResponse,
  type FkMetaResponse,
  type FkPlacementsResponse,
  type FkSearchTermsResponse,
} from '@dash/shared/flipkart';

import { q } from '../blinkit/reports/queries';
import { canonCat, getFkDims } from './reports/dims';

/* Flipkart reports. Gross sales/units + combined traffic impr/clicks come from
   fk_daily_fsn_sales (per-day); returns / net from fk_daily_fsn_returns
   (per-day); ad metrics from the period-level fk_ad_* tables (a period is
   included when it falls within the dashboard range). Organic = traffic − ad. */

export interface RangeArgs {
  profileId: string;
  from: string;
  to: string;
  category?: string | undefined;
}

type Raw = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const AD_SUMS = `sum(impressions) impr, sum(clicks) clicks, sum(spend) spend, sum(ad_sales) asales, sum(ad_units) aunits`;
function adsRow(r: Raw): Sums {
  const a = blank();
  a.impr = n(r.impr);
  a.clicks = n(r.clicks);
  a.spend = n(r.spend);
  a.asales = n(r.asales);
  a.aunits = n(r.aunits);
  return a;
}
function salesRow(r: Raw): Sums {
  const a = blank();
  a.rev = n(r.rev);
  a.units = n(r.units);
  a.impr = n(r.impr);
  a.clicks = n(r.clicks);
  return a;
}
const getOrBlank = (m: Map<string, Sums>, k: string) => {
  let s = m.get(k);
  if (!s) m.set(k, (s = blank()));
  return s;
};
const dayCount = (from: string, to: string) =>
  Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);

// ── where-clause builders ────────────────────────────────────────────

/** fk_daily_fsn_sales rows in [from,to], optional category (via fk_fsn_map). alias s + m. */
function salesWhere(a: RangeArgs, params: unknown[]): string {
  params.push(a.profileId, a.from, a.to);
  let w = `s.profile_id=$1 and s.date between $2 and $3`;
  if (a.category) {
    params.push(canonCat(a.category));
    w += ` and upper(coalesce(m.category,'UNMAPPED')) = $${params.length}`;
  }
  return w;
}

/** period table (alias ap) within [from,to]; category via product→fsn_map when hasCategory. */
function adFsnWhere(a: RangeArgs, params: unknown[], hasCategory: boolean): string {
  params.push(a.profileId, a.from, a.to);
  let w = `ap.profile_id=$1 and ap.period_from >= $2 and ap.period_to <= $3`;
  if (hasCategory && a.category) {
    params.push(canonCat(a.category));
    w += ` and upper(coalesce(m.category,'UNMAPPED')) = $${params.length}`;
  }
  return w;
}

// ── Meta ─────────────────────────────────────────────────────────────

export async function meta(profileId: string): Promise<FkMetaResponse> {
  const d = await getFkDims(profileId);
  const [[salesAgg], [retAgg], periods, unmappedFsn, unmappedCamp] = await Promise.all([
    q<{ f: string; t: string; c: string }>(`select min(date) f, max(date) t, count(*) c from fk_daily_fsn_sales where profile_id=$1`, [profileId]),
    q<{ f: string; t: string; c: string }>(`select min(date) f, max(date) t, count(*) c from fk_daily_fsn_returns where profile_id=$1`, [profileId]),
    q<{ f: string; t: string; c: string }>(
      `select period_from f, period_to t, count(*) c from (
         select period_from,period_to from fk_ad_campaign where profile_id=$1
         union all select period_from,period_to from fk_ad_fsn where profile_id=$1
         union all select period_from,period_to from fk_ad_placement where profile_id=$1
         union all select period_from,period_to from fk_ad_search_term where profile_id=$1
         union all select period_from,period_to from fk_ad_keyword where profile_id=$1
       ) x group by 1,2 order by 1`,
      [profileId]
    ),
    q<{ fsn: string; name: string; rev: string }>(
      `select fsn, max(title) name, sum(revenue_gross) rev from fk_daily_fsn_sales s where profile_id=$1
         and not exists (select 1 from fk_fsn_map m where m.profile_id=s.profile_id and m.fsn=s.fsn)
       group by 1 order by 3 desc limit 50`,
      [profileId]
    ),
    q<{ name: string; spend: string }>(
      `select campaign_name name, sum(spend) spend from fk_ad_campaign c where profile_id=$1
         and not exists (select 1 from fk_campaign_map m where m.profile_id=c.profile_id and m.campaign_name=c.campaign_name)
       group by 1 order by 2 desc`,
      [profileId]
    ),
  ]);
  const notes: string[] = [];
  if (periods.length)
    notes.push('Ad reports have no per-row date; they are stored against the export window and shown when that window falls inside the selected range.');
  return {
    profileId,
    sales: { from: salesAgg?.f ?? null, to: salesAgg?.t ?? null, rows: n(salesAgg?.c) },
    earnMore: { from: retAgg?.f ?? null, to: retAgg?.t ?? null, rows: n(retAgg?.c) },
    ads: { periods: periods.map((p) => ({ from: p.f, to: p.t, rows: n(p.c) })) },
    categories: d.categories,
    campaigns: [...d.campaigns.values()].map((c) => ({ name: c.name, category: c.category })),
    unmappedFsns: unmappedFsn.map((r) => ({ fsn: r.fsn, name: r.name, rev: n(r.rev) })),
    unmappedCampaigns: unmappedCamp.map((r) => ({ name: r.name, spend: n(r.spend) })),
    notes,
  };
}

// ── Category / FSN groups (sales + ads) ──────────────────────────────

export async function groups(a: RangeArgs, groupBy: 'category' | 'fsn'): Promise<FkGroupsResponse> {
  const d = await getFkDims(a.profileId);
  const byCat = groupBy === 'category';
  const sp: unknown[] = [];
  const salesSql = byCat
    ? `select upper(coalesce(m.category,'UNMAPPED')) k, sum(s.revenue_gross) rev, sum(s.units) units, sum(s.impressions_total) impr, sum(s.clicks_total) clicks
       from fk_daily_fsn_sales s left join fk_fsn_map m on m.profile_id=s.profile_id and m.fsn=s.fsn
       where ${salesWhere(a, sp)} group by 1`
    : `select s.fsn k, sum(s.revenue_gross) rev, sum(s.units) units, sum(s.impressions_total) impr, sum(s.clicks_total) clicks
       from fk_daily_fsn_sales s left join fk_fsn_map m on m.profile_id=s.profile_id and m.fsn=s.fsn
       where ${salesWhere(a, sp)} group by 1`;
  const ap: unknown[] = [];
  const adSql = byCat
    ? `select upper(coalesce(m.category,'UNMAPPED')) k, ${AD_SUMS}
       from fk_ad_fsn ap left join fk_fsn_map m on m.profile_id=ap.profile_id and m.fsn=ap.fsn
       where ${adFsnWhere(a, ap, true)} group by 1`
    : `select ap.fsn k, ${AD_SUMS}
       from fk_ad_fsn ap left join fk_fsn_map m on m.profile_id=ap.profile_id and m.fsn=ap.fsn
       where ${adFsnWhere(a, ap, true)} group by 1`;
  const [salesRows, adRows] = await Promise.all([q<Raw>(salesSql, sp), q<Raw>(adSql, ap)]);
  const map = new Map<string, Sums>();
  for (const r of salesRows) addInto(getOrBlank(map, String(r.k)), salesRow(r));
  for (const r of adRows) addInto(getOrBlank(map, String(r.k)), adsRow(r));
  const total = blank();
  const groupsOut = [...map.entries()].map(([k, sums]) => {
    addInto(total, sums);
    const key = byCat ? k : d.fsns.get(k)?.name || k;
    return { key, sums };
  });
  groupsOut.sort((x, y) => y.sums.rev - x.sums.rev || y.sums.asales - x.sums.asales);
  return { from: a.from, to: a.to, days: dayCount(a.from, a.to), total, groups: groupsOut };
}

// ── DSR (daily gross + net; range-level ads & organic funnel) ────────

export async function daily(a: RangeArgs): Promise<FkDailyResponse> {
  const sp: unknown[] = [];
  const salesDaily = await q<{ d: string; rev: string; units: string; impr: string; clicks: string }>(
    `select s.date d, sum(s.revenue_gross) rev, sum(s.units) units, sum(s.impressions_total) impr, sum(s.clicks_total) clicks
     from fk_daily_fsn_sales s left join fk_fsn_map m on m.profile_id=s.profile_id and m.fsn=s.fsn
     where ${salesWhere(a, sp)} group by 1 order by 1`,
    sp
  );
  const rp: unknown[] = [];
  const retDaily = await q<{ d: string; ret: string; canc: string; nrev: string; nunits: string }>(
    `select s.date d, sum(s.returns_units) ret, sum(s.cancellations_units) canc, sum(s.net_revenue) nrev, sum(s.net_units) nunits
     from fk_daily_fsn_returns s left join fk_fsn_map m on m.profile_id=s.profile_id and m.fsn=s.fsn
     where ${salesWhere(a, rp)} group by 1 order by 1`,
    rp
  );
  const ap: unknown[] = [];
  const [adAgg] = await q<Raw>(
    `select ${AD_SUMS} from fk_ad_fsn ap left join fk_fsn_map m on m.profile_id=ap.profile_id and m.fsn=ap.fsn
     where ${adFsnWhere(a, ap, true)}`,
    ap
  );

  const ret = new Map(retDaily.map((r) => [r.d, r]));
  const dates = [...new Set([...salesDaily.map((r) => r.d), ...retDaily.map((r) => r.d)])].sort();
  const salesByD = new Map(salesDaily.map((r) => [r.d, r]));
  const rows = dates.map((d) => {
    const s = salesByD.get(d);
    const r = ret.get(d);
    return {
      date: d,
      grossRev: n(s?.rev),
      grossUnits: n(s?.units),
      netRev: n(r?.nrev),
      netUnits: n(r?.nunits),
      returnsUnits: n(r?.ret),
      cancellationsUnits: n(r?.canc),
      trafficImpr: n(s?.impr),
      trafficClicks: n(s?.clicks),
    };
  });

  const grossRev = rows.reduce((t, x) => t + x.grossRev, 0);
  const grossUnits = rows.reduce((t, x) => t + x.grossUnits, 0);
  const netRev = rows.reduce((t, x) => t + x.netRev, 0);
  const netUnits = rows.reduce((t, x) => t + x.netUnits, 0);
  const returnsUnits = rows.reduce((t, x) => t + x.returnsUnits, 0);
  const cancellationsUnits = rows.reduce((t, x) => t + x.cancellationsUnits, 0);
  const trafficImpr = rows.reduce((t, x) => t + x.trafficImpr, 0);
  const trafficClicks = rows.reduce((t, x) => t + x.trafficClicks, 0);
  const adImpr = n(adAgg?.impr);
  const adClicks = n(adAgg?.clicks);
  const adSales = n(adAgg?.asales);

  const notes: string[] = [];
  if (adImpr > trafficImpr)
    notes.push('Ad impressions exceed total traffic impressions in this range — the ad export window likely extends beyond the sales dates; organic impressions are not meaningful here.');
  return {
    from: a.from,
    to: a.to,
    dates,
    rows,
    totals: {
      grossRev,
      grossUnits,
      netRev,
      netUnits,
      returnsUnits,
      cancellationsUnits,
      trafficImpr,
      trafficClicks,
      adImpr,
      adClicks,
      adSpend: n(adAgg?.spend),
      adSales,
      adUnits: n(adAgg?.aunits),
      organicImpr: trafficImpr - adImpr,
      organicClicks: trafficClicks - adClicks,
      organicSales: grossRev - adSales,
    },
    notes,
  };
}

// ── DUR (FSN × date) ─────────────────────────────────────────────────

export async function dur(a: RangeArgs, metric: 'units' | 'rev' | 'net_units'): Promise<FkDurResponse> {
  const d = await getFkDims(a.profileId);
  const sp: unknown[] = [];
  const net = metric === 'net_units';
  const col = metric === 'rev' ? 's.revenue_gross' : metric === 'net_units' ? 's.net_units' : 's.units';
  const table = net ? 'fk_daily_fsn_returns' : 'fk_daily_fsn_sales';
  const rows = await q<{ fsn: string; d: string; v: string }>(
    `select s.fsn fsn, s.date d, sum(${col}) v
     from ${table} s left join fk_fsn_map m on m.profile_id=s.profile_id and m.fsn=s.fsn
     where ${salesWhere(a, sp)} group by 1,2`,
    sp
  );
  const dates = [...new Set(rows.map((r) => r.d))].sort();
  const di = new Map(dates.map((x, i) => [x, i]));
  const byFsn = new Map<string, number[]>();
  for (const r of rows) {
    let arr = byFsn.get(r.fsn);
    if (!arr) byFsn.set(r.fsn, (arr = new Array(dates.length).fill(0)));
    arr[di.get(r.d)!] = n(r.v);
  }
  const out = [...byFsn.entries()].map(([fsn, values]) => {
    const dim = d.fsns.get(fsn);
    return { fsn, name: dim?.name || fsn, category: dim?.category || 'UNMAPPED', values, total: values.reduce((t, x) => t + x, 0) };
  });
  out.sort((x, y) => y.total - x.total);
  return { dates, metric, rows: out };
}

// ── Consolidated FSN (ASIN-level): ads + revenue from traffic ────────

export async function asinLevel(a: RangeArgs & { sort?: string; dir?: 'asc' | 'desc'; limit?: number }): Promise<FkAsinResponse> {
  const d = await getFkDims(a.profileId);
  const ap: unknown[] = [];
  const adRows = await q<Raw>(
    `select ap.fsn k, ${AD_SUMS} from fk_ad_fsn ap left join fk_fsn_map m on m.profile_id=ap.profile_id and m.fsn=ap.fsn
     where ${adFsnWhere(a, ap, true)} group by 1`,
    ap
  );
  const sp: unknown[] = [];
  const salesRows = await q<{ k: string; rev: string; units: string }>(
    `select s.fsn k, sum(s.revenue_gross) rev, sum(s.units) units
     from fk_daily_fsn_sales s left join fk_fsn_map m on m.profile_id=s.profile_id and m.fsn=s.fsn
     where ${salesWhere(a, sp)} group by 1`,
    sp
  );
  const map = new Map<string, Sums>();
  for (const r of adRows) addInto(getOrBlank(map, String(r.k)), adsRow(r));
  for (const r of salesRows) {
    const s = getOrBlank(map, r.k);
    s.rev += n(r.rev);
    s.units += n(r.units);
  }
  const total = blank();
  let rows = [...map.entries()].map(([fsn, sums]) => {
    addInto(total, sums);
    const dim = d.fsns.get(fsn);
    return { fsn, name: dim?.name || fsn, category: dim?.category || 'UNMAPPED', sums };
  });
  rows.sort((x, y) => y.sums.asales - x.sums.asales || y.sums.rev - x.sums.rev);
  const limit = a.limit ?? 2000;
  const truncated = rows.length > limit;
  if (truncated) rows = rows.slice(0, limit);
  return { rows, total, truncated };
}

// ── Keywords / Search terms / Placements / Category-advertised / Campaigns ──

async function adGroup(a: RangeArgs, table: string, keyCol: string): Promise<{ rows: { key: string; campaigns: Set<string>; sums: Sums }[]; total: Sums }> {
  const ap: unknown[] = [];
  const rows = await q<Raw>(
    `select ${keyCol} k, campaign_name cname, ${AD_SUMS} from ${table} ap
     where ${adFsnWhere(a, ap, false)} group by 1,2`,
    ap
  );
  const map = new Map<string, { key: string; campaigns: Set<string>; sums: Sums }>();
  const total = blank();
  for (const r of rows) {
    const key = String(r.k ?? '');
    let e = map.get(key);
    if (!e) map.set(key, (e = { key, campaigns: new Set(), sums: blank() }));
    if (r.cname) e.campaigns.add(String(r.cname));
    addInto(e.sums, adsRow(r));
    addInto(total, adsRow(r));
  }
  return { rows: [...map.values()], total };
}

export async function keywords(a: RangeArgs & { limit?: number }): Promise<FkKeywordsResponse> {
  const d = await getFkDims(a.profileId);
  const { rows, total } = await adGroup(a, 'fk_ad_keyword', 'keyword');
  let out = rows.map((e) => {
    const cs = [...e.campaigns];
    const cat = cs.map((c) => d.campaigns.get(c.toLowerCase().replace(/\s+/g, ' '))?.category).find((c) => c && c !== 'UNMAPPED') ?? 'UNMAPPED';
    return { keyword: e.key, matchType: '', campaign: cs[0] ?? null, campaigns: cs, category: cat, sums: e.sums };
  });
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  const limit = a.limit ?? 1000;
  const truncated = out.length > limit;
  if (truncated) out = out.slice(0, limit);
  return { rows: out, total, truncated };
}

export async function searchTerms(a: RangeArgs & { limit?: number }): Promise<FkSearchTermsResponse> {
  const d = await getFkDims(a.profileId);
  const { rows, total } = await adGroup(a, 'fk_ad_search_term', 'search_term');
  let out = rows.map((e) => {
    const cs = [...e.campaigns];
    const cat = cs.map((c) => d.campaigns.get(c.toLowerCase().replace(/\s+/g, ' '))?.category).find((c) => c && c !== 'UNMAPPED') ?? 'UNMAPPED';
    return { searchTerm: e.key, campaign: cs[0] ?? null, category: cat, sums: e.sums };
  });
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  const limit = a.limit ?? 1000;
  const truncated = out.length > limit;
  if (truncated) out = out.slice(0, limit);
  return { rows: out, total, truncated };
}

export async function placements(a: RangeArgs): Promise<FkPlacementsResponse> {
  const { rows, total } = await adGroup(a, 'fk_ad_placement', 'placement');
  const out = rows.map((e) => ({ placement: e.key, category: 'ALL', sums: e.sums }));
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}

export async function categoryAdvertised(a: RangeArgs): Promise<FkCatAdvResponse> {
  const ap: unknown[] = [];
  const rows = await q<Raw>(
    `select upper(coalesce(m.category,'UNMAPPED')) k, ${AD_SUMS}
     from fk_ad_fsn ap left join fk_fsn_map m on m.profile_id=ap.profile_id and m.fsn=ap.fsn
     where ${adFsnWhere(a, ap, true)} group by 1`,
    ap
  );
  const total = blank();
  const out = rows.map((r) => {
    const s = adsRow(r);
    addInto(total, s);
    return { category: String(r.k), sums: s };
  });
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}

export async function campaigns(a: RangeArgs): Promise<FkCampaignsResponse> {
  const d = await getFkDims(a.profileId);
  const { rows, total } = await adGroup(a, 'fk_ad_campaign', 'campaign_name');
  const out = rows.map((e) => {
    const cat = d.campaigns.get(e.key.toLowerCase().replace(/\s+/g, ' '))?.category ?? 'UNMAPPED';
    return { name: e.key, category: cat, sums: e.sums };
  });
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}
