import {
  addInto, blank, type Sums,
  type NkAsinResponse, type NkCampaignsResponse, type NkCatAdvResponse, type NkDailyResponse,
  type NkDurResponse, type NkGroupsResponse, type NkMetaResponse, type NkPlacementsResponse,
  type NkSearchTermsResponse, type NkSovResponse,
} from '@dash/shared/nykaa';
import { q } from '../blinkit/reports/queries';
import { canonCat, getNkDims } from './reports/dims';

export interface RangeArgs { profileId: string; from: string; to: string; category?: string | undefined }
type Raw = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const AD_SUMS = `sum(impressions) impr, sum(clicks) clicks, sum(spend) spend, sum(ad_sales) asales, sum(ad_units) aunits`;
function adsRow(r: Raw): Sums { const a = blank(); a.impr = n(r.impr); a.clicks = n(r.clicks); a.spend = n(r.spend); a.asales = n(r.asales); a.aunits = n(r.aunits); return a; }
function salesRow(r: Raw): Sums { const a = blank(); a.rev = n(r.rev); a.units = n(r.units); return a; }
const getOrBlank = (m: Map<string, Sums>, k: string) => { let s = m.get(k); if (!s) m.set(k, (s = blank())); return s; };
const dayCount = (f: string, t: string) => Math.max(1, Math.round((Date.parse(t) - Date.parse(f)) / 86_400_000) + 1);
const normName = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/** Deduped sales source: per (date, sku) keep ONE source — seller over mis (TODO confirm). */
function salesFrom(a: RangeArgs, p: unknown[], catFilter = true): { frag: string; where: string } {
  p.push(a.profileId, a.from, a.to);
  const frag = `from (select date, sku, title, revenue, units from (
      select *, row_number() over (partition by date, sku order by case source when 'seller' then 0 else 1 end) rn
      from nk_daily_sku_sales where profile_id=$1 and date between $2 and $3) z where rn=1) s
    left join nk_sku_map m on m.profile_id=$1 and m.sku=s.sku`;
  let where = 'true';
  if (catFilter && a.category) { p.push(canonCat(a.category)); where = `upper(coalesce(m.category,'UNMAPPED')) = $${p.length}`; }
  return { frag, where };
}
function adWhere(a: RangeArgs, p: unknown[], hasCat: boolean): string { p.push(a.profileId, a.from, a.to); let w = `ap.profile_id=$1 and ap.period_from >= $2 and ap.period_to <= $3`; if (hasCat && a.category) { p.push(canonCat(a.category)); w += ` and upper(coalesce(m.category,'UNMAPPED')) = $${p.length}`; } return w; }

export async function meta(profileId: string): Promise<NkMetaResponse> {
  const d = await getNkDims(profileId);
  const [[salesAgg], [srcAgg], periods, unmappedSku, unmappedCamp] = await Promise.all([
    q<{ f: string; t: string; c: string }>(`select min(date) f, max(date) t, count(distinct (date, sku)) c from nk_daily_sku_sales where profile_id=$1`, [profileId]),
    q<{ mis: string; seller: string }>(`select count(*) filter (where source='mis') mis, count(*) filter (where source='seller') seller from nk_daily_sku_sales where profile_id=$1`, [profileId]),
    q<{ f: string; t: string; c: string }>(`select period_from f, period_to t, count(*) c from (select period_from,period_to from nk_ad_campaign where profile_id=$1 union all select period_from,period_to from nk_ad_sku where profile_id=$1 union all select period_from,period_to from nk_ad_placement where profile_id=$1 union all select period_from,period_to from nk_ad_search_term where profile_id=$1) x group by 1,2 order by 1`, [profileId]),
    q<{ sku: string; name: string; rev: string }>(`select sku, max(title) name, sum(revenue) rev from nk_daily_sku_sales s where profile_id=$1 and not exists (select 1 from nk_sku_map m where m.profile_id=s.profile_id and m.sku=s.sku) group by 1 order by 3 desc limit 50`, [profileId]),
    q<{ name: string; spend: string }>(`select campaign_name name, sum(spend) spend from nk_ad_campaign c where profile_id=$1 and not exists (select 1 from nk_campaign_map m where m.profile_id=c.profile_id and m.campaign_name=c.campaign_name) group by 1 order by 2 desc`, [profileId]),
  ]);
  const notes: string[] = [];
  if (n(srcAgg?.mis) && n(srcAgg?.seller)) notes.push('MIS and Sales Report both present — deduped per SKU per day with Seller Portal taking precedence (confirm).');
  if (periods.length) notes.push('Ad reports have no per-row date; shown when their export window falls inside the range.');
  return {
    profileId,
    sales: { from: salesAgg?.f ?? null, to: salesAgg?.t ?? null, rows: n(salesAgg?.c) },
    sources: { mis: n(srcAgg?.mis), seller: n(srcAgg?.seller) },
    ads: { periods: periods.map((p) => ({ from: p.f, to: p.t, rows: n(p.c) })) },
    categories: d.categories,
    campaigns: [...d.campaigns.values()].map((c) => ({ name: c.name, category: c.category })),
    unmappedSkus: unmappedSku.map((r) => ({ sku: r.sku, name: r.name, rev: n(r.rev) })),
    unmappedCampaigns: unmappedCamp.map((r) => ({ name: r.name, spend: n(r.spend) })),
    notes,
  };
}

