import {
  addInto, blank, type Sums,
  type MeAsinResponse, type MeDailyResponse, type MeGeoResponse, type MeGroupsResponse,
  type MeDurResponse, type MeManualAdsResponse, type MeMetaResponse,
} from '@dash/shared/meesho';
import { and, eq } from 'drizzle-orm';
import { db } from '../db/client';
import { meManualAds } from './schema';
import { q } from '../blinkit/reports/queries';
import { canonCat, getMeDims } from './reports/dims';

export interface RangeArgs { profileId: string; from: string; to: string; category?: string | undefined }
type Raw = Record<string, unknown>;
const n = (v: unknown) => Number(v ?? 0);
function salesRow(r: Raw): Sums { const a = blank(); a.rev = n(r.rev); a.units = n(r.units); return a; }
const getOrBlank = (m: Map<string, Sums>, k: string) => { let s = m.get(k); if (!s) m.set(k, (s = blank())); return s; };
const dayCount = (f: string, t: string) => Math.max(1, Math.round((Date.parse(t) - Date.parse(f)) / 86_400_000) + 1);
function salesWhere(a: RangeArgs, p: unknown[]): string { p.push(a.profileId, a.from, a.to); let w = `s.profile_id=$1 and s.date between $2 and $3`; if (a.category) { p.push(canonCat(a.category)); w += ` and upper(coalesce(m.category,'UNMAPPED')) = $${p.length}`; } return w; }

export async function meta(profileId: string): Promise<MeMetaResponse> {
  const d = await getMeDims(profileId);
  const [[salesAgg], [ordAgg], [adAgg], unmappedSku] = await Promise.all([
    q<{ f: string; t: string; c: string }>(`select min(date) f, max(date) t, count(*) c from me_daily_sku_sales where profile_id=$1`, [profileId]),
    q<{ f: string; t: string; c: string }>(`select min(date) f, max(date) t, count(*) c from me_order_agg where profile_id=$1`, [profileId]),
    q<{ c: string; spend: string }>(`select count(*) c, sum(spend) spend from me_manual_ads where profile_id=$1`, [profileId]),
    q<{ sku: string; name: string; rev: string }>(`select sku, max(title) name, sum(revenue) rev from me_daily_sku_sales s where profile_id=$1 and not exists (select 1 from me_sku_map m where m.profile_id=s.profile_id and m.sku=s.sku) group by 1 order by 3 desc limit 50`, [profileId]),
  ]);
  const notes: string[] = [];
  if (!n(adAgg?.c)) notes.push('No ad spend entered — Meesho has no ad feed, so ACoS / TACoS / ROAS stay blank until you add spend under Ads.');
  return {
    profileId,
    sales: { from: salesAgg?.f ?? null, to: salesAgg?.t ?? null, rows: n(salesAgg?.c) },
    orders: { from: ordAgg?.f ?? null, to: ordAgg?.t ?? null, rows: n(ordAgg?.c) },
    manualAds: { rows: n(adAgg?.c), spend: n(adAgg?.spend) },
    categories: d.categories, states: d.states,
    unmappedSkus: unmappedSku.map((r) => ({ sku: r.sku, name: r.name, rev: n(r.rev) })),
    notes,
  };
}

export async function groups(a: RangeArgs, groupBy: 'category' | 'sku'): Promise<MeGroupsResponse> {
  const d = await getMeDims(a.profileId); const byCat = groupBy === 'category'; const sp: unknown[] = [];
  const sql = `select ${byCat ? `upper(coalesce(m.category,'UNMAPPED'))` : 's.sku'} k, sum(s.revenue) rev, sum(s.units) units from me_daily_sku_sales s left join me_sku_map m on m.profile_id=s.profile_id and m.sku=s.sku where ${salesWhere(a, sp)} group by 1`;
  const salesRows = await q<Raw>(sql, sp);
  const map = new Map<string, Sums>(); for (const r of salesRows) addInto(getOrBlank(map, String(r.k)), salesRow(r));
  const total = blank();
  const groupsOut = [...map.entries()].map(([k, sums]) => { addInto(total, sums); return { key: byCat ? k : d.skus.get(k)?.name || k, sums }; });
  groupsOut.sort((x, y) => y.sums.rev - x.sums.rev);
  return { from: a.from, to: a.to, days: dayCount(a.from, a.to), total, groups: groupsOut };
}

