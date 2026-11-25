import {
  addInto, blank, type Sums,
  type FcAsinResponse, type FcCatAdvResponse, type FcDailyResponse, type FcDurResponse,
  type FcGroupsResponse, type FcKeywordsResponse, type FcMetaResponse,
} from '@dash/shared/firstcry';
import { q } from '../blinkit/reports/queries';
import { canonCat, getFcDims } from './reports/dims';

export interface RangeArgs { profileId: string; from: string; to: string; category?: string | undefined }
type Raw = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
const AD_SUMS = `sum(impressions) impr, sum(clicks) clicks, sum(spend) spend, sum(ad_sales) asales, sum(ad_units) aunits`;
function adsRow(r: Raw): Sums { const a = blank(); a.impr = n(r.impr); a.clicks = n(r.clicks); a.spend = n(r.spend); a.asales = n(r.asales); a.aunits = n(r.aunits); return a; }
function salesRow(r: Raw): Sums { const a = blank(); a.rev = n(r.rev); a.units = n(r.units); return a; }
const getOrBlank = (m: Map<string, Sums>, k: string) => { let s = m.get(k); if (!s) m.set(k, (s = blank())); return s; };
const dayCount = (f: string, t: string) => Math.max(1, Math.round((Date.parse(t) - Date.parse(f)) / 86_400_000) + 1);

function salesWhere(a: RangeArgs, p: unknown[]): string { p.push(a.profileId, a.from, a.to); let w = `s.profile_id=$1 and s.date between $2 and $3`; if (a.category) { p.push(canonCat(a.category)); w += ` and upper(coalesce(m.category,'UNMAPPED')) = $${p.length}`; } return w; }
function adWhere(a: RangeArgs, p: unknown[], hasCat: boolean): string { p.push(a.profileId, a.from, a.to); let w = `ap.profile_id=$1 and ap.period_from >= $2 and ap.period_to <= $3`; if (hasCat && a.category) { p.push(canonCat(a.category)); w += ` and upper(coalesce(m.category,'UNMAPPED')) = $${p.length}`; } return w; }

export async function meta(profileId: string): Promise<FcMetaResponse> {
  const d = await getFcDims(profileId);
  const [[salesAgg], periods, unmappedSku] = await Promise.all([
    q<{ f: string; t: string; c: string }>(`select min(date) f, max(date) t, count(*) c from fc_daily_sku_sales where profile_id=$1`, [profileId]),
    q<{ f: string; t: string; c: string }>(`select period_from f, period_to t, count(*) c from (select period_from,period_to from fc_ad_product where profile_id=$1 union all select period_from,period_to from fc_ad_category where profile_id=$1 union all select period_from,period_to from fc_ad_keyword where profile_id=$1) x group by 1,2 order by 1`, [profileId]),
    q<{ sku: string; name: string; rev: string }>(`select sku, max(title) name, sum(revenue) rev from fc_daily_sku_sales s where profile_id=$1 and not exists (select 1 from fc_sku_map m where m.profile_id=s.profile_id and m.sku=s.sku) group by 1 order by 3 desc limit 50`, [profileId]),
  ]);
  const notes: string[] = [];
  if (periods.length) notes.push('Performance reports have no per-row date; shown when their export window falls inside the range.');
  return { profileId, sales: { from: salesAgg?.f ?? null, to: salesAgg?.t ?? null, rows: n(salesAgg?.c) }, ads: { periods: periods.map((p) => ({ from: p.f, to: p.t, rows: n(p.c) })) }, categories: d.categories, unmappedSkus: unmappedSku.map((r) => ({ sku: r.sku, name: r.name, rev: n(r.rev) })), notes };
}

export async function groups(a: RangeArgs, groupBy: 'category' | 'sku'): Promise<FcGroupsResponse> {
  const d = await getFcDims(a.profileId); const byCat = groupBy === 'category';
  const sp: unknown[] = [];
  const salesSql = `select ${byCat ? `upper(coalesce(m.category,'UNMAPPED'))` : 's.sku'} k, sum(s.revenue) rev, sum(s.units) units from fc_daily_sku_sales s left join fc_sku_map m on m.profile_id=s.profile_id and m.sku=s.sku where ${salesWhere(a, sp)} group by 1`;
  const ap: unknown[] = [];
  const adSql = `select ${byCat ? `upper(coalesce(m.category,'UNMAPPED'))` : 'ap.sku'} k, ${AD_SUMS} from fc_ad_product ap left join fc_sku_map m on m.profile_id=ap.profile_id and m.sku=ap.sku where ${adWhere(a, ap, true)} group by 1`;
  const [salesRows, adRows] = await Promise.all([q<Raw>(salesSql, sp), q<Raw>(adSql, ap)]);
  const map = new Map<string, Sums>();
  for (const r of salesRows) addInto(getOrBlank(map, String(r.k)), salesRow(r));
  for (const r of adRows) addInto(getOrBlank(map, String(r.k)), adsRow(r));
  const total = blank();
  const groupsOut = [...map.entries()].map(([k, sums]) => { addInto(total, sums); return { key: byCat ? k : d.skus.get(k)?.name || k, sums }; });
  groupsOut.sort((x, y) => y.sums.rev - x.sums.rev || y.sums.asales - x.sums.asales);
  return { from: a.from, to: a.to, days: dayCount(a.from, a.to), total, groups: groupsOut };
}

