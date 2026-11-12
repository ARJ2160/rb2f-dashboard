import {
  addInto,
  AD_TYPE_LABEL,
  blank,
  CITY_COORDS,
  METRICS,
  type BkCityAdsResponse,
  type BkCityAdsRow,
  type BkDailyResponse,
  type BkGeoResponse,
  type BkGroupsResponse,
  type BkKeywordRow,
  type BkKeywordsResponse,
  type BkMetaResponse,
  type MetricKey,
  type Sums,
} from '@dash/shared/blinkit';
import { daysInRange, enumerateDates, type DurMetric, type DurResponse, type SummaryPeriod, type SummaryResponse, type SummaryRow } from '@dash/shared';

import { inList, q } from '../blinkit/reports/queries';
import { changePct, periodLabel, summaryPeriods } from '../lib/periods';
import { AD_KEY_SQL, adKeysIn, getImDims, itemsIn, type ImDims } from './dims';

/* Swiggy Instamart reports — the same response shapes as /api/blinkit so the
   same dashboard views render them. Only additive sums travel; every ratio is
   derived from them (packages/shared/src/blinkit/metrics.ts).
   Mapping onto the shared Sums:
     rev = Sales GMV · units = UNITS_SOLD · orders = 0 (no order IDs in the export)
     spend = TOTAL_BUDGET_BURNT · impr · clicks · atc = TOTAL_A2C · aunits = TOTAL_CONVERSIONS
     asales = TOTAL_GMV · dsales = TOTAL_DIRECT_GMV_7_DAYS · mvp = impression-weighted AD_RANK */

export interface RangeArgs {
  profileId: string;
  from: string;
  to: string;
  category?: string | undefined;
}

type Raw = Record<string, unknown>;

const ADS = `
  sum(impressions) impr, sum(clicks) clicks, sum(a2c) atc, sum(conversions) aunits, sum(gmv) asales,
  sum(direct_gmv_7) dsales, sum(spend) spend, sum(rank_weighted) mvpw, sum(rank_impr) mvpi`;
const SALES = `sum(gmv) rev, sum(units) units`;

export function adsSums(r: Raw): Sums {
  const a = blank();
  for (const k of ['impr', 'clicks', 'atc', 'aunits', 'asales', 'dsales', 'spend', 'mvpw', 'mvpi'] as const) a[k] = Number(r[k] ?? 0);
  return a;
}
export function salesSums(r: Raw): Sums {
  const a = blank();
  a.rev = Number(r.rev ?? 0);
  a.units = Number(r.units ?? 0);
  return a;
}

async function scope(profileId: string, category?: string) {
  const d = await getImDims(profileId);
  return { d, items: category ? itemsIn(d, category) : null, keys: category ? adKeysIn(d, category) : null };
}

/** `where …` + params for one window on im_sales / im_ads, with the category filter. */
function salesWhere(a: RangeArgs, items: string[] | null) {
  const p: unknown[] = [a.profileId, a.from, a.to];
  let w = `profile_id = $1 and date between $2 and $3`;
  if (items) { p.push(items); w += inList('item_code', p.length, items); }
  return { w, p };
}
function adsWhere(a: RangeArgs, keys: string[] | null, adType?: string) {
  const p: unknown[] = [a.profileId, a.from, a.to];
  let w = `profile_id = $1 and date between $2 and $3`;
  if (keys) { p.push(keys); w += inList(AD_KEY_SQL, p.length, keys); }
  if (adType) { p.push(adType); w += ` and ad_type = $${p.length}`; }
  return { w, p };
}

/* ------------------------------------------------------------------ totals */

export async function totals(a: RangeArgs): Promise<Sums> {
  const { items, keys } = await scope(a.profileId, a.category);
  const s = salesWhere(a, items), ad = adsWhere(a, keys);
  const [sr, ar] = await Promise.all([
    q(`select ${SALES} from im_sales where ${s.w}`, s.p),
    q(`select ${ADS} from im_ads where ${ad.w}`, ad.p),
  ]);
  return addInto(salesSums(sr[0] ?? {}), adsSums(ar[0] ?? {}));
}

/* -------------------------------------------------------- category / SKU */

