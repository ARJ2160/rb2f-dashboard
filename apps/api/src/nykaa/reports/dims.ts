import { normKey } from '@dash/shared/nykaa';
import { q } from '../../blinkit/reports/queries';
export const canonCat = (s: string): string => s.trim().toUpperCase() || 'UNMAPPED';
export interface SkuDim { sku: string; name: string; category: string; mapped: boolean }
export interface CampaignDim { name: string; category: string; mapped: boolean }
export interface Dims { skus: Map<string, SkuDim>; campaigns: Map<string, CampaignDim>; categories: string[] }
const cache = new Map<string, Promise<Dims>>();
export const invalidateNkDims = (profileId: string) => cache.delete(profileId);
export const getNkDims = (profileId: string): Promise<Dims> => { let p = cache.get(profileId); if (!p) { p = build(profileId); cache.set(profileId, p); p.catch(() => cache.delete(profileId)); } return p; };
type S = string;
async function build(profileId: string): Promise<Dims> {
  const [skuRows, nameRows, campMapRows, campRows, adSkuRows] = await Promise.all([
    q<{ sku: S; title: S; category: S }>(`select sku, title, category from nk_sku_map where profile_id=$1`, [profileId]),
    q<{ sku: S; name: S }>(`select sku, max(title) name from nk_daily_sku_sales where profile_id=$1 group by 1 union select sku, max(title) from nk_ad_sku where profile_id=$1 group by 1`, [profileId]),
    q<{ campaign_name: S; category: S }>(`select campaign_name, category from nk_campaign_map where profile_id=$1`, [profileId]),
    q<{ campaign_name: S }>(`select distinct campaign_name from (select campaign_name from nk_ad_campaign where profile_id=$1 union select campaign_name from nk_ad_sku where profile_id=$1) x`, [profileId]),
    q<{ campaign_name: S; sku: S }>(`select distinct campaign_name, sku from nk_ad_sku where profile_id=$1`, [profileId]),
  ]);
  const skuMap = new Map<string, { category: string; name: string }>();
  for (const r of skuRows) skuMap.set(r.sku, { category: canonCat(r.category), name: r.title });
  const names = new Map<string, string>(); for (const r of nameRows) if (r.name) names.set(r.sku, r.name);
  const skus = new Map<string, SkuDim>();
  for (const id of new Set<string>([...skuMap.keys(), ...names.keys()])) { const m = skuMap.get(id); skus.set(id, { sku: id, name: m?.name || names.get(id) || id, category: m ? m.category : 'UNMAPPED', mapped: !!m }); }
  const campCat = new Map<string, string>(); for (const r of campMapRows) campCat.set(normKey(r.campaign_name), canonCat(r.category));
  const campSkuCats = new Map<string, Map<string, number>>();
  for (const r of adSkuRows) { const k = normKey(r.campaign_name); const cat = skus.get(r.sku)?.category; if (!cat || cat === 'UNMAPPED') continue; const m = campSkuCats.get(k) ?? new Map(); m.set(cat, (m.get(cat) ?? 0) + 1); campSkuCats.set(k, m); }
  const campaigns = new Map<string, CampaignDim>();
  for (const r of campRows) { const k = normKey(r.campaign_name); let category = campCat.get(k); const mapped = !!category; if (!category) { const m = campSkuCats.get(k); category = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0] : 'UNMAPPED'; } campaigns.set(k, { name: r.campaign_name, category, mapped }); }
  const categories = [...new Set([...[...skus.values()].map((s) => s.category), ...[...campaigns.values()].map((c) => c.category)])].filter((c) => c && c !== 'UNMAPPED').sort();
  return { skus, campaigns, categories };
}
