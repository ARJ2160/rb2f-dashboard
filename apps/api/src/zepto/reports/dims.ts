import { normKey, type ZpChannel } from '@dash/shared/zepto';

import { q } from '../../blinkit/reports/queries';

/** Zepto dimensions: SKU → canonical category (SKU mapper) and campaign → category
    (campaign mapper, with the SKU-mapper category of its advertised products as a
    fallback for campaigns the mapper doesn't list). Canonical categories are the
    SKU mapper's own labels, upper-cased so casing variants (Candles/CANDLES) fold. */

export const canonCat = (s: string): string => s.trim().toUpperCase() || 'UNMAPPED';

export interface SkuDim {
  skuId: string;
  name: string;
  category: string;
  mapped: boolean;
}
export interface CampaignDim {
  name: string;
  channel: ZpChannel;
  campaignType: string;
  category: string;
  mapped: boolean;
}
export interface Dims {
  skus: Map<string, SkuDim>; // sku_id → dim
  campaigns: Map<string, CampaignDim>; // normKey(name) → dim
  categories: string[];
  cities: string[];
}

const cache = new Map<string, Promise<Dims>>();
export const invalidateZpDims = (profileId: string) => cache.delete(profileId);
export const getZpDims = (profileId: string): Promise<Dims> => {
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
  const [skuRows, nameRows, campMapRows, campRows, prodRows, cityRows] = await Promise.all([
    q<{ sku_id: S; sku_name: S; category: S }>(
      `select sku_id, sku_name, category from zp_sku_map where profile_id=$1`,
      [profileId]
    ),
    // SKUs that appear in sales/product but may be missing a name in the mapper
    q<{ sku_id: S; name: S }>(
      `select sku_id, max(sku_name) name from zp_sales where profile_id=$1 group by 1
       union
       select product_id, max(product_name) from zp_ad_product where profile_id=$1 group by 1`,
      [profileId]
    ),
    q<{ campaign_name: S; category: S }>(
      `select campaign_name, category from zp_campaign_map where profile_id=$1`,
      [profileId]
    ),
    q<{ campaign_name: S; channel: S; campaign_type: S }>(
      `select campaign_name, max(channel) channel, max(campaign_type) campaign_type
       from zp_ad_campaign where profile_id=$1 group by 1`,
      [profileId]
    ),
    // campaign → its advertised SKUs (for the category fallback)
    q<{ campaign_name: S; product_id: S }>(
      `select distinct campaign_name, product_id from zp_ad_product where profile_id=$1`,
      [profileId]
    ),
    q<{ city: S }>(`select distinct city from zp_sales where profile_id=$1`, [profileId]),
  ]);

  // SKU → category
  const skuMap = new Map<string, { category: string; name: string }>();
  for (const r of skuRows) skuMap.set(r.sku_id, { category: canonCat(r.category), name: r.sku_name });
  const names = new Map<string, string>();
  for (const r of nameRows) if (r.name) names.set(r.sku_id, r.name);

  const allSkuIds = new Set<string>([...skuMap.keys(), ...names.keys()]);
  const skus = new Map<string, SkuDim>();
  for (const id of allSkuIds) {
    const m = skuMap.get(id);
    skus.set(id, {
      skuId: id,
      name: m?.name || names.get(id) || id,
      category: m ? m.category : 'UNMAPPED',
      mapped: !!m,
    });
  }

  // campaign → category (mapper first, else the dominant category of its advertised SKUs)
  const campCat = new Map<string, string>();
  for (const r of campMapRows) campCat.set(normKey(r.campaign_name), canonCat(r.category));
  const campSkuCats = new Map<string, Map<string, number>>();
  for (const r of prodRows) {
    const k = normKey(r.campaign_name);
    const cat = skus.get(r.product_id)?.category;
    if (!cat || cat === 'UNMAPPED') continue;
    const m = campSkuCats.get(k) ?? new Map<string, number>();
    m.set(cat, (m.get(cat) ?? 0) + 1);
    campSkuCats.set(k, m);
  }
  const campaigns = new Map<string, CampaignDim>();
  for (const r of campRows) {
    const k = normKey(r.campaign_name);
    let category = campCat.get(k);
    const mapped = !!category;
    if (!category) {
      const m = campSkuCats.get(k);
      category = m ? [...m.entries()].sort((a, b) => b[1] - a[1])[0]![0] : 'UNMAPPED';
    }
    campaigns.set(k, {
      name: r.campaign_name,
      channel: (r.channel as ZpChannel) || 'sp',
      campaignType: r.campaign_type,
      category,
      mapped,
    });
  }

  const categories = [
    ...new Set([...[...skus.values()].map((s) => s.category), ...[...campaigns.values()].map((c) => c.category)]),
  ]
    .filter((c) => c && c !== 'UNMAPPED')
    .sort();
  const cities = cityRows.map((r) => r.city).sort();
  return { skus, campaigns, categories, cities };
}

/** SKU IDs in a canonical category (or all when category is empty). */
export function skuIdsIn(d: Dims, category?: string): string[] {
  const want = category ? canonCat(category) : '';
  return [...d.skus.values()].filter((s) => !want || s.category === want).map((s) => s.skuId);
}