export async function groups(a: RangeArgs & { groupBy: 'category' | 'sku' }): Promise<BkGroupsResponse> {
  const { d, items, keys } = await scope(a.profileId, a.category);
  const s = salesWhere(a, items), ad = adsWhere(a, keys);
  const [sales, ads] = await Promise.all([
    q(`select item_code, ${SALES} from im_sales where ${s.w} group by 1`, s.p),
    q(`select ${AD_KEY_SQL} k, ${ADS} from im_ads where ${ad.w} group by 1`, ad.p),
  ]);
  const out = new Map<string, Sums>();
  const g = (k: string) => {
    let x = out.get(k);
    if (!x) out.set(k, (x = blank()));
    return x;
  };
  const total = blank();
  for (const r of sales) {
    const it = d.items.get(String(r.item_code));
    const key = it ? (a.groupBy === 'sku' ? it.sku : it.category) : 'Unmapped';
    const v = salesSums(r);
    addInto(g(key), v);
    addInto(total, v);
  }
  for (const r of ads) {
    const k = d.adKeys.get(String(r.k));
    const key = a.groupBy === 'sku' ? k?.sku || `${k?.category ?? 'Unmapped'} (no SKU)` : (k?.category ?? 'Unmapped');
    const v = adsSums(r);
    addInto(g(key), v);
    addInto(total, v);
  }
  return {
    from: a.from,
    to: a.to,
    days: daysInRange(a.from, a.to),
    total,
    groups: [...out.entries()].map(([key, sums]) => ({ key, sums })).sort((x, y) => y.sums.rev - x.sums.rev || y.sums.spend - x.sums.spend),
  };
}

/* --------------------------------------------------------------------- DSR */

export async function daily(a: RangeArgs & { adType?: string | undefined }): Promise<BkDailyResponse> {
  const { items, keys } = await scope(a.profileId, a.category);
  const s = salesWhere(a, items), ad = adsWhere(a, keys, a.adType);
  const [sales, ads, byType] = await Promise.all([
    q(`select date::text d, ${SALES} from im_sales where ${s.w} group by 1`, s.p),
    q(`select date::text d, ${ADS} from im_ads where ${ad.w} group by 1`, ad.p),
    q(`select ad_type, sum(spend) spend, sum(gmv) asales, sum(impressions) impr, sum(a2c) atc, sum(conversions) aunits,
              sum(clicks) clicks, count(distinct date) days
       from im_ads where ${ad.w} group by 1`, ad.p),
  ]);
  const dates = enumerateDates(a.from, a.to);
  const idx = new Map(dates.map((x, i) => [x, i]));
  const series = dates.map(() => blank());
  const salesDays = new Set<string>(), adDays = new Set<string>();
  for (const r of sales) {
    const i = idx.get(String(r.d));
    if (i == null) continue;
    addInto(series[i]!, salesSums(r));
    salesDays.add(String(r.d));
  }
  for (const r of ads) {
    const i = idx.get(String(r.d));
    if (i == null) continue;
    addInto(series[i]!, adsSums(r));
    adDays.add(String(r.d));
  }
  const total = series.reduce((t, x) => addInto(t, x), blank());
  const notes: string[] = [];
  const noSales = dates.filter((x) => !salesDays.has(x)).length;
  const noAds = dates.filter((x) => !adDays.has(x)).length;
  if (noSales) notes.push(`${noSales} of ${dates.length} day(s) have no Instamart sales data — revenue, organic sales and TACoS for those days are not real zeros.`);
  if (noAds) notes.push(`${noAds} of ${dates.length} day(s) have no Instamart ads data.`);
  const types = ['KW', 'SIB', 'AS', ...byType.map((r) => String(r.ad_type)).filter((t) => !['KW', 'SIB', 'AS'].includes(t))];
  const byAdType = types.map((t) => {
    const r = byType.find((x) => x.ad_type === t);
    return {
      adType: t, spend: Number(r?.spend ?? 0), asales: Number(r?.asales ?? 0), impr: Number(r?.impr ?? 0),
      atc: Number(r?.atc ?? 0), aunits: Number(r?.aunits ?? 0), clicks: Number(r?.clicks ?? 0), days: Number(r?.days ?? 0),
    };
  });
  return { from: a.from, to: a.to, dates, series, total, byAdType, notes };
}

/* --------------------------------------------------------------------- DUR */

