import {
  addInto, blank, type Sums,
  type MyAsinResponse, type MyCampaignsResponse, type MyCatAdvResponse, type MyDailyResponse,
  type MyDurResponse, type MyGeoResponse, type MyGroupsResponse, type MyMetaResponse,
  type MyPlacementsResponse, type MySearchTermsResponse, type MyTargetingResponse,
  type MyTargetType, type MyTopTermsResponse,
} from '@dash/shared/myntra';

import { q } from '../blinkit/reports/queries';
import { canonCat, getMyDims } from './reports/dims';

export interface RangeArgs { profileId: string; from: string; to: string; category?: string | undefined }

type Raw = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const AD_SUMS = `sum(impressions) impr, sum(clicks) clicks, sum(spend) spend, sum(ad_sales) asales, sum(ad_units) aunits`;
function adsRow(r: Raw): Sums { const a = blank(); a.impr = n(r.impr); a.clicks = n(r.clicks); a.spend = n(r.spend); a.asales = n(r.asales); a.aunits = n(r.aunits); return a; }
function salesRow(r: Raw): Sums { const a = blank(); a.rev = n(r.rev); a.units = n(r.units); return a; }
const getOrBlank = (m: Map<string, Sums>, k: string) => { let s = m.get(k); if (!s) m.set(k, (s = blank())); return s; };
const dayCount = (f: string, t: string) => Math.max(1, Math.round((Date.parse(t) - Date.parse(f)) / 86_400_000) + 1);
const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

function salesWhere(a: RangeArgs, p: unknown[]): string { p.push(a.profileId, a.from, a.to); let w = `s.profile_id=$1 and s.date between $2 and $3`; if (a.category) { p.push(canonCat(a.category)); w += ` and upper(coalesce(m.category,'UNMAPPED')) = $${p.length}`; } return w; }
function adWhere(a: RangeArgs, p: unknown[], hasCat: boolean): string { p.push(a.profileId, a.from, a.to); let w = `ap.profile_id=$1 and ap.period_from >= $2 and ap.period_to <= $3`; if (hasCat && a.category) { p.push(canonCat(a.category)); w += ` and upper(coalesce(m.category,'UNMAPPED')) = $${p.length}`; } return w; }

export async function meta(profileId: string): Promise<MyMetaResponse> {
  const d = await getMyDims(profileId);
  const [[salesAgg], periods, unmappedStyle, unmappedCamp] = await Promise.all([
    q<{ f: string; t: string; c: string }>(`select min(date) f, max(date) t, count(*) c from my_daily_style_sales where profile_id=$1`, [profileId]),
    q<{ f: string; t: string; c: string }>(`select period_from f, period_to t, count(*) c from (select period_from,period_to from my_ad_campaign where profile_id=$1 union all select period_from,period_to from my_ad_product where profile_id=$1 union all select period_from,period_to from my_ad_placement where profile_id=$1 union all select period_from,period_to from my_ad_search_term where profile_id=$1 union all select period_from,period_to from my_ad_targeting where profile_id=$1) x group by 1,2 order by 1`, [profileId]),
    q<{ style: string; name: string; rev: string }>(`select style_id style, max(title) name, sum(revenue) rev from my_daily_style_sales s where profile_id=$1 and not exists (select 1 from my_style_map m where m.profile_id=s.profile_id and m.style_id=s.style_id) group by 1 order by 3 desc limit 50`, [profileId]),
    q<{ name: string; spend: string }>(`select campaign_name name, sum(spend) spend from my_ad_campaign c where profile_id=$1 and not exists (select 1 from my_campaign_map m where m.profile_id=c.profile_id and m.campaign_name=c.campaign_name) group by 1 order by 2 desc`, [profileId]),
  ]);
  const notes: string[] = [];
  if (periods.length) notes.push('Ad reports have no per-row date; stored against the export window and shown when it falls inside the range.');
  return {
    profileId,
    sales: { from: salesAgg?.f ?? null, to: salesAgg?.t ?? null, rows: n(salesAgg?.c) },
    ads: { periods: periods.map((p) => ({ from: p.f, to: p.t, rows: n(p.c) })) },
    categories: d.categories, states: d.states,
    campaigns: [...d.campaigns.values()].map((c) => ({ name: c.name, category: c.category })),
    unmappedStyles: unmappedStyle.map((r) => ({ style: r.style, name: r.name, rev: n(r.rev) })),
    unmappedCampaigns: unmappedCamp.map((r) => ({ name: r.name, spend: n(r.spend) })),
    notes,
  };
}

