import { normKey } from '@dash/shared/flipkart';

import { q } from '../../blinkit/reports/queries';

/** Flipkart dimensions: FSN → canonical category (FSN mapper) and campaign →
    category (campaign mapper, with the FSN-mapper category of its advertised
    FSNs as a fallback). Canonical categories are the mapper's own labels,
    upper-cased so casing variants fold. */

export const canonCat = (s: string): string => s.trim().toUpperCase() || 'UNMAPPED';

export interface FsnDim {
  fsn: string;
  name: string;
  category: string;
  mapped: boolean;
}
export interface CampaignDim {
  name: string;
  category: string;
  mapped: boolean;
}
export interface Dims {
  fsns: Map<string, FsnDim>;
  campaigns: Map<string, CampaignDim>; // normKey(name) → dim
  categories: string[];
}

const cache = new Map<string, Promise<Dims>>();
export const invalidateFkDims = (profileId: string) => cache.delete(profileId);
export const getFkDims = (profileId: string): Promise<Dims> => {
  let p = cache.get(profileId);
  if (!p) {
    p = build(profileId);
    cache.set(profileId, p);
    p.catch(() => cache.delete(profileId));
  }
  return p;
};

type S = string;

async function build(profileId: string): Promise<Dims> {
  const [fsnRows, nameRows, campMapRows, campRows, adFsnRows] = await Promise.all([
    q<{ fsn: S; title: S; category: S }>(`select fsn, title, category from fk_fsn_map where profile_id=$1`, [profileId]),
    q<{ fsn: S; name: S }>(
      `select fsn, max(title) name from fk_daily_fsn_sales where profile_id=$1 group by 1
       union
       select fsn, max(title) from fk_ad_fsn where profile_id=$1 group by 1`,
      [profileId]
    ),
    q<{ campaign_name: S; category: S }>(`select campaign_name, category from fk_campaign_map where profile_id=$1`, [profileId]),
    q<{ campaign_name: S }>(
      `select distinct campaign_name from (
         select campaign_name from fk_ad_campaign where profile_id=$1
         union select campaign_name from fk_ad_fsn where profile_id=$1
       ) x`,
      [profileId]
    ),
    q<{ campaign_name: S; fsn: S }>(`select distinct campaign_name, fsn from fk_ad_fsn where profile_id=$1`, [profileId]),
  ]);

  const fsnMap = new Map<string, { category: string; name: string }>();
  for (const r of fsnRows) fsnMap.set(r.fsn, { category: canonCat(r.category), name: r.title });
  const names = new Map<string, string>();
  for (const r of nameRows) if (r.name) names.set(r.fsn, r.name);

  const allFsns = new Set<string>([...fsnMap.keys(), ...names.keys()]);
  const fsns = new Map<string, FsnDim>();
  for (const id of allFsns) {
    const m = fsnMap.get(id);
    fsns.set(id, { fsn: id, name: m?.name || names.get(id) || id, category: m ? m.category : 'UNMAPPED', mapped: !!m });
  }

  const campCat = new Map<string, string>();
  for (const r of campMapRows) campCat.set(normKey(r.campaign_name), canonCat(r.category));
  const campFsnCats = new Map<string, Map<string, number>>();
  for (const r of adFsnRows) {
    const k = normKey(r.campaign_name);
    const cat = fsns.get(r.fsn)?.category;
    if (!cat || cat === 'UNMAPPED') continue;
    const m = campFsnCats.get(k) ?? new Map<string, number>();
    m.set(cat, (m.get(cat) ?? 0) + 1);
    campFsnCats.set(k, m);
  }
  const campaigns = new Map<string, CampaignDim>();
  for (const r of campRows) {
    const k = normKey(r.campaign_name);
    let category = campCat.get(k);
    const mapped = !!category;
    if (!category) {
      const m = campFsnCats.get(k);
      category = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0] : 'UNMAPPED';
    }
    campaigns.set(k, { name: r.campaign_name, category, mapped });
  }

  const categories = [...new Set([...[...fsns.values()].map((f) => f.category), ...[...campaigns.values()].map((c) => c.category)])]
    .filter((c) => c && c !== 'UNMAPPED')
    .sort();
  return { fsns, campaigns, categories };
}

export function fsnIdsIn(d: Dims, category?: string): string[] {
  const want = category ? canonCat(category) : '';
  return [...d.fsns.values()].filter((f) => !want || f.category === want).map((f) => f.fsn);
}