export async function dur(a: RangeArgs & { metric: DurMetric | 'revenue' }): Promise<DurResponse> {
  const { d, items } = await scope(a.profileId, a.category);
  const s = salesWhere(a, items);
  const rows = await q(`select item_code, date::text d, sum(units) units, sum(gmv) rev from im_sales where ${s.w} group by 1, 2`, s.p);
  const dates = enumerateDates(a.from, a.to);
  const by = new Map<string, Record<string, number | null>>();
  for (const r of rows) {
    const id = String(r.item_code);
    const v = by.get(id) ?? {};
    v[String(r.d)] = (v[String(r.d)] ?? 0) + Number(a.metric === 'revenue' ? r.rev : r.units);
    by.set(id, v);
  }
  const out = [...by.entries()].map(([id, values]) => {
    const it = d.items.get(id);
    const tot = Object.values(values).reduce<number>((x, y) => x + (y ?? 0), 0);
    return {
      asin: id,
      itemName: it ? `${it.sku}${it.sku !== it.name ? ` · ${it.name}` : ''}` : id,
      category: it?.category ?? 'Unmapped',
      totals: tot,
      avg: tot / dates.length,
      values,
    };
  });
  out.sort((x, y) => (y.totals ?? 0) - (x.totals ?? 0));
  return {
    profileId: a.profileId, from: a.from, to: a.to, days: dates.length,
    metric: 'units', dates, rows: out, category: a.category ?? null, categories: d.categories,
    notes: ['One row per Instamart Item Code; SKU and category from the SKU mapper ("Unmapped" if the item is not in it). Avg = Totals ÷ days in range. The Instamart sales export has no order IDs, so there is no Orders view.'],
  };
}

/* ----------------------------------------------------------------- MoM / WoW */

type RowDef = { key: string; label: string; format: SummaryRow['format']; better: SummaryRow['better']; get: (s: Sums, days: number) => number | null };
const m = (k: MetricKey) => (s: Sums) => {
  const v = METRICS[k].get(s);
  return Number.isFinite(v) ? v : null;
};
const needsSales = (f: (s: Sums) => number | null) => (s: Sums) => (s.rev || s.units ? f(s) : null);

const ROWS: RowDef[] = [
  { key: 'sales', label: 'Sales (GMV)', format: 'money', better: 'up', get: needsSales(m('rev')) },
  { key: 'units', label: 'Units', format: 'int', better: 'up', get: needsSales(m('units')) },
  { key: 'asp', label: 'ASP (₹/unit)', format: 'money', better: 'up', get: m('asp') },
  { key: 'organicSales', label: 'Organic Sales', format: 'money', better: 'up', get: m('organic') },
  { key: 'adSales', label: 'Ad Sales (GMV)', format: 'money', better: 'up', get: m('asales') },
  { key: 'spends', label: 'Ad Spends', format: 'money', better: 'none', get: m('spend') },
  { key: 'impressions', label: 'Impressions', format: 'int', better: 'up', get: m('impr') },
  { key: 'clicks', label: 'Clicks', format: 'int', better: 'up', get: m('clicks') },
  { key: 'ctr', label: 'CTR %', format: 'pct', better: 'up', get: m('ctr') },
  { key: 'cpc', label: 'CPC', format: 'money', better: 'down', get: m('cpc') },
  { key: 'atc', label: 'Add to Carts', format: 'int', better: 'up', get: m('atc') },
  { key: 'adUnits', label: 'Ad Conversions', format: 'int', better: 'up', get: m('aunits') },
  { key: 'cvrPct', label: 'Conversion % (conv. ÷ ATC)', format: 'pct', better: 'up', get: m('cvr') },
  { key: 'cpm', label: 'CPM', format: 'money', better: 'down', get: m('cpm') },
  { key: 'acosPct', label: 'ACOS%', format: 'pct', better: 'down', get: m('acos') },
  { key: 'tacosPct', label: 'TACOS%', format: 'pct', better: 'down', get: needsSales(m('tacos')) },
  { key: 'roas', label: 'ROAS', format: 'ratio', better: 'up', get: m('roas') },
  { key: 'troas', label: 'Total ROAS', format: 'ratio', better: 'up', get: m('troas') },
  { key: 'organicPct', label: 'Organic contribution %', format: 'pct', better: 'up', get: m('orgshare') },
  { key: 'adPct', label: 'Ad contribution %', format: 'pct', better: 'none', get: needsSales(m('adshare')) },
  { key: 'adRank', label: 'Avg Ad Rank', format: 'ratio', better: 'down', get: m('mvp') },
  { key: 'spendPerDay', label: 'Ad Spends / day', format: 'money', better: 'none', get: (s, n) => (n ? s.spend / n : null) },
  { key: 'salesPerDay', label: 'Sales / day', format: 'money', better: 'up', get: (s, n) => (n && (s.rev || s.units) ? s.rev / n : null) },
];