export async function daily(a: RangeArgs): Promise<MeDailyResponse> {
  const sp: unknown[] = [];
  const gross = await q<{ d: string; rev: string; units: string }>(`select s.date d, sum(s.revenue) rev, sum(s.units) units from me_daily_sku_sales s left join me_sku_map m on m.profile_id=s.profile_id and m.sku=s.sku where ${salesWhere(a, sp)} group by 1 order by 1`, sp);
  const op: unknown[] = [];
  const net = await q<{ d: string; nrev: string; nunits: string; ret: string; rto: string; canc: string }>(`select s.date d, sum(s.net_revenue) nrev, sum(s.net_units) nunits, sum(s.returned_units) ret, sum(s.rto_units) rto, sum(s.cancelled_units) canc from me_order_agg s left join me_sku_map m on m.profile_id=s.profile_id and m.sku=s.sku where ${salesWhere(a, op)} group by 1`, op);
  const [adAgg] = await q<Raw>(`select sum(spend) spend, sum(ad_sales) asales, sum(ad_units) aunits from me_manual_ads where profile_id=$1 and date between $2 and $3`, [a.profileId, a.from, a.to]);
  const netByD = new Map(net.map((r) => [r.d, r]));
  const dates = [...new Set([...gross.map((r) => r.d), ...net.map((r) => r.d)])].sort();
  const grossByD = new Map(gross.map((r) => [r.d, r]));
  const rows = dates.map((d) => { const g = grossByD.get(d); const o = netByD.get(d); return { date: d, grossRev: n(g?.rev), grossUnits: n(g?.units), netRev: n(o?.nrev), netUnits: n(o?.nunits), returnsUnits: n(o?.ret), rtoUnits: n(o?.rto), cancellationsUnits: n(o?.canc) }; });
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((t, x) => t + (x[k] as number), 0);
  const adSpend = n(adAgg?.spend);
  return {
    from: a.from, to: a.to, dates, rows,
    totals: { grossRev: sum('grossRev'), grossUnits: sum('grossUnits'), netRev: sum('netRev'), netUnits: sum('netUnits'), returnsUnits: sum('returnsUnits'), rtoUnits: sum('rtoUnits'), cancellationsUnits: sum('cancellationsUnits'), adSpend, adSales: n(adAgg?.asales), adUnits: n(adAgg?.aunits) },
    adsEntered: adSpend > 0, notes: [],
  };
}

export async function dur(a: RangeArgs, metric: 'units' | 'rev' | 'net_units'): Promise<MeDurResponse> {
  const d = await getMeDims(a.profileId); const sp: unknown[] = [];
  const net = metric === 'net_units';
  const col = metric === 'rev' ? 's.revenue' : metric === 'net_units' ? 's.net_units' : 's.units';
  const table = net ? 'me_order_agg' : 'me_daily_sku_sales';
  const rows = await q<{ sku: string; d: string; v: string }>(`select s.sku sku, s.date d, sum(${col}) v from ${table} s left join me_sku_map m on m.profile_id=s.profile_id and m.sku=s.sku where ${salesWhere(a, sp)} group by 1,2`, sp);
  const dates = [...new Set(rows.map((r) => r.d))].sort(); const di = new Map(dates.map((x, i) => [x, i]));
  const bySku = new Map<string, number[]>();
  for (const r of rows) { let arr = bySku.get(r.sku); if (!arr) bySku.set(r.sku, (arr = new Array(dates.length).fill(0))); arr[di.get(r.d)!] = n(r.v); }
  const out = [...bySku.entries()].map(([sku, values]) => { const dim = d.skus.get(sku); return { sku, name: dim?.name || sku, category: dim?.category || 'UNMAPPED', values, total: values.reduce((t, x) => t + x, 0) }; });
  out.sort((x, y) => y.total - x.total);
  return { dates, metric, rows: out };
}

