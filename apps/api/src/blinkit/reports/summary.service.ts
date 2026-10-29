import {
  addInto,
  blank,
  METRICS,
  type BkDailyResponse,
  type BkGeoResponse,
  type BkGroupsResponse,
  type MetricKey,
  type Sums,
} from '@dash/shared/blinkit';
import { daysInRange, enumerateDates, type DurMetric, type DurResponse, type SummaryPeriod, type SummaryResponse, type SummaryRow } from '@dash/shared';

import { changePct, periodLabel, summaryPeriods } from '../../lib/periods';
import { campaignsIn, getDims, itemsIn } from './dims';
import { ADS_SUMS, adsRow, inList, q, salesRow } from './queries';

export interface RangeArgs {
  profileId: string;
  from: string;
  to: string;
  category?: string | undefined;
}

/** Item / campaign ID filters for a category (null = no filter). */
async function scope(profileId: string, category?: string) {
  const d = await getDims(profileId);
  return { d, items: category ? itemsIn(d, category) : null, camps: category ? campaignsIn(d, category) : null };
}

/* ------------------------------------------------------------------ totals */

/** Sales + ads totals for one window. */
export async function totals(a: RangeArgs): Promise<Sums> {
  const { items, camps } = await scope(a.profileId, a.category);
  const P = [a.profileId, a.from, a.to];
  const [s, ad] = await Promise.all([
    q(
      `select sum(revenue) rev, sum(quantity) units, count(distinct order_id) orders
       from bk_sales_lines where profile_id = $1 and date between $2 and $3 ${inList('item_id', 4, items)}`,
      [...P, ...(items ? [items] : [])]
    ),
    q(
      `select ${ADS_SUMS} from bk_daily_ads where profile_id = $1 and date between $2 and $3 ${inList('campaign_id', 4, camps)}`,
      [...P, ...(camps ? [camps] : [])]
    ),
  ]);
  return addInto(salesRow(s[0] ?? {}), adsRow(ad[0] ?? {}));
}

/* -------------------------------------------------------- category / SKU */

/** Totals + rows grouped by category or SKU. Sales join through the SKU mapper, ads through the campaign mapper. */
export async function groups(a: RangeArgs & { groupBy: 'category' | 'sku' }): Promise<BkGroupsResponse> {
  const { d, items, camps } = await scope(a.profileId, a.category);
  const P = [a.profileId, a.from, a.to];
  const all = [...d.items.values()];
  const grpOf = (id: string) => {
    const it = d.items.get(id);
    return it ? (a.groupBy === 'sku' ? it.sku : it.category) : 'Unmapped';
  };
  const [groupSales, total, ads] = await Promise.all([
    q(
      `with m(item_id, grp) as (select * from unnest($4::text[], $5::text[]))
       select coalesce(m.grp, 'Unmapped') grp, sum(s.revenue) rev, sum(s.quantity) units, count(distinct s.order_id) orders
       from bk_sales_lines s left join m on m.item_id = s.item_id
       where s.profile_id = $1 and s.date between $2 and $3 ${inList('s.item_id', 6, items)}
       group by 1`,
      [...P, all.map((i) => i.itemId), all.map((i) => grpOf(i.itemId)), ...(items ? [items] : [])]
    ),
    q(
      `select sum(revenue) rev, sum(quantity) units, count(distinct order_id) orders
       from bk_sales_lines where profile_id = $1 and date between $2 and $3 ${inList('item_id', 4, items)}`,
      [...P, ...(items ? [items] : [])]
    ),
    q(
      `select campaign_id, ${ADS_SUMS} from bk_daily_ads
       where profile_id = $1 and date between $2 and $3 ${inList('campaign_id', 4, camps)} group by 1`,
      [...P, ...(camps ? [camps] : [])]
    ),
  ]);

  const out = new Map<string, Sums>();
  const g = (k: string) => {
    let s = out.get(k);
    if (!s) out.set(k, (s = blank()));
    return s;
  };
  for (const r of groupSales) addInto(g(String(r.grp)), salesRow(r));
  const tot = salesRow(total[0] ?? {});
  for (const r of ads) {
    const c = d.campaigns.get(String(r.campaign_id));
    const key = a.groupBy === 'sku' ? c?.sku || `${c?.category ?? 'Unmapped'} (no SKU)` : (c?.category ?? 'Unmapped');
    const s = adsRow(r);
    addInto(g(key), s);
    addInto(tot, s);
  }
  return {
    from: a.from,
    to: a.to,
    days: daysInRange(a.from, a.to),
    total: tot,
    groups: [...out.entries()]
      .map(([key, sums]) => ({ key, sums }))
      .sort((x, y) => y.sums.rev - x.sums.rev || y.sums.spend - x.sums.spend),
  };
}