async function latestDates(profileId: string) {
  const [r] = await q<{ sales: string | null; ads: string | null }>(
    `select (select max(date)::text from im_sales where profile_id = $1) sales, (select max(date)::text from im_ads where profile_id = $1) ads`,
    [profileId]
  );
  return { sales: r?.sales ?? null, ads: r?.ads ?? null };
}

async function missingDays(profileId: string, from: string, to: string) {
  const [r] = await q<{ s: number | string; a: number | string }>(
    `select (select count(distinct date) from im_sales where profile_id = $1 and date between $2 and $3) s,
            (select count(distinct date) from im_ads where profile_id = $1 and date between $2 and $3) a`,
    [profileId, from, to]
  );
  const n = daysInRange(from, to);
  return { missingSalesDays: n - Number(r?.s ?? 0), missingAdDays: n - Number(r?.a ?? 0) };
}

export async function momWow(a: { profileId: string; asOf?: string | undefined; category?: string | undefined }): Promise<SummaryResponse> {
  const latest = await latestDates(a.profileId);
  const autoAsOf = latest.sales && latest.ads ? (latest.sales < latest.ads ? latest.sales : latest.ads) : (latest.sales ?? latest.ads);
  const asOf = a.asOf ?? autoAsOf;
  const { d } = await scope(a.profileId, a.category);
  const base: SummaryResponse = {
    profileId: a.profileId, asOf: asOf ?? null, autoAsOf: autoAsOf ?? null, latest,
    category: a.category ?? null, categories: d.categories, periods: null, rows: [], notes: [],
  };
  if (!asOf) {
    base.notes.push('No Instamart sales or ads data for this brand yet.');
    return base;
  }
  const w = summaryPeriods(asOf);
  const keys = ['mtd', 'pmtd', 'l7d', 'p7d'] as const;
  const short = { mtd: 'MTD', pmtd: 'PMTD', l7d: 'L7D', p7d: 'P7D' } as const;
  const loaded = await Promise.all(
    keys.map(async (k) => {
      const p = w[k];
      const [sums, miss] = await Promise.all([
        totals({ profileId: a.profileId, from: p.from, to: p.to, category: a.category }),
        missingDays(a.profileId, p.from, p.to),
      ]);
      const period: SummaryPeriod = { ...p, label: periodLabel(p.from, p.to), short: short[k], days: daysInRange(p.from, p.to), ...miss };
      return { k, sums, period };
    })
  );
  const P = Object.fromEntries(loaded.map((x) => [x.k, x])) as Record<(typeof keys)[number], (typeof loaded)[number]>;
  base.periods = { mtd: P.mtd.period, pmtd: P.pmtd.period, l7d: P.l7d.period, p7d: P.p7d.period };
  const val = (r: RowDef, k: (typeof keys)[number]) => r.get(P[k].sums, P[k].period.days);
  base.rows = ROWS.map((r) => {
    const v = { mtd: val(r, 'mtd'), pmtd: val(r, 'pmtd'), l7d: val(r, 'l7d'), p7d: val(r, 'p7d') };
    return { key: r.key, label: r.label, format: r.format, better: r.better, ...v, mom: changePct(v.mtd, v.pmtd), wow: changePct(v.l7d, v.p7d) };
  });
  for (const k of keys) {
    const p = P[k].period;
    if (p.missingSalesDays) base.notes.push(`${p.short} (${p.label}): ${p.missingSalesDays} of ${p.days} day(s) have no sales data — sales-based values are partial or "—".`);
    if (p.missingAdDays) base.notes.push(`${p.short} (${p.label}): ${p.missingAdDays} of ${p.days} day(s) have no ads data.`);
  }
  base.notes.push('Ratios are recomputed from each period\'s totals. Sales = GMV from the Instamart sales export; Ad Sales = TOTAL_GMV of the ads report; Organic = Sales − Ad Sales. No order IDs in the export, so no Orders / AOV.');
  return base;
}

/* --------------------------------------------------------------------- Geo */

const COORD_KEYS = new Map(Object.keys(CITY_COORDS).map((c) => [c.toLowerCase(), c]));
/** "Noida 1" → Noida's state; unknown cities → "Other". */
export function stateOf(city: string): string {
  const base = city.replace(/\s+\d+$/, '').toLowerCase();
  const hit = COORD_KEYS.get(base);
  return hit ? CITY_COORDS[hit]![0] : 'Other';
}

