import type { AdFilterOptions } from '@dash/shared';
import { sql, type SQL } from 'drizzle-orm';

import { db } from '../db/client';
import { ck } from './dims';

export { ck as campaignKeySql };

/** Filters shared by every ads-only view. All values come from campaign_dims (see dims.ts). */
export interface AdFilters {
  category?: string | undefined;
  adType?: string | undefined;
  targeting?: string | undefined;
  branding?: string | undefined;
}

/** `left join campaign_dims cd` for a fact table aliased `alias` with a campaign_name column. */
export function dimsJoin(alias: string): SQL {
  return sql`left join campaign_dims cd on cd.profile_id = ${sql.raw(alias)}.profile_id and cd.campaign_key = ${ck(`${alias}.campaign_name`)}`;
}

/**
 * WHERE fragments. Search-term views pass row-level targeting / branding
 * expressions (each search term has its own target and class); campaign-level
 * views use the campaign's dominant value from campaign_dims.
 */
export function dimsWhere(f: AdFilters, row: { targeting?: SQL; branding?: SQL } = {}): SQL[] {
  const out: SQL[] = [];
  if (f.category) out.push(sql`coalesce(cd.category, 'Unmapped') = ${f.category}`);
  if (f.adType) out.push(sql`coalesce(cd.ad_type, 'Unknown') = ${f.adType}`);
  if (f.targeting) out.push(sql`${row.targeting ?? sql`coalesce(cd.targeting, 'Other')`} = ${f.targeting}`);
  if (f.branding) out.push(sql`${row.branding ?? sql`coalesce(cd.branding, 'Generic')`} = ${f.branding}`);
  return out;
}

const ORDER: Record<string, string[]> = {
  adTypes: ['SP', 'SB', 'SBV', 'SD', 'SDV', 'Unknown'],
  targetings: ['Keyword', 'Product', 'Category', 'Auto', 'Audience', 'Other'],
  brandings: ['Branded', 'Competitor', 'Generic'],
};
const sortBy = (list: string[], order: string[]) =>
  [...list].sort((a, b) => (order.indexOf(a) + 1 || 99) - (order.indexOf(b) + 1 || 99) || a.localeCompare(b));

/** ASIN-mapper categories for a profile, plus "Unmapped" (the category filter's choices). */
export async function listCategories(profileId: string): Promise<string[]> {
  const rows = await db.execute<{ c: string }>(
    sql`select distinct mapper_category as c from products where profile_id = ${profileId} and mapper_category is not null`
  );
  return [...rows.map((r) => r.c).sort((a, b) => a.localeCompare(b)), 'Unmapped'];
}

/**
 * Category of an ASIN column, same labels as the Category view:
 * mapper category, "Unmapped" (not in mapper) or "(missing ASIN)" (blank in source).
 */
export function asinCategorySql(asinCol: string, productAlias = 'p'): SQL {
  return sql.raw(`case when ${asinCol} = '' then '(missing ASIN)' else coalesce(${productAlias}.mapper_category, 'Unmapped') end`);
}

export async function adFilterOptions(profileId: string): Promise<AdFilterOptions> {
  const [rows, cats] = await Promise.all([
    db.execute<{ category: string; ad_type: string; targeting: string; branding: string }>(
      sql`select distinct category, ad_type, targeting, branding from campaign_dims where profile_id = ${profileId}`
    ),
    listCategories(profileId),
  ]);
  const uniq = (k: keyof (typeof rows)[number]) => [...new Set(rows.map((r) => r[k]))];
  return {
    categories: [...new Set([...uniq('category'), ...cats])].sort((a, b) => (a === 'Unmapped' ? 1 : b === 'Unmapped' ? -1 : a.localeCompare(b))),
    adTypes: sortBy(uniq('ad_type'), ORDER.adTypes!),
    targetings: sortBy([...new Set([...uniq('targeting'), ...ORDER.targetings!.slice(0, 5)])], ORDER.targetings!),
    brandings: ORDER.brandings!,
  };
}

/** "SB,SP" → "SP & SB" (rule book §8: never "Both"). */
export function channelLabel(csv: string | null): string {
  const set = new Set((csv ?? '').split(',').filter(Boolean).map((c) => c.toUpperCase()));
  return ['SP', 'SB', 'SD'].filter((c) => set.has(c)).join(' & ');
}

export type Agg = { impressions: string; clicks: string; spend: string; ad_sales: string; ad_units: string };
export const toBase = (r: Partial<Agg> | undefined) => ({
  impressions: Number(r?.impressions ?? 0),
  clicks: Number(r?.clicks ?? 0),
  spend: Number(r?.spend ?? 0),
  adSales: Number(r?.ad_sales ?? 0),
  adUnits: Number(r?.ad_units ?? 0),
});
export const SUMS = (a: string) =>
  sql.raw(
    `sum(${a}.impressions) as impressions, sum(${a}.clicks) as clicks, sum(${a}.spend) as spend, sum(${a}.ad_sales) as ad_sales, sum(${a}.ad_units) as ad_units`
  );
