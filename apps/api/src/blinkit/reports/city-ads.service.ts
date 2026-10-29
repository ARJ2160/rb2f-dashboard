import { addInto, blank, salesCityOf, type BkCityAdsResponse, type BkCityAdsRow } from '@dash/shared/blinkit';
import { getDims, itemsIn, campaignsIn } from './dims';
import { ADS_SUMS, adsRow, salesRow, q, inList } from './queries';
import type { RangeArgs } from './summary.service';

/* City-level ads under the exact-targeting rule.
   - kind 'city'  : campaign targets one city / a subset of one metro cluster
                    → its real spend is shown against those cities' revenue.
   - kind 'multi' : campaign's city list is known but spans several metros
                    → shown ONLY as a group row ("Hyderabad + Mumbai + Pune"),
                      never split into the member cities.
   - everything else (Top City, ROC, Pan-India, unknown) → not city-attributable,
     reported as one reconciling total.  */
export async function cityAds(a: RangeArgs & { includeGroups?: boolean }): Promise<BkCityAdsResponse> {
  const d = await getDims(a.profileId);
  const camps = a.category ? campaignsIn(d, a.category) : null;
  const items = a.category ? itemsIn(d, a.category) : null;
  const P = [a.profileId, a.from, a.to];
  const [ads, cities] = await Promise.all([
    q(`select campaign_id, ${ADS_SUMS} from bk_daily_ads
       where profile_id=$1 and date between $2 and $3 ${inList('campaign_id', 4, camps)} group by 1`,
      [...P, ...(camps ? [camps] : [])]),
    q(`select customer_city k, sum(revenue) rev, sum(quantity) units, count(distinct order_id) orders
       from bk_sales_lines where profile_id=$1 and date between $2 and $3 ${inList('item_id', 4, items)} group by 1`,
      [...P, ...(items ? [items] : [])]),
  ]);
  const cityRev = new Map(cities.map((r) => [String(r.k), salesRow(r)]));
  const units = new Map<string, BkCityAdsRow>();
  const notAttr = { spend: 0, asales: 0, impr: 0, campaigns: 0 };
  let totalSpend = 0;
  for (const r of ads) {
    const s = adsRow(r);
    totalSpend += s.spend;
    const c = d.campaigns.get(String(r.campaign_id));
    const g = c?.geo;
    if (!g || g.kind === 'none') {
      notAttr.spend += s.spend; notAttr.asales += s.asales; notAttr.impr += s.impr;
      if (s.spend > 0) notAttr.campaigns++;
      continue;
    }
    let u = units.get(g.key);
    if (!u) {
      u = { key: g.key, label: g.label, cities: g.cities, kind: g.kind, campaigns: [], sums: blank() };
      // Blinkit books Noida / Greater Noida orders as "Ghaziabad" — match sales on that name (once per sales city).
      for (const city of new Set(g.cities.map(salesCityOf))) { const cs = cityRev.get(city); if (cs) { u.sums.rev += cs.rev; u.sums.units += cs.units; u.sums.orders += cs.orders; } }
      units.set(g.key, u);
    }
    u.campaigns.push(c!.name);
    addInto(u.sums, { ...s, rev: 0, units: 0, orders: 0 });
  }
  const all = [...units.values()].sort((x, y) => y.sums.spend - x.sums.spend);
  return {
    rows: all.filter((u) => u.kind === 'city'),
    groups: all.filter((u) => u.kind === 'multi'),
    notAttributable: notAttr,
    totalSpend,
  };
}
