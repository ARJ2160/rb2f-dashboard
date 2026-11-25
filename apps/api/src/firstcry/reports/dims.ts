import { q } from '../../blinkit/reports/queries';
export const canonCat = (s: string): string => s.trim().toUpperCase() || 'UNMAPPED';
export interface SkuDim { sku: string; name: string; category: string; mapped: boolean }
export interface Dims { skus: Map<string, SkuDim>; categories: string[] }
const cache = new Map<string, Promise<Dims>>();
export const invalidateFcDims = (profileId: string) => cache.delete(profileId);
export const getFcDims = (profileId: string): Promise<Dims> => { let p = cache.get(profileId); if (!p) { p = build(profileId); cache.set(profileId, p); p.catch(() => cache.delete(profileId)); } return p; };
type S = string;
async function build(profileId: string): Promise<Dims> {
  const [skuRows, nameRows, catRows] = await Promise.all([
    q<{ sku: S; title: S; category: S }>(`select sku, title, category from fc_sku_map where profile_id=$1`, [profileId]),
    q<{ sku: S; name: S }>(`select sku, max(title) name from fc_daily_sku_sales where profile_id=$1 group by 1 union select sku, max(title) from fc_ad_product where profile_id=$1 group by 1`, [profileId]),
    q<{ category: S }>(`select distinct category from fc_ad_category where profile_id=$1`, [profileId]),
  ]);
  const skuMap = new Map<string, { category: string; name: string }>();
  for (const r of skuRows) skuMap.set(r.sku, { category: canonCat(r.category), name: r.title });
  const names = new Map<string, string>(); for (const r of nameRows) if (r.name) names.set(r.sku, r.name);
  const skus = new Map<string, SkuDim>();
  for (const id of new Set<string>([...skuMap.keys(), ...names.keys()])) { const m = skuMap.get(id); skus.set(id, { sku: id, name: m?.name || names.get(id) || id, category: m ? m.category : 'UNMAPPED', mapped: !!m }); }
  const categories = [...new Set([...[...skus.values()].map((s) => s.category), ...catRows.map((r) => canonCat(r.category))])].filter((c) => c && c !== 'UNMAPPED').sort();
  return { skus, categories };
}