/* --------------------------------------------------------------------- DSR */

/** One row of raw sums per date (DSR + trend chart). */
export async function daily(a: RangeArgs): Promise<BkDailyResponse> {
  const { items, camps } = await scope(a.profileId, a.category);
  const P = [a.profileId, a.from, a.to];
  const [sales, ads, byType] = await Promise.all([
    q(
      `select date::text d, sum(revenue) rev, sum(quantity) units, count(distinct order_id) orders
       from bk_sales_lines where profile_id = $1 and date between $2 and $3 ${inList('item_id', 4, items)} group by 1`,
      [...P, ...(items ? [items] : [])]
    ),
    q(
      `select date::text d, ${ADS_SUMS} from bk_daily_ads
       where profile_id = $1 and date between $2 and $3 ${inList('campaign_id', 4, camps)} group by 1`,
      [...P, ...(camps ? [camps] : [])]
    ),
    q(
      `select ad_type, sum(spend) spend, sum(direct_sales + indirect_sales) asales, sum(impressions) impr, count(distinct date) days
       from bk_daily_ads where profile_id = $1 and date between $2 and $3 ${inList('campaign_id', 4, camps)} group by 1`,
      [...P, ...(camps ? [camps] : [])]
    ),
  ]);
  const dates = enumerateDates(a.from, a.to);
  const idx = new Map(dates.map((x, i) => [x, i]));
  const series = dates.map(() => blank());
  const salesDays = new Set<string>();
  const adDays = new Set<string>();
  for (const r of sales) {
    const i = idx.get(String(r.d));
    if (i == null) continue;
    addInto(series[i]!, salesRow(r));
    salesDays.add(String(r.d));
  }
  for (const r of ads) {
    const i = idx.get(String(r.d));
    if (i == null) continue;
    addInto(series[i]!, adsRow(r));
    adDays.add(String(r.d));
  }
  const total = series.reduce((t, s) => addInto(t, s), blank());
  const notes: string[] = [];
  const noSales = dates.filter((x) => !salesDays.has(x)).length;
  const noAds = dates.filter((x) => !adDays.has(x)).length;
  if (noSales) notes.push(`${noSales} of ${dates.length} day(s) have no Blinkit sales data — revenue, organic sales and TACoS for those days are not real zeros.`);
  if (noAds) notes.push(`${noAds} of ${dates.length} day(s) have no Blinkit ads data.`);
  const order = ['PL', 'PR', 'BL'];
  const byAdType = order.map((t) => {
    const r = byType.find((x) => x.ad_type === t);
    return { adType: t, spend: Number(r?.spend ?? 0), asales: Number(r?.asales ?? 0), impr: Number(r?.impr ?? 0), days: Number(r?.days ?? 0) };
  });
  return { from: a.from, to: a.to, dates, series, total, byAdType, notes };
}

/* --------------------------------------------------------------------- DUR */

