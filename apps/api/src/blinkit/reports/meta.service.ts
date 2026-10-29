import type { BkMetaResponse } from '@dash/shared/blinkit';
import { getDims } from './dims';
import { snapshots } from './inventory.service';
import { q } from './queries';

export async function meta(profileId: string): Promise<BkMetaResponse> {
  const d = await getDims(profileId);
  const [s, a, itemRev, campSpend, snaps] = await Promise.all([
    q(`select min(date)::text f, max(date)::text t, count(*) n from bk_sales_lines where profile_id=$1`, [profileId]),
    q(`select min(date)::text f, max(date)::text t, count(*) n from bk_daily_ads where profile_id=$1`, [profileId]),
    q(`select item_id, sum(revenue) r from bk_sales_lines where profile_id=$1 group by 1`, [profileId]),
    q(`select campaign_id, sum(spend) s from bk_daily_ads where profile_id=$1 group by 1`, [profileId]),
    snapshots(profileId),
  ]);
  const rev = new Map(itemRev.map((r) => [String(r.item_id), Number(r.r)]));
  const spend = new Map(campSpend.map((r) => [String(r.campaign_id), Number(r.s)]));
  const units = new Map<string, { key: string; label: string; cities: string[]; kind: 'city' | 'multi' }>();
  for (const c of d.campaigns.values()) if (c.geo.kind !== 'none') units.set(c.geo.key, { key: c.geo.key, label: c.geo.label, cities: c.geo.cities, kind: c.geo.kind });
  return {
    profileId,
    sales: { from: (s[0]?.f as string | null) ?? null, to: (s[0]?.t as string | null) ?? null, rows: Number(s[0]?.n ?? 0) },
    ads: { from: (a[0]?.f as string | null) ?? null, to: (a[0]?.t as string | null) ?? null, rows: Number(a[0]?.n ?? 0) },
    inventory: { snapshots: snaps },
    categories: d.categories,
    skus: d.skus,
    campaigns: [...d.campaigns.values()].sort((x, y) => (spend.get(y.id) ?? 0) - (spend.get(x.id) ?? 0)).map((c) => ({
      id: c.id, name: c.name, adType: c.adType, category: c.category,
      geoKind: c.geo.kind, geoLabel: c.geo.kind === 'none' ? c.geo.reason : c.geo.label,
    })),
    geoUnits: [...units.values()].sort((x, y) => x.label.localeCompare(y.label)),
    unmappedItems: [...d.items.values()].filter((i) => !i.mapped).map((i) => ({ itemId: i.itemId, name: i.name, revenue: rev.get(i.itemId) ?? 0 }))
      .sort((x, y) => y.revenue - x.revenue),
    unmappedCampaigns: [...d.campaigns.values()].filter((c) => !c.mapped).map((c) => ({ id: c.id, name: c.name, spend: spend.get(c.id) ?? 0 }))
      .sort((x, y) => y.spend - x.spend),
    notes: [],
  };
}