export async function asinLevel(a: RangeArgs & { limit?: number }): Promise<MeAsinResponse> {
  const d = await getMeDims(a.profileId); const sp: unknown[] = [];
  const rows = await q<{ k: string; rev: string; units: string }>(`select s.sku k, sum(s.revenue) rev, sum(s.units) units from me_daily_sku_sales s left join me_sku_map m on m.profile_id=s.profile_id and m.sku=s.sku where ${salesWhere(a, sp)} group by 1`, sp);
  const total = blank();
  let out = rows.map((r) => { const sums = salesRow(r); addInto(total, sums); const dim = d.skus.get(r.k); return { sku: r.k, name: dim?.name || r.k, category: dim?.category || 'UNMAPPED', sums }; });
  out.sort((x, y) => y.sums.rev - x.sums.rev);
  const limit = a.limit ?? 2000; const truncated = out.length > limit; if (truncated) out = out.slice(0, limit);
  return { rows: out, total, truncated };
}

export async function geo(a: RangeArgs): Promise<MeGeoResponse> {
  const sp: unknown[] = [];
  const rows = await q<{ state: string; rev: string; units: string }>(`select s.state state, sum(s.revenue) rev, sum(s.units) units from me_daily_sku_sales s left join me_sku_map m on m.profile_id=s.profile_id and m.sku=s.sku where ${salesWhere(a, sp)} and s.state <> '' group by 1`, sp);
  const out = rows.map((r) => ({ state: r.state, sums: salesRow(r) })); out.sort((x, y) => y.sums.rev - x.sums.rev);
  return { states: out };
}

export async function manualAds(a: RangeArgs): Promise<MeManualAdsResponse> {
  const rows = await q<{ date: string; campaign: string; spend: string; asales: string; aunits: string; impr: string; clk: string }>(`select date, campaign, spend, ad_sales asales, ad_units aunits, impressions impr, clicks clk from me_manual_ads where profile_id=$1 and date between $2 and $3 order by date desc, campaign`, [a.profileId, a.from, a.to]);
  const total = { spend: 0, adSales: 0, adUnits: 0 };
  const out = rows.map((r) => { total.spend += n(r.spend); total.adSales += n(r.asales); total.adUnits += n(r.aunits); return { date: r.date, campaign: r.campaign, spend: n(r.spend), adSales: n(r.asales), adUnits: n(r.aunits), impressions: n(r.impr), clicks: n(r.clk) }; });
  return { rows: out, total };
}

export interface ManualAdInput { profileId: string; date: string; campaign: string; spend: number; adSales?: number; adUnits?: number; impressions?: number; clicks?: number }
export async function upsertManualAd(i: ManualAdInput): Promise<void> {
  await db.insert(meManualAds).values({ profileId: i.profileId, date: i.date, campaign: i.campaign, spend: i.spend, adSales: i.adSales ?? 0, adUnits: i.adUnits ?? 0, impressions: i.impressions ?? 0, clicks: i.clicks ?? 0 })
    .onConflictDoUpdate({ target: [meManualAds.profileId, meManualAds.date, meManualAds.campaign], set: { spend: i.spend, adSales: i.adSales ?? 0, adUnits: i.adUnits ?? 0, impressions: i.impressions ?? 0, clicks: i.clicks ?? 0 } });
}
export async function deleteManualAd(profileId: string, date: string, campaign: string): Promise<void> {
  await db.delete(meManualAds).where(and(eq(meManualAds.profileId, profileId), eq(meManualAds.date, date), eq(meManualAds.campaign, campaign)));
}
