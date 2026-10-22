import type { CoverageResponse } from '@dash/shared';
import { sql } from 'drizzle-orm';

import { db } from '../db/client';

/** What has been uploaded for a profile, and how well the ASIN mapper covers it (rule book §3). */
export async function getCoverage(profileId: string): Promise<CoverageResponse> {
  const sources = await db.execute<{ source: string; from: string | null; to: string | null; days: string }>(sql`
    select 'seller' as source, min(date)::text as "from", max(date)::text as "to", count(distinct date) as days
      from daily_asin_sales where profile_id = ${profileId} and source = 'seller'
    union all
    select 'vendor', min(date)::text, max(date)::text, count(distinct date)
      from daily_asin_sales where profile_id = ${profileId} and source = 'vendor'
    union all
    select 'ads_' || ch, min(a.date)::text, max(a.date)::text, count(distinct a.date)
      from (values ('sp'), ('sb'), ('sd')) as c(ch)
      left join daily_campaign_ads a on a.profile_id = ${profileId} and a.channel = c.ch
      group by ch
  `);

  const [mapper] = await db.execute<{ mapped: string; with_sales: string }>(sql`
    select
      count(distinct s.asin) filter (where p.mapper_category is not null) as mapped,
      count(distinct s.asin) as with_sales
    from daily_asin_sales s
    left join products p on p.profile_id = s.profile_id and p.asin = s.asin
    where s.profile_id = ${profileId} and s.asin <> ''
  `);
  const mapped = Number(mapper?.mapped ?? 0);
  const withSales = Number(mapper?.with_sales ?? 0);

  return {
    profileId,
    sources: sources.map((s) => ({ source: s.source, from: s.from, to: s.to, days: Number(s.days) })),
    asinMapper: {
      mappedAsins: mapped,
      asinsWithSales: withSales,
      matchRatePct: withSales ? (mapped / withSales) * 100 : null,
    },
  };
}