export async function groups(a: RangeArgs, groupBy: 'category' | 'sku'): Promise<NkGroupsResponse> {
  const d = await getNkDims(a.profileId); const byCat = groupBy === 'category';
  const sp: unknown[] = []; const sf = salesFrom(a, sp);
  const salesSql = `select ${byCat ? `upper(coalesce(m.category,'UNMAPPED'))` : 's.sku'} k, sum(s.revenue) rev, sum(s.units) units ${sf.frag} where ${sf.where} group by 1`;
  const ap: unknown[] = [];
  const adSql = `select ${byCat ? `upper(coalesce(m.category,'UNMAPPED'))` : 'ap.sku'} k, ${AD_SUMS} from nk_ad_sku ap left join nk_sku_map m on m.profile_id=ap.profile_id and m.sku=ap.sku where ${adWhere(a, ap, true)} group by 1`;
  const [salesRows, adRows] = await Promise.all([q<Raw>(salesSql, sp), q<Raw>(adSql, ap)]);
  const map = new Map<string, Sums>();
  for (const r of salesRows) addInto(getOrBlank(map, String(r.k)), salesRow(r));
  for (const r of adRows) addInto(getOrBlank(map, String(r.k)), adsRow(r));
  const total = blank();
  const groupsOut = [...map.entries()].map(([k, sums]) => { addInto(total, sums); return { key: byCat ? k : d.skus.get(k)?.name || k, sums }; });
  groupsOut.sort((x, y) => y.sums.rev - x.sums.rev || y.sums.asales - x.sums.asales);
  return { from: a.from, to: a.to, days: dayCount(a.from, a.to), total, groups: groupsOut };
}

export async function daily(a: RangeArgs): Promise<NkDailyResponse> {
  const sp: unknown[] = []; const sf = salesFrom(a, sp);
  const rows = await q<{ d: string; rev: string; units: string }>(`select s.date d, sum(s.revenue) rev, sum(s.units) units ${sf.frag} where ${sf.where} group by 1 order by 1`, sp);
  const ap: unknown[] = [];
  const [adAgg] = await q<Raw>(`select ${AD_SUMS} from nk_ad_sku ap left join nk_sku_map m on m.profile_id=ap.profile_id and m.sku=ap.sku where ${adWhere(a, ap, true)}`, ap);
  const total = blank();
  const out = rows.map((r) => { const s = salesRow(r); addInto(total, s); return { date: r.d, sums: s }; });
  addInto(total, adsRow(adAgg ?? {}));
  return { from: a.from, to: a.to, dates: rows.map((r) => r.d), rows: out, total, notes: [] };
}

export async function dur(a: RangeArgs, metric: 'units' | 'rev'): Promise<NkDurResponse> {
  const d = await getNkDims(a.profileId); const sp: unknown[] = []; const sf = salesFrom(a, sp);
  const col = metric === 'rev' ? 's.revenue' : 's.units';
  const rows = await q<{ sku: string; d: string; v: string }>(`select s.sku sku, s.date d, sum(${col}) v ${sf.frag} where ${sf.where} group by 1,2`, sp);
  const dates = [...new Set(rows.map((r) => r.d))].sort(); const di = new Map(dates.map((x, i) => [x, i]));
  const bySku = new Map<string, number[]>();
  for (const r of rows) { let arr = bySku.get(r.sku); if (!arr) bySku.set(r.sku, (arr = new Array(dates.length).fill(0))); arr[di.get(r.d)!] = n(r.v); }
  const out = [...bySku.entries()].map(([sku, values]) => { const dim = d.skus.get(sku); return { sku, name: dim?.name || sku, category: dim?.category || 'UNMAPPED', values, total: values.reduce((t, x) => t + x, 0) }; });
  out.sort((x, y) => y.total - x.total);
  return { dates, metric, rows: out };
}