/** Item × date pivot in the Amazon DurResponse shape (`asin` = Blinkit Item ID). */
export async function dur(a: RangeArgs & { metric: DurMetric | 'revenue' }): Promise<DurResponse> {
  const { d, items } = await scope(a.profileId, a.category);
  const rows = await q(
    `select item_id, date::text d, sum(quantity) units, count(distinct order_id) orders, sum(revenue) rev
     from bk_sales_lines where profile_id = $1 and date between $2 and $3 ${inList('item_id', 4, items)} group by 1, 2`,
    [a.profileId, a.from, a.to, ...(items ? [items] : [])]
  );
  const dates = enumerateDates(a.from, a.to);
  const pick = (r: Record<string, unknown>) => Number(a.metric === 'orders' ? r.orders : a.metric === 'revenue' ? r.rev : r.units);
  const by = new Map<string, Record<string, number | null>>();
  for (const r of rows) {
    const id = String(r.item_id);
    const v = by.get(id) ?? {};
    v[String(r.d)] = (v[String(r.d)] ?? 0) + pick(r);
    by.set(id, v);
  }
  const out = [...by.entries()].map(([id, values]) => {
    const it = d.items.get(id);
    const tot = Object.values(values).reduce<number>((s, x) => s + (x ?? 0), 0);
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
  const notes = [
    'One row per Blinkit Item ID; SKU, name and category from the SKU mapper ("Unmapped" if the item is not in it). Avg = Totals ÷ days in range.',
  ];
  if (a.metric === 'orders') notes.push('Orders are counted per item, so a basket with two products counts once for each.');
  return {
    profileId: a.profileId,
    from: a.from,
    to: a.to,
    days: dates.length,
    metric: a.metric === 'revenue' ? 'units' : a.metric,
    dates,
    rows: out,
    category: a.category ?? null,
    categories: d.categories,
    notes,
  };
}

/* ----------------------------------------------------------------- MoM / WoW */

type Fmt = SummaryRow['format'];
type RowDef = { key: string; label: string; format: Fmt; better: SummaryRow['better']; get: (s: Sums, days: number) => number | null };

const metric = (k: MetricKey) => (s: Sums) => {
  const v = METRICS[k].get(s);
  return Number.isFinite(v) ? v : null;
};
/** Sales-based values are meaningless (not zero) when a window has no sales file at all. */
const needsSales = (f: (s: Sums) => number | null) => (s: Sums) => (s.rev || s.units ? f(s) : null);

/** Same order as the Amazon MoM / WoW sheet, plus the Blinkit-only ad metrics. */
const ROWS: RowDef[] = [
  { key: 'sales', label: 'Sales', format: 'money', better: 'up', get: needsSales(metric('rev')) },
  { key: 'units', label: 'Units', format: 'int', better: 'up', get: needsSales(metric('units')) },
  { key: 'orders', label: 'Orders', format: 'int', better: 'up', get: needsSales(metric('orders')) },
  { key: 'aov', label: 'AOV', format: 'money', better: 'up', get: metric('aov') },
  { key: 'asp', label: 'ASP (₹/unit)', format: 'money', better: 'up', get: metric('asp') },
  { key: 'organicSales', label: 'Organic Sales', format: 'money', better: 'up', get: metric('organic') },
  { key: 'adSales', label: 'Ad Sales', format: 'money', better: 'up', get: metric('asales') },
  { key: 'spends', label: 'Ad Spends', format: 'money', better: 'none', get: metric('spend') },
  { key: 'adUnits', label: 'Ad Units', format: 'int', better: 'up', get: metric('aunits') },
  { key: 'impressions', label: 'Impressions', format: 'int', better: 'up', get: metric('impr') },
  { key: 'atc', label: 'Add to Carts', format: 'int', better: 'up', get: metric('atc') },
  { key: 'atcPct', label: 'ATC %', format: 'pct', better: 'up', get: metric('atcr') },
  { key: 'cvrPct', label: 'Conversion % (ad units ÷ ATC)', format: 'pct', better: 'up', get: metric('cvr') },
  { key: 'cpm', label: 'CPM', format: 'money', better: 'down', get: metric('cpm') },
  { key: 'acosPct', label: 'ACOS%', format: 'pct', better: 'down', get: metric('acos') },
  { key: 'tacosPct', label: 'TACOS%', format: 'pct', better: 'down', get: needsSales(metric('tacos')) },
  { key: 'roas', label: 'ROAS', format: 'ratio', better: 'up', get: metric('roas') },
  { key: 'troas', label: 'Total ROAS', format: 'ratio', better: 'up', get: metric('troas') },
  { key: 'organicPct', label: 'Organic contribution %', format: 'pct', better: 'up', get: metric('orgshare') },
  { key: 'adPct', label: 'Ad contribution %', format: 'pct', better: 'none', get: needsSales(metric('adshare')) },
  { key: 'newUsers', label: 'New Users', format: 'int', better: 'up', get: metric('nu') },
  { key: 'spendPerDay', label: 'Ad Spends / day', format: 'money', better: 'none', get: (s, n) => (n ? s.spend / n : null) },
  { key: 'salesPerDay', label: 'Sales / day', format: 'money', better: 'up', get: (s, n) => (n && (s.rev || s.units) ? s.rev / n : null) },
];

async function latestDates(profileId: string) {
  const [r] = await q<{ sales: string | null; ads: string | null }>(
    `select (select max(date)::text from bk_sales_lines where profile_id = $1) sales,
            (select max(date)::text from bk_daily_ads where profile_id = $1) ads`,
    [profileId]
  );
  return { sales: r?.sales ?? null, ads: r?.ads ?? null };
}

async function missingDays(profileId: string, from: string, to: string) {
  const [r] = await q<{ s: number | string; a: number | string }>(
    `select (select count(distinct date) from bk_sales_lines where profile_id = $1 and date between $2 and $3) s,
            (select count(distinct date) from bk_daily_ads where profile_id = $1 and date between $2 and $3) a`,
    [profileId, from, to]
  );
  const n = daysInRange(from, to);
  return { missingSalesDays: n - Number(r?.s ?? 0), missingAdDays: n - Number(r?.a ?? 0) };
}

/**
 * MoM / WoW (MTD vs PMTD, L7D vs P7D) in the same shape as the Amazon summary,
 * anchored on the last day that has BOTH sales and ads (or whichever exists).
 */
export async function momWow(a: { profileId: string; asOf?: string | undefined; category?: string | undefined }): Promise<SummaryResponse> {
  const latest = await latestDates(a.profileId);
  const autoAsOf = latest.sales && latest.ads ? (latest.sales < latest.ads ? latest.sales : latest.ads) : (latest.sales ?? latest.ads);
  const asOf = a.asOf ?? autoAsOf;
  const { d } = await scope(a.profileId, a.category);
  const base: SummaryResponse = {
    profileId: a.profileId,
    asOf: asOf ?? null,
    autoAsOf: autoAsOf ?? null,
    latest,
    category: a.category ?? null,
    categories: d.categories,
    periods: null,
    rows: [],
    notes: [],
  };
  if (!asOf) {
    base.notes.push('No Blinkit sales or ads data for this brand yet.');
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
  base.notes.push('Ratios are recomputed from each period\'s totals. Organic = Sales − Ad Sales (direct + indirect). Ad Spends = Estimated Budget Consumed.');
  return base;
}

/* --------------------------------------------------------------------- Geo */

/** Sales by customer state and city. Ads are deliberately absent (no city in Blinkit ad reports). */
export async function geo(a: RangeArgs): Promise<BkGeoResponse> {
  const { items } = await scope(a.profileId, a.category);
  const P = [a.profileId, a.from, a.to, ...(items ? [items] : [])];
  const f = inList('item_id', 4, items);
  const [states, cities] = await Promise.all([
    q(
      `select customer_state k, sum(revenue) rev, sum(quantity) units, count(distinct order_id) orders
       from bk_sales_lines where profile_id = $1 and date between $2 and $3 ${f} group by 1`,
      P
    ),
    q(
      `select customer_city k, max(customer_state) st, sum(revenue) rev, sum(quantity) units, count(distinct order_id) orders
       from bk_sales_lines where profile_id = $1 and date between $2 and $3 ${f} group by 1`,
      P
    ),
  ]);
  return {
    states: states.map((r) => ({ key: String(r.k || 'Unknown'), state: String(r.k || 'Unknown'), sums: salesRow(r) })),
    cities: cities.map((r) => ({ key: String(r.k || 'Unknown'), state: String(r.st || 'Unknown'), sums: salesRow(r) })),
  };
}