export async function groups(a: RangeArgs, groupBy: 'category' | 'style'): Promise<MyGroupsResponse> {
  const d = await getMyDims(a.profileId); const byCat = groupBy === 'category';
  const sp: unknown[] = [];
  const salesSql = byCat
    ? `select upper(coalesce(m.category,'UNMAPPED')) k, sum(s.revenue) rev, sum(s.units) units from my_daily_style_sales s left join my_style_map m on m.profile_id=s.profile_id and m.style_id=s.style_id where ${salesWhere(a, sp)} group by 1`
    : `select s.style_id k, sum(s.revenue) rev, sum(s.units) units from my_daily_style_sales s left join my_style_map m on m.profile_id=s.profile_id and m.style_id=s.style_id where ${salesWhere(a, sp)} group by 1`;
  const ap: unknown[] = [];
  const adSql = byCat
    ? `select upper(coalesce(m.category,'UNMAPPED')) k, ${AD_SUMS} from my_ad_product ap left join my_style_map m on m.profile_id=ap.profile_id and m.style_id=ap.style_id where ${adWhere(a, ap, true)} group by 1`
    : `select ap.style_id k, ${AD_SUMS} from my_ad_product ap left join my_style_map m on m.profile_id=ap.profile_id and m.style_id=ap.style_id where ${adWhere(a, ap, true)} group by 1`;
  const [salesRows, adRows] = await Promise.all([q<Raw>(salesSql, sp), q<Raw>(adSql, ap)]);
  const map = new Map<string, Sums>();
  for (const r of salesRows) addInto(getOrBlank(map, String(r.k)), salesRow(r));
  for (const r of adRows) addInto(getOrBlank(map, String(r.k)), adsRow(r));
  const total = blank();
  const groupsOut = [...map.entries()].map(([k, sums]) => { addInto(total, sums); return { key: byCat ? k : d.styles.get(k)?.name || k, sums }; });
  groupsOut.sort((x, y) => y.sums.rev - x.sums.rev || y.sums.asales - x.sums.asales);
  return { from: a.from, to: a.to, days: dayCount(a.from, a.to), total, groups: groupsOut };
}

export async function daily(a: RangeArgs): Promise<MyDailyResponse> {
  const sp: unknown[] = [];
  const rows = await q<{ d: string; rev: string; units: string }>(`select s.date d, sum(s.revenue) rev, sum(s.units) units from my_daily_style_sales s left join my_style_map m on m.profile_id=s.profile_id and m.style_id=s.style_id where ${salesWhere(a, sp)} group by 1 order by 1`, sp);
  const ap: unknown[] = [];
  const [adAgg] = await q<Raw>(`select ${AD_SUMS} from my_ad_product ap left join my_style_map m on m.profile_id=ap.profile_id and m.style_id=ap.style_id where ${adWhere(a, ap, true)}`, ap);
  const total = blank();
  const out = rows.map((r) => { const s = salesRow({ rev: r.rev, units: r.units }); addInto(total, s); return { date: r.d, sums: s }; });
  addInto(total, adsRow(adAgg ?? {}));
  return { from: a.from, to: a.to, dates: rows.map((r) => r.d), rows: out, total, notes: [] };
}

