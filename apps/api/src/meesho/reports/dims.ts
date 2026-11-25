import { q } from '../../blinkit/reports/queries';
export const canonCat = (s: string): string => s.trim().toUpperCase() || 'UNMAPPED';
export interface SkuDim { sku: string; name: string; category: string; mapped: boolean }
export interface Dims { skus: Map<string, SkuDim>; categories: string[]; states: string[] }
const cache = new Map<string, Promise<Dims>>();
export const invalidateMeDims = (profileId: string) => cache.delete(profileId);
export const getMeDims = (profileId: string): Promise<Dims> => { let p = cache.get(profileId); if (!p) { p = build(profileId); cache.set(profileId, p); p.catch(() => cache.delete(profileId)); } return p; };
type S = string;
async function build(profileId: string): Promise<Dims> {
  const [skuRows, nameRows, stateRows] = await Promise.all([
    q<{ sku: S; title: S; category: S }>(`select sku, title, category from me_sku_map where profile_id=$1`, [profileId]),
    q<{ sku: S; name: S }>(`select sku, max(title) name from me_daily_sku_sales where profile_id=$1 group by 1`, [profileId]),
    q<{ state: S }>(`select distinct state from me_daily_sku_sales where profile_id=$1 and state <> ''`, [profileId]),
  ]);
  const skuMap = new Map<string, { category: string; name: string }>();
  for (const r of skuRows) skuMap.set(r.sku, { category: canonCat(r.category), name: r.title });
  const names = new Map<string, string>(); for (const r of nameRows) if (r.name) names.set(r.sku, r.name);
  const skus = new Map<string, SkuDim>();
  for (const id of new Set<string>([...skuMap.keys(), ...names.keys()])) { const m = skuMap.get(id); skus.set(id, { sku: id, name: m?.name || names.get(id) || id, category: m ? m.category : 'UNMAPPED', mapped: !!m }); }
  const categories = [...new Set([...skus.values()].map((s) => s.category))].filter((c) => c && c !== 'UNMAPPED').sort();
  return { skus, categories, states: stateRows.map((r) => r.state).sort() };
}
