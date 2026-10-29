import { addInto, blank, type BkKeywordsResponse, type BkKeywordRow, type Sums } from '@dash/shared/blinkit';
import { getDims } from './dims';
import { ADS_SUMS, adsRow, q, inList } from './queries';
import type { RangeArgs } from './summary.service';

export interface KwArgs extends RangeArgs {
  campaignId?: string;
  /** geo unit key from meta.geoUnits — selects campaigns that target EXACTLY that unit */
  geo?: string;
  adType?: string;           // PL | PR | BL
  grain: 'kw' | 'kwc';
  search?: string;
  minImpr?: number;
  sort?: string;
  limit?: number;
}

/** PL / BL rows are keyword-targeted; PR rows have no keyword, so they appear
    under their recommendation type, e.g. "[Reco] Similar Products Recommendation". */
export async function keywords(a: KwArgs): Promise<BkKeywordsResponse> {
  const d = await getDims(a.profileId);
  let camps: string[] | null = null;
  if (a.category || a.campaignId || a.geo) {
    camps = [...d.campaigns.values()]
      .filter((c) => !a.category || c.category === a.category)
      .filter((c) => !a.campaignId || c.id === a.campaignId)
      .filter((c) => !a.geo || (c.geo.kind !== 'none' && c.geo.key === a.geo))
      .map((c) => c.id);
  }
  const params: unknown[] = [a.profileId, a.from, a.to];
  let where = `profile_id=$1 and date between $2 and $3`;
  if (camps) { params.push(camps); where += inList('campaign_id', params.length, camps); }
  if (a.adType) { params.push(a.adType); where += ` and ad_type = $${params.length}`; }
  const kwExpr = `case when targeting_value <> '' then targeting_value else '[Reco] ' || targeting_type end`;
  const rows = await q(
    `select ${kwExpr} kw, campaign_id, ad_type, ${ADS_SUMS} from bk_daily_ads where ${where} group by 1,2,3`, params);

  const m = new Map<string, BkKeywordRow & { cats: Set<string>; cps: Set<string> }>();
  for (const r of rows) {
    const kw = String(r.kw);
    const c = d.campaigns.get(String(r.campaign_id));
    const key = a.grain === 'kwc' ? kw + '\u0001' + r.campaign_id : kw;
    let k = m.get(key);
    if (!k) {
      k = { keyword: kw, campaign: a.grain === 'kwc' ? c?.name ?? String(r.campaign_id) : null, adType: String(r.ad_type),
        campaigns: [], categories: [], sums: blank(), cats: new Set(), cps: new Set() };
      m.set(key, k);
    }
    k.cats.add(c?.category ?? 'Unmapped'); k.cps.add(c?.name ?? String(r.campaign_id));
    addInto(k.sums, adsRow(r));
  }
  let list = [...m.values()].map(({ cats, cps, ...k }) => ({ ...k, categories: [...cats], campaigns: [...cps] }));
  if (a.search) { const s = a.search.toLowerCase(); list = list.filter((k) => k.keyword.toLowerCase().includes(s)); }
  if (a.minImpr) list = list.filter((k) => k.sums.impr >= a.minImpr!);
  const total = blank();
  for (const k of list) addInto(total, k.sums);
  const sortKey = (a.sort ?? 'spend') as keyof Sums;
  list.sort((x, y) => (y.sums[sortKey] ?? 0) - (x.sums[sortKey] ?? 0));
  const limit = a.limit ?? 1000;
  return { rows: list.slice(0, limit), total, truncated: list.length > limit };
}