export async function geo(a: RangeArgs): Promise<BkGeoResponse> {
  const { items } = await scope(a.profileId, a.category);
  const s = salesWhere(a, items);
  const cities = await q(`select city k, ${SALES} from im_sales where ${s.w} group by 1`, s.p);
  const states = new Map<string, Sums>();
  const cityRows = cities.map((r) => {
    const st = stateOf(String(r.k));
    const v = salesSums(r);
    addInto(states.get(st) ?? (states.set(st, blank()), states.get(st)!), v);
    return { key: String(r.k || 'Unknown'), state: st, sums: v };
  });
  return {
    states: [...states.entries()].map(([k, sums]) => ({ key: k, state: k, sums })),
    cities: cityRows,
  };
}

/* ---------------------------------------------------------------- City ads */

/** Instamart's ads report carries the city on every row, so spend is exact per city — nothing is inferred or split. */
export async function cityAds(a: RangeArgs): Promise<BkCityAdsResponse> {
  const { d, items, keys } = await scope(a.profileId, a.category);
  const s = salesWhere(a, items), ad = adsWhere(a, keys);
  const [ads, camps, sales] = await Promise.all([
    q(`select city k, ${ADS} from im_ads where ${ad.w} group by 1`, ad.p),
    q(`select city k, campaign_id c, sum(spend) sp from im_ads where ${ad.w} group by 1, 2`, ad.p),
    q(`select city k, ${SALES} from im_sales where ${s.w} group by 1`, s.p),
  ]);
  const rev = new Map(sales.map((r) => [String(r.k), salesSums(r)]));
  const campsBy = new Map<string, string[]>();
  for (const r of camps) {
    if (Number(r.sp) <= 0) continue;
    const list = campsBy.get(String(r.k)) ?? [];
    list.push(d.campaigns.get(String(r.c))?.name ?? String(r.c));
    campsBy.set(String(r.k), list);
  }
  const notAttr = { spend: 0, asales: 0, impr: 0, campaigns: 0 };
  let totalSpend = 0;
  const rows: BkCityAdsRow[] = [];
  for (const r of ads) {
    const city = String(r.k);
    const v = adsSums(r);
    totalSpend += v.spend;
    if (!city || city === 'Unknown') {
      notAttr.spend += v.spend; notAttr.asales += v.asales; notAttr.impr += v.impr;
      continue;
    }
    const sv = rev.get(city);
    rows.push({ key: city, label: city, cities: [city], kind: 'city', campaigns: campsBy.get(city) ?? [], sums: addInto(v, { rev: sv?.rev ?? 0, units: sv?.units ?? 0 }) });
  }
  rows.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows, groups: [], notAttributable: notAttr, totalSpend };
}

/* ---------------------------------------------------------------- Keywords */

export interface KwArgs extends RangeArgs {
  campaignId?: string | undefined;
  /** a city (meta.geoUnits key) */
  geo?: string | undefined;
  adType?: string | undefined;
  grain: 'kw' | 'kwc';
  search?: string | undefined;
  minImpr?: number;
  sort?: string;
  limit?: number;
}

export async function keywords(a: KwArgs): Promise<BkKeywordsResponse> {
  const { d, keys } = await scope(a.profileId, a.category);
  const ad = adsWhere(a, keys, a.adType);
  if (a.campaignId) { ad.p.push(a.campaignId); ad.w += ` and campaign_id = $${ad.p.length}`; }
  if (a.geo) { ad.p.push(a.geo); ad.w += ` and city = $${ad.p.length}`; }
  const kwExpr = `case when keyword <> '' then keyword else '[' || ad_type || '] (no keyword)' end`;
  const rows = await q(`select ${kwExpr} kw, campaign_id, ad_type, ${AD_KEY_SQL} k, ${ADS} from im_ads where ${ad.w} group by 1, 2, 3, 4`, ad.p);
  const out = new Map<string, BkKeywordRow & { cats: Set<string>; cps: Set<string> }>();
  for (const r of rows) {
    const kw = String(r.kw);
    const c = d.campaigns.get(String(r.campaign_id));
    const key = a.grain === 'kwc' ? kw + '\u0001' + r.campaign_id : kw;
    let k = out.get(key);
    if (!k) {
      k = { keyword: kw, campaign: a.grain === 'kwc' ? (c?.name ?? String(r.campaign_id)) : null, adType: String(r.ad_type),
        campaigns: [], categories: [], sums: blank(), cats: new Set(), cps: new Set() };
      out.set(key, k);
    }
    k.cats.add(d.adKeys.get(String(r.k))?.category ?? 'Unmapped');
    k.cps.add(c?.name ?? String(r.campaign_id));
    addInto(k.sums, adsSums(r));
  }
  let list = [...out.values()].map(({ cats, cps, ...k }) => ({ ...k, categories: [...cats], campaigns: [...cps] }));
  if (a.search) { const s = a.search.toLowerCase(); list = list.filter((k) => k.keyword.toLowerCase().includes(s)); }
  if (a.minImpr) list = list.filter((k) => k.sums.impr >= a.minImpr!);
  const total = blank();
  for (const k of list) addInto(total, k.sums);
  const sortKey = (a.sort ?? 'spend') as keyof Sums;
  list.sort((x, y) => (y.sums[sortKey] ?? 0) - (x.sums[sortKey] ?? 0));
  const limit = a.limit ?? 1000;
  return { rows: list.slice(0, limit), total, truncated: list.length > limit };
}

