import {
  addInto,
  blank,
  METRICS,
  metricValue,
  type BkKeywordsResponse,
  type BkKeywordRow,
  type MetricKey,
  type Sums,
} from '@dash/shared/blinkit';
import { getDims } from './dims';
import { ADS_SUMS, adsRow, q, inList } from './queries';
import type { RangeArgs } from './summary.service';

export interface KwArgs extends RangeArgs {
  /** one id, or a comma-separated list (multi-select) */
  campaignId?: string;
  /** geo unit key(s) from meta.geoUnits — selects campaigns that target EXACTLY that unit; comma-separated for multi-select */
  geo?: string;
  adType?: string; // PL | PR | BL — comma-separated for multi-select
  grain: 'kw' | 'kwc';
  search?: string;
  minImpr?: number;
  sort?: string;
  /** sort direction (default descending) */
  dir?: 'asc' | 'desc';
  limit?: number;
}

/** "a,b , c" → Set{a,b,c}; empty / undefined → null (no filter). */
function csvSet(v?: string): Set<string> | null {
  const s = new Set(
    (v ?? '')
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
  );
  return s.size ? s : null;
}

/** PL / BL rows are keyword-targeted; PR rows have no keyword, so they appear
    under their recommendation type, e.g. "[Reco] Similar Products Recommendation". */
export async function keywords(a: KwArgs): Promise<BkKeywordsResponse> {
  const d = await getDims(a.profileId);
  const campSet = csvSet(a.campaignId),
    geoSet = csvSet(a.geo),
    adSet = csvSet(a.adType);
  let camps: string[] | null = null;
  if (a.category || campSet || geoSet) {
    camps = [...d.campaigns.values()]
      .filter((c) => !a.category || c.category === a.category)
      .filter((c) => !campSet || campSet.has(c.id))
      .filter((c) => !geoSet || (c.geo.kind !== 'none' && geoSet.has(c.geo.key)))
      .map((c) => c.id);
  }
  const params: unknown[] = [a.profileId, a.from, a.to];
  let where = `profile_id=$1 and date between $2 and $3`;
  if (camps) {
    params.push(camps);
    where += inList('campaign_id', params.length, camps);
  }
  if (adSet) {
    const arr = [...adSet];
    params.push(arr);
    where += inList('ad_type', params.length, arr);
  }
  const kwExpr = `case when targeting_value <> '' then targeting_value else '[Reco] ' || targeting_type end`;
  const rows = await q(
    `select ${kwExpr} kw, campaign_id, ad_type, ${ADS_SUMS} from bk_daily_ads where ${where} group by 1,2,3`,
    params
  );

  const m = new Map<string, BkKeywordRow & { cats: Set<string>; cps: Set<string> }>();
  for (const r of rows) {
    const kw = String(r.kw);
    const c = d.campaigns.get(String(r.campaign_id));
    const key = a.grain === 'kwc' ? kw + '\u0001' + r.campaign_id : kw;
    let k = m.get(key);
    if (!k) {
      k = {
        keyword: kw,
        campaign: a.grain === 'kwc' ? (c?.name ?? String(r.campaign_id)) : null,
        adType: String(r.ad_type),
        campaigns: [],
        categories: [],
        sums: blank(),
        cats: new Set(),
        cps: new Set(),
      };
      m.set(key, k);
    }
    k.cats.add(c?.category ?? 'Unmapped');
    k.cps.add(c?.name ?? String(r.campaign_id));
    addInto(k.sums, adsRow(r));
  }
  let list = [...m.values()].map(({ cats, cps, ...k }) => ({
    ...k,
    categories: [...cats],
    campaigns: [...cps],
  }));
  if (a.search) {
    const s = a.search.toLowerCase();
    list = list.filter((k) => k.keyword.toLowerCase().includes(s));
  }
  if (a.minImpr) list = list.filter((k) => k.sums.impr >= a.minImpr!);
  const total = blank();
  for (const k of list) addInto(total, k.sums);
  sortRows(list, a.sort, a.dir);
  const limit = a.limit ?? 1000;
  return { rows: list.slice(0, limit), total, truncated: list.length > limit };
}

/** Sort rows by any metric (including derived ones such as ACoS / ROAS), in the
    given direction (default descending); rows with no value for the metric
    always sort last. Shared by the Blinkit and Instamart keyword services. */
export function sortRows<T extends { sums: Sums }>(list: T[], sort?: string, dir?: 'asc' | 'desc'): void {
  const sortKey = (sort && sort in METRICS ? sort : 'spend') as MetricKey;
  const mul = dir === 'asc' ? 1 : -1;
  const val = (s: Sums) => {
    const v = metricValue(sortKey, s);
    return Number.isFinite(v) ? v : null;
  };
  list.sort((x, y) => {
    const a = val(x.sums),
      b = val(y.sums);
    if (a == null && b == null) return 0;
    if (a == null) return 1;
    if (b == null) return -1;
    return (a - b) * mul;
  });
}