export async function asinLevel(a: RangeArgs & { limit?: number }): Promise<NkAsinResponse> {
  const d = await getNkDims(a.profileId); const ap: unknown[] = [];
  const adRows = await q<Raw>(`select ap.sku k, ${AD_SUMS} from nk_ad_sku ap left join nk_sku_map m on m.profile_id=ap.profile_id and m.sku=ap.sku where ${adWhere(a, ap, true)} group by 1`, ap);
  const sp: unknown[] = []; const sf = salesFrom(a, sp);
  const salesRows = await q<{ k: string; rev: string; units: string }>(`select s.sku k, sum(s.revenue) rev, sum(s.units) units ${sf.frag} where ${sf.where} group by 1`, sp);
  const map = new Map<string, Sums>();
  for (const r of adRows) addInto(getOrBlank(map, String(r.k)), adsRow(r));
  for (const r of salesRows) { const s = getOrBlank(map, r.k); s.rev += n(r.rev); s.units += n(r.units); }
  const total = blank();
  let rows = [...map.entries()].map(([sku, sums]) => { addInto(total, sums); const dim = d.skus.get(sku); return { sku, name: dim?.name || sku, category: dim?.category || 'UNMAPPED', sums }; });
  rows.sort((x, y) => y.sums.asales - x.sums.asales || y.sums.rev - x.sums.rev);
  const limit = a.limit ?? 2000; const truncated = rows.length > limit; if (truncated) rows = rows.slice(0, limit);
  return { rows, total, truncated };
}

async function adGroup(a: RangeArgs, table: string, keyCol: string) {
  const ap: unknown[] = [];
  const rows = await q<Raw>(`select ${keyCol} k, campaign_name cname, ${AD_SUMS} from ${table} ap where ${adWhere(a, ap, false)} group by 1,2`, ap);
  const map = new Map<string, { key: string; campaigns: Set<string>; sums: Sums }>(); const total = blank();
  for (const r of rows) { const key = String(r.k ?? ''); let e = map.get(key); if (!e) map.set(key, (e = { key, campaigns: new Set(), sums: blank() })); if (r.cname) e.campaigns.add(String(r.cname)); addInto(e.sums, adsRow(r)); addInto(total, adsRow(r)); }
  return { rows: [...map.values()], total };
}
const catOf = (d: Awaited<ReturnType<typeof getNkDims>>, cs: string[]) => cs.map((c) => d.campaigns.get(normName(c))?.category).find((c) => c && c !== 'UNMAPPED') ?? 'UNMAPPED';

export async function searchTerms(a: RangeArgs & { limit?: number }): Promise<NkSearchTermsResponse> {
  const d = await getNkDims(a.profileId); const { rows, total } = await adGroup(a, 'nk_ad_search_term', 'search_term');
  let out = rows.map((e) => { const cs = [...e.campaigns]; return { searchTerm: e.key, campaign: cs[0] ?? null, category: catOf(d, cs), sums: e.sums }; });
  out.sort((x, y) => y.sums.spend - x.sums.spend); const limit = a.limit ?? 1000; const truncated = out.length > limit; if (truncated) out = out.slice(0, limit);
  return { rows: out, total, truncated };
}
export async function placements(a: RangeArgs): Promise<NkPlacementsResponse> {
  const { rows, total } = await adGroup(a, 'nk_ad_placement', 'placement');
  const out = rows.map((e) => ({ placement: e.key, sums: e.sums })); out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}
export async function categoryAdvertised(a: RangeArgs): Promise<NkCatAdvResponse> {
  const ap: unknown[] = [];
  const rows = await q<Raw>(`select upper(coalesce(m.category,'UNMAPPED')) k, ${AD_SUMS} from nk_ad_sku ap left join nk_sku_map m on m.profile_id=ap.profile_id and m.sku=ap.sku where ${adWhere(a, ap, true)} group by 1`, ap);
  const total = blank(); const out = rows.map((r) => { const s = adsRow(r); addInto(total, s); return { category: String(r.k), sums: s }; }); out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}
export async function campaignsReport(a: RangeArgs): Promise<NkCampaignsResponse> {
  const d = await getNkDims(a.profileId); const { rows, total } = await adGroup(a, 'nk_ad_campaign', 'campaign_name');
  const out = rows.map((e) => ({ name: e.key, category: d.campaigns.get(normName(e.key))?.category ?? 'UNMAPPED', sums: e.sums })); out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}
export async function skuSov(a: RangeArgs & { limit?: number }): Promise<NkSovResponse> {
  const d = await getNkDims(a.profileId); const p: unknown[] = [a.profileId, a.from, a.to];
  const rows = await q<{ sku: string; sov: string; rank: string | null }>(`select sku, avg(sov) sov, avg(rank) rank from nk_sku_sov where profile_id=$1 and period_from >= $2 and period_to <= $3 group by 1 order by 2 desc limit ${a.limit ?? 1000}`, p);
  return { rows: rows.map((r) => { const dim = d.skus.get(r.sku); return { sku: r.sku, name: dim?.name || r.sku, category: dim?.category || 'UNMAPPED', sov: n(r.sov), rank: r.rank == null ? null : n(r.rank) }; }) };
}
