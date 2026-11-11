import type { SearchRankAsin, SearchRankResponse } from '@dash/shared';
import { sql } from 'drizzle-orm';

import { db } from '../db/client';

/** Amazon Pi monthly organic search rank per ASIN (lower = better). One series per ASIN. */
export async function getSearchRank(profileId: string): Promise<SearchRankResponse> {
  const rows = await db.execute<{ asin: string; period: string; rank: string; title: string | null; category: string | null; subcategory: string | null }>(sql`
    select r.asin, r.period::text as period, r.search_rank::text as rank,
           coalesce(p.mapper_title, r.title) as title,
           coalesce(p.mapper_category, r.category) as category, r.subcategory
    from product_search_rank r
    left join products p on p.profile_id = r.profile_id and p.asin = r.asin
    where r.profile_id = ${profileId}
    order by r.asin, r.period`);

  const periods = [...new Set(rows.map((r) => r.period))].sort();
  const byAsin = new Map<string, SearchRankAsin>();
  for (const r of rows) {
    let a = byAsin.get(r.asin);
    if (!a) {
      a = { asin: r.asin, title: r.title, category: r.category, subcategory: r.subcategory, latestRank: null, bestRank: null, change: null, points: [] };
      byAsin.set(r.asin, a);
    }
    a.points.push({ period: r.period, rank: Number(r.rank) });
  }

  const asins = [...byAsin.values()]
    .map((a) => {
      const pts = a.points;
      const first = pts[0];
      const last = pts[pts.length - 1];
      a.latestRank = last ? last.rank : null;
      a.bestRank = pts.length ? Math.min(...pts.map((p) => p.rank)) : null;
      a.change = first && last ? last.rank - first.rank : null;
      return a;
    })
    .sort((x, y) => (x.latestRank ?? 1e9) - (y.latestRank ?? 1e9));

  const notes: string[] = [];
  if (!rows.length) notes.push('No Amazon Pi search-rank data uploaded yet.');
  else notes.push('Search rank is the average organic position for the month — lower is better.');

  return { profileId, periods, asins, notes };
}
