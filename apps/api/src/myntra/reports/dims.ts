import { normKey } from '@dash/shared/myntra';

import { q } from '../../blinkit/reports/queries';

export const canonCat = (s: string): string => s.trim().toUpperCase() || 'UNMAPPED';

export interface StyleDim { style: string; name: string; category: string; mapped: boolean }
export interface CampaignDim { name: string; category: string; mapped: boolean }
export interface Dims { styles: Map<string, StyleDim>; campaigns: Map<string, CampaignDim>; categories: string[]; states: string[] }

const cache = new Map<string, Promise<Dims>>();
export const invalidateMyDims = (profileId: string) => cache.delete(profileId);
export const getMyDims = (profileId: string): Promise<Dims> => {
  let p = cache.get(profileId);
  if (!p) { p = build(profileId); cache.set(profileId, p); p.catch(() => cache.delete(profileId)); }
  return p;
};

type S = string;
async function build(profileId: string): Promise<Dims> {
  const [styleRows, nameRows, campMapRows, campRows, adStyleRows, stateRows] = await Promise.all([
    q<{ style_id: S; title: S; category: S }>(`select style_id, title, category from my_style_map where profile_id=$1`, [profileId]),
    q<{ style_id: S; name: S }>(`select style_id, max(title) name from my_daily_style_sales where profile_id=$1 group by 1 union select style_id, max(title) from my_ad_product where profile_id=$1 group by 1`, [profileId]),
    q<{ campaign_name: S; category: S }>(`select campaign_name, category from my_campaign_map where profile_id=$1`, [profileId]),
    q<{ campaign_name: S }>(`select distinct campaign_name from (select campaign_name from my_ad_campaign where profile_id=$1 union select campaign_name from my_ad_product where profile_id=$1) x`, [profileId]),
    q<{ campaign_name: S; style_id: S }>(`select distinct campaign_name, style_id from my_ad_product where profile_id=$1`, [profileId]),
    q<{ state: S }>(`select distinct state from my_daily_style_sales where profile_id=$1 and state <> ''`, [profileId]),
  ]);
  const styleMap = new Map<string, { category: string; name: string }>();
  for (const r of styleRows) styleMap.set(r.style_id, { category: canonCat(r.category), name: r.title });
  const names = new Map<string, string>();
  for (const r of nameRows) if (r.name) names.set(r.style_id, r.name);
  const styles = new Map<string, StyleDim>();
  for (const id of new Set<string>([...styleMap.keys(), ...names.keys()])) {
    const m = styleMap.get(id);
    styles.set(id, { style: id, name: m?.name || names.get(id) || id, category: m ? m.category : 'UNMAPPED', mapped: !!m });
  }
  const campCat = new Map<string, string>();
  for (const r of campMapRows) campCat.set(normKey(r.campaign_name), canonCat(r.category));
  const campStyleCats = new Map<string, Map<string, number>>();
  for (const r of adStyleRows) { const k = normKey(r.campaign_name); const cat = styles.get(r.style_id)?.category; if (!cat || cat === 'UNMAPPED') continue; const m = campStyleCats.get(k) ?? new Map(); m.set(cat, (m.get(cat) ?? 0) + 1); campStyleCats.set(k, m); }
  const campaigns = new Map<string, CampaignDim>();
  for (const r of campRows) { const k = normKey(r.campaign_name); let category = campCat.get(k); const mapped = !!category; if (!category) { const m = campStyleCats.get(k); category = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0] : 'UNMAPPED'; } campaigns.set(k, { name: r.campaign_name, category, mapped }); }
  const categories = [...new Set([...[...styles.values()].map((s) => s.category), ...[...campaigns.values()].map((c) => c.category)])].filter((c) => c && c !== 'UNMAPPED').sort();
  return { styles, campaigns, categories, states: stateRows.map((r) => r.state).sort() };
}