/* -------------------------------------------------------------------- Meta */

export async function meta(profileId: string): Promise<BkMetaResponse> {
  const d: ImDims = await getImDims(profileId);
  const [s, a, itemRev, keySpend, citySpend] = await Promise.all([
    q(`select min(date)::text f, max(date)::text t, count(*) n from im_sales where profile_id=$1`, [profileId]),
    q(`select min(date)::text f, max(date)::text t, count(*) n from im_ads where profile_id=$1`, [profileId]),
    q(`select item_code, sum(gmv) r from im_sales where profile_id=$1 group by 1`, [profileId]),
    q(`select ${AD_KEY_SQL} k, campaign_id c, sum(spend) s from im_ads where profile_id=$1 group by 1, 2`, [profileId]),
    q(`select city, sum(spend) s from im_ads where profile_id=$1 group by 1 order by 2 desc`, [profileId]),
  ]);
  const rev = new Map(itemRev.map((r) => [String(r.item_code), Number(r.r)]));
  const campSpend = new Map<string, number>();
  const unmappedSpend = new Map<string, number>();
  for (const r of keySpend) {
    campSpend.set(String(r.c), (campSpend.get(String(r.c)) ?? 0) + Number(r.s));
    if (d.adKeys.get(String(r.k))?.how === 'unmapped') unmappedSpend.set(String(r.c), (unmappedSpend.get(String(r.c)) ?? 0) + Number(r.s));
  }
  const notes: string[] = [];
  const byName = [...d.adKeys.values()].filter((k) => k.how === 'name match').map((k) => k.campaignId);
  if (byName.length) {
    const names = [...new Set(byName)].map((id) => d.campaigns.get(id)?.name ?? id);
    notes.push(`${names.length} campaign(s) are not in the SKU mapper; their SKU was matched from the campaign name (${names.slice(0, 4).join(', ')}${names.length > 4 ? ', …' : ''}). Add them to the mapper to be exact.`);
  }
  return {
    profileId,
    sales: { from: (s[0]?.f as string | null) ?? null, to: (s[0]?.t as string | null) ?? null, rows: Number(s[0]?.n ?? 0) },
    ads: { from: (a[0]?.f as string | null) ?? null, to: (a[0]?.t as string | null) ?? null, rows: Number(a[0]?.n ?? 0) },
    inventory: { snapshots: [] },
    categories: d.categories,
    skus: d.skus,
    campaigns: [...d.campaigns.values()]
      .sort((x, y) => (campSpend.get(y.id) ?? 0) - (campSpend.get(x.id) ?? 0))
      .map((c) => ({
        id: c.id, name: c.name, adType: AD_TYPE_LABEL[c.adType] ? c.adType : c.adType, category: c.category,
        geoKind: 'city', geoLabel: `${c.cities} cit${c.cities === 1 ? 'y' : 'ies'} (city on every report row)`,
      })),
    geoUnits: citySpend
      .filter((r) => Number(r.s) > 0 && r.city && r.city !== 'Unknown')
      .map((r) => ({ key: String(r.city), label: String(r.city), cities: [String(r.city)], kind: 'city' as const })),
    unmappedItems: [...d.items.values()].filter((i) => !i.mapped).map((i) => ({ itemId: i.itemCode, name: i.name, revenue: rev.get(i.itemCode) ?? 0 }))
      .sort((x, y) => y.revenue - x.revenue),
    unmappedCampaigns: [...unmappedSpend.entries()].map(([id, spend]) => ({ id, name: d.campaigns.get(id)?.name ?? id, spend }))
      .sort((x, y) => y.spend - x.spend),
    notes,
  };
}
