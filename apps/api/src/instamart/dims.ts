import { makeCategoryNormaliser, makeSkuNormaliser, normKey } from '@dash/shared/blinkit';

import { bkConfig } from '../blinkit/config';
import { q } from '../blinkit/reports/queries';

/* Instamart dimensions, rebuilt from the SKU mapper + what the reports contain.
   - Item Code (sales)          → SKU, Category (Item Code block of the mapper)
   - ad row (campaign × product) → SKU, Category:
       1. the product name the ads report writes, matched to the mapper's names;
       2. else the campaign name (the mapper lists campaign names too);
       3. else the longest mapper SKU / category name contained in the campaign name;
     when the product name is shared by two pack sizes (Dishwash 2L / 5L) and the
     campaign names one of them, the campaign's SKU wins.
   Cached per profile; dropped after every ingest. */

export interface ImItem { itemCode: string; name: string; sku: string; category: string; mapped: boolean }
export interface ImAdKey { key: string; campaignId: string; product: string; sku: string; category: string; how: 'product' | 'campaign' | 'name match' | 'unmapped' }
export interface ImCampaign { id: string; name: string; adType: string; sku: string; category: string; mapped: boolean; cities: number }
export interface ImDims {
  items: Map<string, ImItem>;
  adKeys: Map<string, ImAdKey>;
  campaigns: Map<string, ImCampaign>;
  categories: string[];
  skus: string[];
}

const normCat = makeCategoryNormaliser(bkConfig.categoryAliases);
const normSku = makeSkuNormaliser(bkConfig.skuAliases);

const cache = new Map<string, Promise<ImDims>>();
export const invalidateImDims = (profileId: string) => cache.delete(profileId);
export function getImDims(profileId: string) {
  let p = cache.get(profileId);
  if (!p) {
    p = build(profileId);
    cache.set(profileId, p);
    p.catch(() => cache.delete(profileId));
  }
  return p;
}

/** SQL expression for the ad-row dimension key (campaign × product). */
export const AD_KEY_SQL = `campaign_id || '|' || product_name`;

async function build(profileId: string): Promise<ImDims> {
  type S = string;
  const [map, itemRows, adRows, campRows] = await Promise.all([
    q<{ key: S; product_name: S; sku: S; category: S }>(`select key, product_name, sku, category from im_sku_map where profile_id=$1`, [profileId]),
    q<{ item_code: S; name: S }>(
      `select item_code, max(product_name) as name from im_sales where profile_id=$1 group by 1`, [profileId]),
    q<{ campaign_id: S; product_name: S }>(
      `select distinct campaign_id, product_name from im_ads where profile_id=$1`, [profileId]),
    q<{ campaign_id: S; name: S; ad_type: S; cities: number | S }>(
      `select campaign_id, max(campaign_name) as name, max(ad_type) ad_type, count(distinct city) cities
       from im_ads where profile_id=$1 group by 1`, [profileId]),
  ]);

  const byKey = new Map(map.map((r) => [r.key, r]));
  const fix = (r: { sku: string; category: string }) => ({ sku: normSku(r.sku), category: normCat(r.category || r.sku) });

  /* ---- items (sales) */
  const items = new Map<string, ImItem>();
  for (const r of itemRows) {
    const hit = byKey.get(`item:${r.item_code}`) ?? byKey.get(`name:${normKey(r.name)}`);
    items.set(r.item_code, hit
      ? { itemCode: r.item_code, name: r.name, ...fix(hit), mapped: true }
      : { itemCode: r.item_code, name: r.name, sku: r.name || r.item_code, category: 'Unmapped', mapped: false });
  }

  /* ---- name matchers for campaigns */
  const skuCat = new Map<string, string>();
  for (const r of map) if (r.sku && !skuCat.has(normKey(r.sku))) skuCat.set(normKey(r.sku), r.category || r.sku);
  const names = [...new Set(map.flatMap((r) => [r.sku, r.category]).filter(Boolean))]
    .map((n) => ({ n, k: normKey(n) }))
    .filter((x) => x.k.length >= 4)
    .sort((a, b) => b.k.length - a.k.length);
  const campaignSku = (name: string): { sku: string; category: string; how: ImAdKey['how'] } | null => {
    const hit = byKey.get(`name:${normKey(name)}`);
    if (hit) return { ...fix(hit), how: 'campaign' };
    const k = ` ${normKey(name)} `;
    const m = names.find((x) => k.includes(` ${x.k} `));
    if (!m) return null;
    const cat = skuCat.get(m.k) ?? m.n;
    return { sku: normSku(m.n), category: normCat(cat), how: 'name match' };
  };

  const campaigns = new Map<string, ImCampaign>();
  const campMatch = new Map<string, ReturnType<typeof campaignSku>>();
  for (const r of campRows) {
    const m = campaignSku(r.name);
    campMatch.set(r.campaign_id, m);
    campaigns.set(r.campaign_id, {
      id: r.campaign_id, name: r.name, adType: r.ad_type, sku: m?.sku ?? '', category: m?.category ?? 'Unmapped',
      mapped: !!m, cities: Number(r.cities),
    });
  }

  /* ---- ad keys (campaign × product) */
  const adKeys = new Map<string, ImAdKey>();
  for (const r of adRows) {
    const key = `${r.campaign_id}|${r.product_name}`;
    const prod = r.product_name ? byKey.get(`name:${normKey(r.product_name)}`) : undefined;
    const camp = campMatch.get(r.campaign_id) ?? null;
    let v: Omit<ImAdKey, 'key' | 'campaignId' | 'product'>;
    if (prod) {
      const p = fix(prod);
      // Same product name for several pack sizes: trust the campaign's SKU when it is in the same category.
      v = camp && camp.category === p.category && camp.sku !== p.sku ? { sku: camp.sku, category: camp.category, how: 'product' } : { ...p, how: 'product' };
    } else if (camp) v = { sku: camp.sku, category: camp.category, how: camp.how };
    else v = { sku: '', category: 'Unmapped', how: 'unmapped' };
    adKeys.set(key, { key, campaignId: r.campaign_id, product: r.product_name, ...v });
  }

  const categories = [...new Set([...[...items.values()].map((i) => i.category), ...[...adKeys.values()].map((a) => a.category)])].sort();
  const skus = [...new Set([...[...items.values()].map((i) => i.sku), ...[...adKeys.values()].map((a) => a.sku).filter(Boolean)])].sort();
  return { items, adKeys, campaigns, categories, skus };
}

export const itemsIn = (d: ImDims, category?: string) =>
  [...d.items.values()].filter((i) => !category || i.category === category).map((i) => i.itemCode);
export const adKeysIn = (d: ImDims, category?: string) =>
  [...d.adKeys.values()].filter((a) => !category || a.category === category).map((a) => a.key);