export async function dur(a: RangeArgs, metric: 'units' | 'rev'): Promise<MyDurResponse> {
  const d = await getMyDims(a.profileId); const sp: unknown[] = [];
  const col = metric === 'rev' ? 's.revenue' : 's.units';
  const rows = await q<{ style: string; d: string; v: string }>(`select s.style_id style, s.date d, sum(${col}) v from my_daily_style_sales s left join my_style_map m on m.profile_id=s.profile_id and m.style_id=s.style_id where ${salesWhere(a, sp)} group by 1,2`, sp);
  const dates = [...new Set(rows.map((r) => r.d))].sort(); const di = new Map(dates.map((x, i) => [x, i]));
  const byStyle = new Map<string, number[]>();
  for (const r of rows) { let arr = byStyle.get(r.style); if (!arr) byStyle.set(r.style, (arr = new Array(dates.length).fill(0))); arr[di.get(r.d)!] = n(r.v); }
  const out = [...byStyle.entries()].map(([style, values]) => { const dim = d.styles.get(style); return { style, name: dim?.name || style, category: dim?.category || 'UNMAPPED', values, total: values.reduce((t, x) => t + x, 0) }; });
  out.sort((x, y) => y.total - x.total);
  return { dates, metric, rows: out };
}

export async function asinLevel(a: RangeArgs & { limit?: number }): Promise<MyAsinResponse> {
  const d = await getMyDims(a.profileId); const ap: unknown[] = [];
  const adRows = await q<Raw>(`select ap.style_id k, ${AD_SUMS} from my_ad_product ap left join my_style_map m on m.profile_id=ap.profile_id and m.style_id=ap.style_id where ${adWhere(a, ap, true)} group by 1`, ap);
  const sp: unknown[] = [];
  const salesRows = await q<{ k: string; rev: string; units: string }>(`select s.style_id k, sum(s.revenue) rev, sum(s.units) units from my_daily_style_sales s left join my_style_map m on m.profile_id=s.profile_id and m.style_id=s.style_id where ${salesWhere(a, sp)} group by 1`, sp);
  const map = new Map<string, Sums>();
  for (const r of adRows) addInto(getOrBlank(map, String(r.k)), adsRow(r));
  for (const r of salesRows) { const s = getOrBlank(map, r.k); s.rev += n(r.rev); s.units += n(r.units); }
  const total = blank();
  let rows = [...map.entries()].map(([style, sums]) => { addInto(total, sums); const dim = d.styles.get(style); return { style, name: dim?.name || style, category: dim?.category || 'UNMAPPED', sums }; });
  rows.sort((x, y) => y.sums.asales - x.sums.asales || y.sums.rev - x.sums.rev);
  const limit = a.limit ?? 2000; const truncated = rows.length > limit; if (truncated) rows = rows.slice(0, limit);
  return { rows, total, truncated };
}

async function adGroup(a: RangeArgs, table: string, keyCol: string, extraCols = ''): Promise<{ rows: { key: string; extra: string; campaigns: Set<string>; sums: Sums }[]; total: Sums }> {
  const ap: unknown[] = [];
  const rows = await q<Raw>(`select ${keyCol} k, ${extraCols ? extraCols + ',' : ''} campaign_name cname, ${AD_SUMS} from ${table} ap where ${adWhere(a, ap, false)} group by 1${extraCols ? ',2,3' : ',2'}`, ap);
  const map = new Map<string, { key: string; extra: string; campaigns: Set<string>; sums: Sums }>(); const total = blank();
  for (const r of rows) { const key = String(r.k ?? ''); const extra = extraCols ? String(r.x ?? '') : ''; const mk = `${key}${extra}`; let e = map.get(mk); if (!e) map.set(mk, (e = { key, extra, campaigns: new Set(), sums: blank() })); if (r.cname) e.campaigns.add(String(r.cname)); addInto(e.sums, adsRow(r)); addInto(total, adsRow(r)); }
  return { rows: [...map.values()], total };
}
const catOf = (d: Awaited<ReturnType<typeof getMyDims>>, cs: string[]) => cs.map((c) => d.campaigns.get(normName(c))?.category).find((c) => c && c !== 'UNMAPPED') ?? 'UNMAPPED';