export async function daily(a: RangeArgs): Promise<FcDailyResponse> {
  const sp: unknown[] = [];
  const rows = await q<{ d: string; rev: string; units: string }>(`select s.date d, sum(s.revenue) rev, sum(s.units) units from fc_daily_sku_sales s left join fc_sku_map m on m.profile_id=s.profile_id and m.sku=s.sku where ${salesWhere(a, sp)} group by 1 order by 1`, sp);
  const ap: unknown[] = [];
  const [adAgg] = await q<Raw>(`select ${AD_SUMS} from fc_ad_product ap left join fc_sku_map m on m.profile_id=ap.profile_id and m.sku=ap.sku where ${adWhere(a, ap, true)}`, ap);
  const total = blank();
  const out = rows.map((r) => { const s = salesRow(r); addInto(total, s); return { date: r.d, sums: s }; });
  addInto(total, adsRow(adAgg ?? {}));
  return { from: a.from, to: a.to, dates: rows.map((r) => r.d), rows: out, total, notes: [] };
}

export async function dur(a: RangeArgs, metric: 'units' | 'rev'): Promise<FcDurResponse> {
  const d = await getFcDims(a.profileId); const sp: unknown[] = []; const col = metric === 'rev' ? 's.revenue' : 's.units';
  const rows = await q<{ sku: string; d: string; v: string }>(`select s.sku sku, s.date d, sum(${col}) v from fc_daily_sku_sales s left join fc_sku_map m on m.profile_id=s.profile_id and m.sku=s.sku where ${salesWhere(a, sp)} group by 1,2`, sp);
  const dates = [...new Set(rows.map((r) => r.d))].sort(); const di = new Map(dates.map((x, i) => [x, i]));
  const bySku = new Map<string, number[]>();
  for (const r of rows) { let arr = bySku.get(r.sku); if (!arr) bySku.set(r.sku, (arr = new Array(dates.length).fill(0))); arr[di.get(r.d)!] = n(r.v); }
  const out = [...bySku.entries()].map(([sku, values]) => { const dim = d.skus.get(sku); return { sku, name: dim?.name || sku, category: dim?.category || 'UNMAPPED', values, total: values.reduce((t, x) => t + x, 0) }; });
  out.sort((x, y) => y.total - x.total);
  return { dates, metric, rows: out };
}

export async function asinLevel(a: RangeArgs & { limit?: number }): Promise<FcAsinResponse> {
  const d = await getFcDims(a.profileId); const ap: unknown[] = [];
  const adRows = await q<Raw>(`select ap.sku k, ${AD_SUMS} from fc_ad_product ap left join fc_sku_map m on m.profile_id=ap.profile_id and m.sku=ap.sku where ${adWhere(a, ap, true)} group by 1`, ap);
  const sp: unknown[] = [];
  const salesRows = await q<{ k: string; rev: string; units: string }>(`select s.sku k, sum(s.revenue) rev, sum(s.units) units from fc_daily_sku_sales s left join fc_sku_map m on m.profile_id=s.profile_id and m.sku=s.sku where ${salesWhere(a, sp)} group by 1`, sp);
  const map = new Map<string, Sums>();
  for (const r of adRows) addInto(getOrBlank(map, String(r.k)), adsRow(r));
  for (const r of salesRows) { const s = getOrBlank(map, r.k); s.rev += n(r.rev); s.units += n(r.units); }
  const total = blank();
  let rows = [...map.entries()].map(([sku, sums]) => { addInto(total, sums); const dim = d.skus.get(sku); return { sku, name: dim?.name || sku, category: dim?.category || 'UNMAPPED', sums }; });
  rows.sort((x, y) => y.sums.asales - x.sums.asales || y.sums.rev - x.sums.rev);
  const limit = a.limit ?? 2000; const truncated = rows.length > limit; if (truncated) rows = rows.slice(0, limit);
  return { rows, total, truncated };
}

/** Category-advertised reads fc_ad_category DIRECTLY (pre-rolled, no mapper). */
export async function categoryAdvertised(a: RangeArgs): Promise<FcCatAdvResponse> {
  const p: unknown[] = [a.profileId, a.from, a.to];
  let w = `ap.profile_id=$1 and ap.period_from >= $2 and ap.period_to <= $3`;
  if (a.category) { p.push(canonCat(a.category)); w += ` and upper(ap.category) = $${p.length}`; }
  const rows = await q<Raw>(`select upper(category) k, ${AD_SUMS} from fc_ad_category ap where ${w} group by 1`, p);
  const total = blank();
  const out = rows.map((r) => { const s = adsRow(r); addInto(total, s); return { category: String(r.k), sums: s }; });
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}

export async function keywords(a: RangeArgs & { limit?: number }): Promise<FcKeywordsResponse> {
  const ap: unknown[] = [];
  const rows = await q<Raw>(`select keyword k, campaign_name cname, ${AD_SUMS} from fc_ad_keyword ap where ${adWhere(a, ap, false)} group by 1,2`, ap);
  const map = new Map<string, { key: string; campaigns: Set<string>; sums: Sums }>(); const total = blank();
  for (const r of rows) { const key = String(r.k ?? ''); let e = map.get(key); if (!e) map.set(key, (e = { key, campaigns: new Set(), sums: blank() })); if (r.cname) e.campaigns.add(String(r.cname)); addInto(e.sums, adsRow(r)); addInto(total, adsRow(r)); }
  let out = [...map.values()].map((e) => { const cs = [...e.campaigns]; return { keyword: e.key, campaign: cs[0] ?? null, category: 'ALL', sums: e.sums }; });
  out.sort((x, y) => y.sums.spend - x.sums.spend); const limit = a.limit ?? 1000; const truncated = out.length > limit; if (truncated) out = out.slice(0, limit);
  return { rows: out, total, truncated };
}
