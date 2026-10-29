import {
  normKey, resolveCampaignGeo, makeCategoryNormaliser, makeSkuNormaliser, type CampaignGeo,
} from '@dash/shared/blinkit';
import { q } from './queries';
import { bkConfig } from '../config';

export interface ItemDim { itemId: string; name: string; sku: string; category: string; mapped: boolean }
export interface CampaignDim {
  id: string; name: string; adType: string; category: string; sku: string; mapped: boolean; geo: CampaignGeo;
}
export interface Dims {
  items: Map<string, ItemDim>;
  campaigns: Map<string, CampaignDim>;
  categories: string[];
  skus: string[];
}

const cache = new Map<string, Promise<Dims>>();
export const invalidateDims = (profileId: string) => cache.delete(profileId);
export const getDims = (profileId: string) => {
  let p = cache.get(profileId);
  if (!p) { p = buildDims(profileId); cache.set(profileId, p); p.catch(() => cache.delete(profileId)); }
  return p;
};

const normCat = makeCategoryNormaliser(bkConfig.categoryAliases);
const normSku = makeSkuNormaliser(bkConfig.skuAliases);

async function buildDims(profileId: string): Promise<Dims> {
  type S = string;
  const [skuMapRows, nameRows, campMapRows, campRows] = await Promise.all([
    q<{ key: S; product_name: S; sku: S; category: S }>(`select key, product_name, sku, category from bk_sku_map where profile_id=$1`, [profileId]),
    q<{ item_id: S; name: S; n: number | S }>(
      `select item_id, product_name as name, count(*) n from bk_sales_lines where profile_id=$1 group by 1,2
       union all
       select item_id, item_name, count(*) from bk_inventory where profile_id=$1 group by 1,2`, [profileId]),
    q<{ source: S; key: S; campaign_id: S; campaign_name: S; category: S; sku: S; city: S }>(`select source, key, campaign_id, campaign_name, category, sku, city from bk_campaign_map where profile_id=$1 order by source`, [profileId]),
    q<{ campaign_id: S; ad_type: S; name: S; spend: number | S }>(
      `select campaign_id, ad_type, max(campaign_name) as name, sum(spend) spend
       from bk_daily_ads where profile_id=$1 group by 1,2`, [profileId]),
  ]);

  /* ---- items: Item ID match first, else any product name seen for that ID */
  const byKey = new Map<string, { sku: string; category: string }>();
  for (const r of skuMapRows) byKey.set(r.key, { sku: r.sku, category: r.category });
  const itemNames = new Map<string, { name: string; n: number }[]>();
  for (const r of nameRows) {
    const list = itemNames.get(r.item_id) ?? [];
    list.push({ name: r.name, n: Number(r.n) });
    itemNames.set(r.item_id, list);
  }
  const items = new Map<string, ItemDim>();
  for (const [itemId, list] of itemNames) {
    list.sort((a, b) => b.n - a.n);
    let hit = byKey.get(`id:${itemId}`);
    for (const { name } of list) { if (hit) break; hit = byKey.get(`name:${normKey(name)}`); }
    items.set(itemId, {
      itemId, name: list[0]?.name ?? itemId,
      sku: hit?.sku ? normSku(hit.sku) : list[0]?.name ?? itemId,
      category: hit?.category ? normCat(hit.category) : 'Unmapped',
      mapped: !!hit,
    });
  }

  /* ---- campaigns: merge every mapper source; ID match beats name match */
  const cm = new Map<string, { category: string; sku: string; city: string }>();
  for (const r of campMapRows) {
    const prev = cm.get(r.key) ?? { category: '', sku: '', city: '' };
    cm.set(r.key, { category: prev.category || r.category, sku: prev.sku || r.sku, city: prev.city || r.city });
  }
  const campaigns = new Map<string, CampaignDim>();
  for (const r of campRows) {
    const id = r.campaign_id as string;
    if (campaigns.has(id)) continue;
    const byId = cm.get(`id:${id}`), byName = cm.get(`name:${normKey(r.name)}`);
    const pick = (k: 'category' | 'sku' | 'city') => byId?.[k] || byName?.[k] || '';
    const category = pick('category');
    campaigns.set(id, {
      id, name: r.name, adType: r.ad_type,
      category: category ? normCat(category) : 'Unmapped',
      sku: pick('sku') ? normSku(pick('sku')) : '',
      mapped: !!(byId || byName),
      geo: resolveCampaignGeo(pick('city'), r.name),
    });
  }

  const categories = [...new Set([...[...items.values()].map((i) => i.category), ...[...campaigns.values()].map((c) => c.category)])].sort();
  const skus = [...new Set([...items.values()].map((i) => i.sku))].sort();
  return { items, campaigns, categories, skus };
}

/** Item IDs / campaign IDs belonging to a category (or all when cat is empty). */
export function itemsIn(d: Dims, category?: string) {
  return [...d.items.values()].filter((i) => !category || i.category === category).map((i) => i.itemId);
}
export function campaignsIn(d: Dims, category?: string) {
  return [...d.campaigns.values()].filter((c) => !category || c.category === category).map((c) => c.id);
}