export async function targeting(a: RangeArgs & { limit?: number }): Promise<MyTargetingResponse> {
  const d = await getMyDims(a.profileId);
  const { rows, total } = await adGroup(a, 'my_ad_targeting', 'target', 'max(target_type) x');
  let out = rows.map((e) => { const cs = [...e.campaigns]; return { target: e.key, targetType: (e.extra || 'keyword') as MyTargetType, campaign: cs[0] ?? null, category: catOf(d, cs), sums: e.sums }; });
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  const limit = a.limit ?? 1000; const truncated = out.length > limit; if (truncated) out = out.slice(0, limit);
  return { rows: out, total, truncated };
}

export async function searchTerms(a: RangeArgs & { limit?: number }): Promise<MySearchTermsResponse> {
  const d = await getMyDims(a.profileId);
  const { rows, total } = await adGroup(a, 'my_ad_search_term', 'search_term');
  let out = rows.map((e) => { const cs = [...e.campaigns]; return { searchTerm: e.key, campaign: cs[0] ?? null, category: catOf(d, cs), sums: e.sums }; });
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  const limit = a.limit ?? 1000; const truncated = out.length > limit; if (truncated) out = out.slice(0, limit);
  return { rows: out, total, truncated };
}

export async function placements(a: RangeArgs): Promise<MyPlacementsResponse> {
  const { rows, total } = await adGroup(a, 'my_ad_placement', 'placement');
  const out = rows.map((e) => ({ placement: e.key, sums: e.sums })); out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}

export async function categoryAdvertised(a: RangeArgs): Promise<MyCatAdvResponse> {
  const ap: unknown[] = [];
  const rows = await q<Raw>(`select upper(coalesce(m.category,'UNMAPPED')) k, ${AD_SUMS} from my_ad_product ap left join my_style_map m on m.profile_id=ap.profile_id and m.style_id=ap.style_id where ${adWhere(a, ap, true)} group by 1`, ap);
  const total = blank();
  const out = rows.map((r) => { const s = adsRow(r); addInto(total, s); return { category: String(r.k), sums: s }; });
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}

export async function campaigns(a: RangeArgs): Promise<MyCampaignsResponse> {
  const d = await getMyDims(a.profileId);
  const { rows, total } = await adGroup(a, 'my_ad_campaign', 'campaign_name');
  const out = rows.map((e) => ({ name: e.key, category: d.campaigns.get(normName(e.key))?.category ?? 'UNMAPPED', sums: e.sums }));
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}

export async function geo(a: RangeArgs): Promise<MyGeoResponse> {
  const sp: unknown[] = [];
  const rows = await q<{ state: string; rev: string; units: string }>(`select s.state state, sum(s.revenue) rev, sum(s.units) units from my_daily_style_sales s left join my_style_map m on m.profile_id=s.profile_id and m.style_id=s.style_id where ${salesWhere(a, sp)} and s.state <> '' group by 1`, sp);
  const out = rows.map((r) => ({ state: r.state, sums: salesRow(r) })); out.sort((x, y) => y.sums.rev - x.sums.rev);
  return { states: out };
}

export async function topSearchTerms(a: RangeArgs & { limit?: number }): Promise<MyTopTermsResponse> {
  const p: unknown[] = [a.profileId, a.from, a.to];
  const rows = await q<{ term: string; volume: string; impr: string; clk: string; rank: string | null }>(`select term, sum(volume) volume, sum(your_impressions) impr, sum(your_clicks) clk, avg(rank) rank from my_top_search_terms where profile_id=$1 and period_from >= $2 and period_to <= $3 group by 1 order by 2 desc limit ${a.limit ?? 500}`, p);
  return { rows: rows.map((r) => ({ term: r.term, volume: n(r.volume), yourImpr: n(r.impr), yourClicks: n(r.clk), rank: r.rank == null ? null : n(r.rank) })) };
}
