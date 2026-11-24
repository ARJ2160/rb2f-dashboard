import {
  addInto,
  blank,
  normKey,
  stateOfCity,
  zpCity,
  type Sums,
  type ZpAsinResponse,
  type ZpCampaignsResponse,
  type ZpCatAdvResponse,
  type ZpChannel,
  type ZpDailyResponse,
  type ZpDurResponse,
  type ZpGeoResponse,
  type ZpGroupsResponse,
  type ZpInventoryResponse,
  type ZpKeywordsResponse,
  type ZpMetaResponse,
} from '@dash/shared/zepto';

import { sortRows } from '../blinkit/reports/keywords.service';
import { inList, q } from '../blinkit/reports/queries';
import { canonCat, getZpDims } from './reports/dims';

/* Zepto reports. Sales/units come from zp_sales (per-day); ad metrics from the
   period-level zp_ad_* tables (a period is included when it falls within the
   dashboard date range, since a period total can't be split onto days). */

export interface RangeArgs {
  profileId: string;
  from: string;
  to: string;
  category?: string | undefined;
  channel?: string | undefined; // csv of sp|sb|sd
}

const CHANNELS: ZpChannel[] = ['sp', 'sb', 'sd'];
const csv = (v?: string): string[] | null => {
  const s = (v ?? '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
  return s.length ? s : null;
};

// ── Sums mappers ─────────────────────────────────────────────────────

const ZP_AD_SUMS = `sum(impressions) impr, sum(atc) atc, sum(aunits) aunits,
  sum(asales) asales, sum(same_skus) dsales, sum(spend) spend, sum(clicks) clicks`;
type Raw = Record<string, unknown>;
function adsRow(r: Raw): Sums {
  const a = blank();
  a.impr = Number(r.impr ?? 0);
  a.atc = Number(r.atc ?? 0);
  a.aunits = Number(r.aunits ?? 0);
  a.asales = Number(r.asales ?? 0);
  a.dsales = Number(r.dsales ?? 0);
  a.spend = Number(r.spend ?? 0);
  a.clicks = Number(r.clicks ?? 0);
  return a;
}
function salesRow(r: Raw): Sums {
  const a = blank();
  a.rev = Number(r.rev ?? 0);
  a.units = Number(r.units ?? 0);
  return a;
}
const getOrBlank = (m: Map<string, Sums>, k: string) => {
  let s = m.get(k);
  if (!s) m.set(k, (s = blank()));
  return s;
};

// ── where-clause builders ────────────────────────────────────────────

/** sales rows in [from,to], optional canonical category (joined via zp_sku_map). */
function salesWhere(a: RangeArgs, params: unknown[]): string {
  params.push(a.profileId, a.from, a.to);
  let w = `s.profile_id=$1 and s.date between $2 and $3`;
  const cat = a.category ? canonCat(a.category) : null;
  if (cat) {
    params.push(cat);
    w += ` and upper(coalesce(m.category,'UNMAPPED')) = $${params.length}`;
  }
  return w;
}

/** ad rows whose export window falls within [from,to], optional channel + category (via product→sku_map). */
function adWhere(a: RangeArgs, params: unknown[], hasCategory: boolean): string {
  params.push(a.profileId, a.from, a.to);
  let w = `ap.profile_id=$1 and ap.period_from >= $2 and ap.period_to <= $3`;
  const ch = csv(a.channel);
  if (ch) {
    params.push(ch);
    w += inList('ap.channel', params.length, ch);
  }
  if (hasCategory && a.category) {
    params.push(canonCat(a.category));
    w += ` and upper(coalesce(m.category,'UNMAPPED')) = $${params.length}`;
  }
  return w;
}

// ── Meta ─────────────────────────────────────────────────────────────

export async function meta(profileId: string): Promise<ZpMetaResponse> {
  const d = await getZpDims(profileId);
  const [[salesAgg], snaps, periods, unmappedSku, unmappedCamp] = await Promise.all([
    q<{ f: string; t: string; n: string }>(
      `select min(date) f, max(date) t, count(*) n from zp_sales where profile_id=$1`,
      [profileId]
    ),
    q<{ s: string }>(`select distinct snapshot_date s from zp_inventory where profile_id=$1 order by 1 desc`, [
      profileId,
    ]),
    q<{ channel: string; f: string; t: string; n: string }>(
      `select channel, period_from f, period_to t, count(*) n from (
         select channel,period_from,period_to from zp_ad_campaign where profile_id=$1
         union all select channel,period_from,period_to from zp_ad_keyword where profile_id=$1
         union all select channel,period_from,period_to from zp_ad_product where profile_id=$1
       ) x group by 1,2,3 order by 2`,
      [profileId]
    ),
    q<{ sku_id: string; name: string; gmv: string }>(
      `select sku_id, max(sku_name) name, sum(gmv) gmv from zp_sales s where profile_id=$1
         and not exists (select 1 from zp_sku_map m where m.profile_id=s.profile_id and m.sku_id=s.sku_id)
       group by 1 order by 3 desc limit 50`,
      [profileId]
    ),
    q<{ channel: string; name: string; spend: string }>(
      `select channel, campaign_name name, sum(spend) spend from zp_ad_campaign c where profile_id=$1
         and not exists (select 1 from zp_campaign_map m where m.profile_id=c.profile_id and m.campaign_name=c.campaign_name)
       group by 1,2 order by 3 desc`,
      [profileId]
    ),
  ]);

  const notes: string[] = [];
  if (periods.length)
    notes.push(
      'Ad reports have no per-row date; they are stored against the export window and shown when that window falls inside the selected range.'
    );
  return {
    profileId,
    sales: { from: salesAgg?.f ?? null, to: salesAgg?.t ?? null, rows: Number(salesAgg?.n ?? 0) },
    ads: {
      periods: periods.map((p) => ({ channel: p.channel as ZpChannel, from: p.f, to: p.t, rows: Number(p.n) })),
    },
    inventory: { snapshots: snaps.map((r) => r.s) },
    categories: d.categories,
    channels: CHANNELS,
    cities: d.cities.map(zpCity),
    campaigns: [...d.campaigns.values()].map((c) => ({
      name: c.name,
      channel: c.channel,
      category: c.category,
      campaignType: c.campaignType,
    })),
    unmappedSkus: unmappedSku.map((r) => ({ skuId: r.sku_id, name: r.name, gmv: Number(r.gmv) })),
    unmappedCampaigns: unmappedCamp.map((r) => ({
      name: r.name,
      channel: r.channel as ZpChannel,
      spend: Number(r.spend),
    })),
    notes,
  };
}

// ── Category / SKU groups (sales + ads combined) ─────────────────────

export async function groups(a: RangeArgs, groupBy: 'category' | 'sku'): Promise<ZpGroupsResponse> {
  const d = await getZpDims(a.profileId);
  const byCat = groupBy === 'category';
  const sp: unknown[] = [];
  const salesSql = byCat
    ? `select upper(coalesce(m.category,'UNMAPPED')) k, sum(s.gmv) rev, sum(s.units) units
       from zp_sales s left join zp_sku_map m on m.profile_id=s.profile_id and m.sku_id=s.sku_id
       where ${salesWhere(a, sp)} group by 1`
    : `select s.sku_id k, sum(s.gmv) rev, sum(s.units) units
       from zp_sales s left join zp_sku_map m on m.profile_id=s.profile_id and m.sku_id=s.sku_id
       where ${salesWhere(a, sp)} group by 1`;
  const ap: unknown[] = [];
  const adSql = byCat
    ? `select upper(coalesce(m.category,'UNMAPPED')) k, ${ZP_AD_SUMS}
       from zp_ad_product ap left join zp_sku_map m on m.profile_id=ap.profile_id and m.sku_id=ap.product_id
       where ${adWhere(a, ap, true)} group by 1`
    : `select ap.product_id k, ${ZP_AD_SUMS}
       from zp_ad_product ap left join zp_sku_map m on m.profile_id=ap.profile_id and m.sku_id=ap.product_id
       where ${adWhere(a, ap, true)} group by 1`;

  const [salesRows, adRows] = await Promise.all([q<Raw>(salesSql, sp), q<Raw>(adSql, ap)]);
  const map = new Map<string, Sums>();
  for (const r of salesRows) addInto(getOrBlank(map, String(r.k)), salesRow(r));
  for (const r of adRows) addInto(getOrBlank(map, String(r.k)), adsRow(r));

  const total = blank();
  const groupsOut = [...map.entries()].map(([k, sums]) => {
    addInto(total, sums);
    const key = byCat ? k : d.skus.get(k)?.name || k;
    return { key, sums };
  });
  groupsOut.sort((x, y) => y.sums.rev - x.sums.rev || y.sums.asales - x.sums.asales);
  const days = dayCount(a.from, a.to);
  return { from: a.from, to: a.to, days, total, groups: groupsOut };
}

// ── DSR (daily sales; period-level ads summarised for the range) ─────

export async function daily(a: RangeArgs): Promise<ZpDailyResponse> {
  const sp: unknown[] = [];
  const dailyRows = await q<{ d: string; rev: string; units: string }>(
    `select s.date d, sum(s.gmv) rev, sum(s.units) units
     from zp_sales s left join zp_sku_map m on m.profile_id=s.profile_id and m.sku_id=s.sku_id
     where ${salesWhere(a, sp)} group by 1 order by 1`,
    sp
  );
  const ap: unknown[] = [];
  const chanRows = await q<{ channel: string; spend: string; asales: string; impr: string; clicks: string }>(
    `select ap.channel, sum(ap.spend) spend, sum(ap.asales) asales, sum(ap.impressions) impr, sum(ap.clicks) clicks
     from zp_ad_product ap left join zp_sku_map m on m.profile_id=ap.profile_id and m.sku_id=ap.product_id
     where ${adWhere(a, ap, true)} group by 1`,
    ap
  );
  const dates = dailyRows.map((r) => r.d);
  const series = dailyRows.map((r) => {
    const s = blank();
    s.rev = Number(r.rev);
    s.units = Number(r.units);
    return s;
  });
  const total = blank();
  for (const s of series) addInto(total, s);
  for (const r of chanRows) {
    total.spend += Number(r.spend);
    total.asales += Number(r.asales);
    total.impr += Number(r.impr);
    total.clicks += Number(r.clicks);
  }
  return {
    from: a.from,
    to: a.to,
    dates,
    series,
    total,
    byChannel: chanRows.map((r) => ({
      channel: r.channel as ZpChannel,
      spend: Number(r.spend),
      asales: Number(r.asales),
      impr: Number(r.impr),
      clicks: Number(r.clicks),
    })),
    notes: chanRows.length
      ? ['Ad metrics are period totals for the export window(s) within this range, not per-day.']
      : [],
  };
}

// ── DUR (per-SKU per-day) ────────────────────────────────────────────

export async function dur(a: RangeArgs, metric: 'units' | 'rev'): Promise<ZpDurResponse> {
  const d = await getZpDims(a.profileId);
  const sp: unknown[] = [];
  const rows = await q<{ sku_id: string; d: string; v: string }>(
    `select s.sku_id, s.date d, sum(s.${metric === 'rev' ? 'gmv' : 'units'}) v
     from zp_sales s left join zp_sku_map m on m.profile_id=s.profile_id and m.sku_id=s.sku_id
     where ${salesWhere(a, sp)} group by 1,2`,
    sp
  );
  const dates = [...new Set(rows.map((r) => r.d))].sort();
  const dateIdx = new Map(dates.map((x, i) => [x, i]));
  const bySku = new Map<string, number[]>();
  for (const r of rows) {
    const arr = bySku.get(r.sku_id) ?? new Array(dates.length).fill(0);
    arr[dateIdx.get(r.d)!] += Number(r.v);
    bySku.set(r.sku_id, arr);
  }
  const out = [...bySku.entries()].map(([skuId, values]) => {
    const dim = d.skus.get(skuId);
    return {
      skuId,
      name: dim?.name || skuId,
      category: dim?.category || 'UNMAPPED',
      values,
      total: values.reduce((x, y) => x + y, 0),
    };
  });
  out.sort((x, y) => y.total - x.total);
  return { dates, metric, rows: out };
}

// ── Geo (city-level, with best-effort state) ─────────────────────────

export async function geo(a: RangeArgs): Promise<ZpGeoResponse> {
  const sp: unknown[] = [];
  const rows = await q<{ city: string; rev: string; units: string }>(
    `select s.city, sum(s.gmv) rev, sum(s.units) units
     from zp_sales s left join zp_sku_map m on m.profile_id=s.profile_id and m.sku_id=s.sku_id
     where ${salesWhere(a, sp)} group by 1`,
    sp
  );
  const cityMap = new Map<string, { state: string; sums: Sums }>();
  const stateMap = new Map<string, Sums>();
  for (const r of rows) {
    const city = zpCity(r.city);
    const state = stateOfCity(r.city);
    const s = salesRow(r);
    const cur = cityMap.get(city) ?? { state, sums: blank() };
    addInto(cur.sums, s);
    cityMap.set(city, cur);
    addInto(getOrBlank(stateMap, state), s);
  }
  return {
    cities: [...cityMap.entries()].map(([key, v]) => ({ key, state: v.state, sums: v.sums })),
    states: [...stateMap.entries()].map(([key, sums]) => ({ key, state: key, sums })),
  };
}

// ── Keywords (search terms) ──────────────────────────────────────────

export interface KwArgs extends RangeArgs {
  grain: 'kw' | 'kwc';
  search?: string | undefined;
  sort?: string | undefined;
  dir?: 'asc' | 'desc' | undefined;
  limit?: number | undefined;
}
export async function keywords(a: KwArgs): Promise<ZpKeywordsResponse> {
  const d = await getZpDims(a.profileId);
  const p: unknown[] = [a.profileId, a.from, a.to];
  let w = `profile_id=$1 and period_from >= $2 and period_to <= $3`;
  const ch = csv(a.channel);
  if (ch) {
    p.push(ch);
    w += inList('channel', p.length, ch);
  }
  const rows = await q<Raw>(
    `select keyword, match_type, channel, campaign_name, ${ZP_AD_SUMS}
     from zp_ad_keyword where ${w} group by 1,2,3,4`,
    p
  );
  const by = new Map<
    string,
    { keyword: string; matchType: string; channel: ZpChannel; campaigns: Set<string>; cats: Set<string>; sums: Sums }
  >();
  for (const r of rows) {
    const keyword = String(r.keyword);
    const campaign = String(r.campaign_name ?? '');
    const key = a.grain === 'kwc' ? `${keyword}\u0001${campaign}` : keyword;
    let k = by.get(key);
    if (!k)
      by.set(
        key,
        (k = {
          keyword,
          matchType: String(r.match_type ?? ''),
          channel: String(r.channel) as ZpChannel,
          campaigns: new Set(),
          cats: new Set(),
          sums: blank(),
        })
      );
    if (campaign) k.campaigns.add(campaign);
    k.cats.add(d.campaigns.get(normKey(campaign))?.category ?? 'UNMAPPED');
    addInto(k.sums, adsRow(r));
  }
  let list = [...by.values()].map((k) => ({
    keyword: k.keyword,
    matchType: k.matchType,
    channel: k.channel,
    campaign: a.grain === 'kwc' ? ([...k.campaigns][0] ?? null) : null,
    campaigns: [...k.campaigns],
    category: [...k.cats][0] ?? 'UNMAPPED',
    sums: k.sums,
  }));
  if (a.search) {
    const s = a.search.toLowerCase();
    list = list.filter((k) => k.keyword.toLowerCase().includes(s));
  }
  const total = blank();
  for (const k of list) addInto(total, k.sums);
  sortRows(list, a.sort, a.dir);
  const limit = a.limit ?? 1000;
  return { rows: list.slice(0, limit), total, truncated: list.length > limit };
}

// ── Category-advertised ──────────────────────────────────────────────

export async function categoryAdvertised(a: RangeArgs): Promise<ZpCatAdvResponse> {
  const ap: unknown[] = [];
  const rows = await q<Raw>(
    `select upper(coalesce(m.category,'UNMAPPED')) cat, ${ZP_AD_SUMS}
     from zp_ad_product ap left join zp_sku_map m on m.profile_id=ap.profile_id and m.sku_id=ap.product_id
     where ${adWhere(a, ap, false)} group by 1`,
    ap
  );
  const total = blank();
  const out = rows.map((r) => {
    const sums = adsRow(r);
    addInto(total, sums);
    return { category: String(r.cat), sums };
  });
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}

// ── ASIN / SKU-level (ads compiled from product reports + revenue from sales) ──

export interface AsinArgs extends RangeArgs {
  sort?: string | undefined;
  dir?: 'asc' | 'desc' | undefined;
  limit?: number | undefined;
}
export async function asinLevel(a: AsinArgs): Promise<ZpAsinResponse> {
  const d = await getZpDims(a.profileId);
  const sp: unknown[] = [];
  const salesRows = await q<{ sku_id: string; rev: string; units: string }>(
    `select s.sku_id, sum(s.gmv) rev, sum(s.units) units
     from zp_sales s left join zp_sku_map m on m.profile_id=s.profile_id and m.sku_id=s.sku_id
     where ${salesWhere(a, sp)} group by 1`,
    sp
  );
  const ap: unknown[] = [];
  const adRows = await q<Raw & { sku_id: string; channels: string[] }>(
    `select ap.product_id sku_id, array_agg(distinct ap.channel) channels, ${ZP_AD_SUMS}
     from zp_ad_product ap left join zp_sku_map m on m.profile_id=ap.profile_id and m.sku_id=ap.product_id
     where ${adWhere(a, ap, true)} group by 1`,
    ap
  );
  const map = new Map<string, { sums: Sums; channels: Set<string> }>();
  const ensure = (id: string) => {
    let v = map.get(id);
    if (!v) map.set(id, (v = { sums: blank(), channels: new Set() }));
    return v;
  };
  for (const r of salesRows) addInto(ensure(r.sku_id).sums, salesRow(r));
  for (const r of adRows) {
    const v = ensure(r.sku_id);
    addInto(v.sums, adsRow(r));
    for (const c of r.channels ?? []) v.channels.add(c);
  }
  let rows = [...map.entries()].map(([skuId, v]) => {
    const dim = d.skus.get(skuId);
    return {
      skuId,
      name: dim?.name || skuId,
      category: dim?.category || 'UNMAPPED',
      channels: [...v.channels] as ZpChannel[],
      sums: v.sums,
    };
  });
  const total = blank();
  for (const r of rows) addInto(total, r.sums);
  sortRows(rows, a.sort, a.dir);
  const limit = a.limit ?? 2000;
  const truncated = rows.length > limit;
  rows = rows.slice(0, limit);
  return { rows, total, truncated };
}

// ── Ads analysis (campaigns) ─────────────────────────────────────────

export async function campaigns(a: RangeArgs): Promise<ZpCampaignsResponse> {
  const d = await getZpDims(a.profileId);
  const p: unknown[] = [a.profileId, a.from, a.to];
  let w = `profile_id=$1 and period_from >= $2 and period_to <= $3`;
  const ch = csv(a.channel);
  if (ch) {
    p.push(ch);
    w += inList('channel', p.length, ch);
  }
  const rows = await q<Raw>(
    `select campaign_name, channel, max(campaign_type) campaign_type, max(status) status,
       ${ZP_AD_SUMS}
     from zp_ad_campaign where ${w} group by 1,2`,
    p
  );
  const wantCat = a.category ? canonCat(a.category) : null;
  const total = blank();
  let out = rows.map((r) => {
    const dim = d.campaigns.get(normKey(String(r.campaign_name)));
    const sums = adsRow(r);
    return {
      name: String(r.campaign_name),
      channel: String(r.channel) as ZpChannel,
      category: dim?.category ?? 'UNMAPPED',
      campaignType: String(r.campaign_type ?? ''),
      status: String(r.status ?? ''),
      sums,
    };
  });
  if (wantCat) out = out.filter((r) => r.category === wantCat);
  for (const r of out) addInto(total, r.sums);
  out.sort((x, y) => y.sums.spend - x.sums.spend);
  return { rows: out, total };
}

// ── Inventory (stock + days of cover from sales run rate) ────────────

export async function inventory(a: {
  profileId: string;
  snapshot?: string | undefined;
  category?: string | undefined;
}): Promise<ZpInventoryResponse> {
  const d = await getZpDims(a.profileId);
  const snaps = await q<{ s: string }>(
    `select distinct snapshot_date s from zp_inventory where profile_id=$1 order by 1 desc`,
    [a.profileId]
  );
  const snapshot = a.snapshot ?? snaps[0]?.s ?? null;
  if (!snapshot) return { snapshot: null, snapshots: [], rows: [], cities: [] };

  const invRows = await q<{ sku_code: string; name: string; city: string; units: string }>(
    `select sku_code, max(sku_name) name, city, sum(units) units
     from zp_inventory where profile_id=$1 and snapshot_date=$2 group by sku_code, city`,
    [a.profileId, snapshot]
  );
  // run rate: units over the last 7 data-days of sales
  const last7 = await q<{ sku_id: string; u: string }>(
    `with d as (select distinct date from zp_sales where profile_id=$1 order by date desc limit 7)
     select sku_id, sum(units) u from zp_sales
     where profile_id=$1 and date in (select date from d) group by 1`,
    [a.profileId]
  );
  const drrOf = new Map<string, number>();
  for (const r of last7) drrOf.set(r.sku_id, Number(r.u) / 7);

  const wantCat = a.category ? canonCat(a.category) : null;
  const cities = new Set<string>();
  // roll up per SKU across cities
  const bySku = new Map<string, { name: string; units: number }>();
  for (const r of invRows) {
    cities.add(zpCity(r.city));
    const cur = bySku.get(r.sku_code) ?? { name: r.name, units: 0 };
    cur.units += Number(r.units);
    bySku.set(r.sku_code, cur);
  }
  const rows = [...bySku.entries()]
    .map(([skuCode, v]) => {
      const dim = d.skus.get(skuCode);
      const category = dim?.category || 'UNMAPPED';
      const drr = drrOf.get(skuCode) ?? null;
      const doc = drr && drr > 0 ? v.units / drr : null;
      const status =
        v.units === 0
          ? 'Stock-out'
          : doc == null
            ? 'No sales L7D'
            : doc < 7
              ? 'Critical'
              : doc < 15
                ? 'Low'
                : doc > 45
                  ? 'Excess'
                  : 'Healthy';
      return { skuCode, skuName: dim?.name || v.name, category, city: '', units: v.units, drr, doc, status };
    })
    .filter((r) => !wantCat || r.category === wantCat);
  rows.sort((x, y) => (x.doc ?? Infinity) - (y.doc ?? Infinity));
  return { snapshot, snapshots: snaps.map((r) => r.s), rows, cities: [...cities].sort() };
}

// ── helpers ──────────────────────────────────────────────────────────

const dayCount = (from: string, to: string) =>
  Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
