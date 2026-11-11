import { pct, type GlanceViewsResponse } from '@dash/shared';
import { sql, type SQL } from 'drizzle-orm';

import { db } from '../db/client';

/**
 * Amazon Pi ASIN-level Glance Views. Account trend = sum of your ASINs' glance
 * views per snapshot day; the table breaks it down per ASIN. (This is your own
 * ASINs only — the category-share % would need total-category GV, which the
 * export doesn't carry.)
 */
export async function getGlanceViews(
  profileId: string,
  opts: { from?: string; to?: string; category?: string } = {}
): Promise<GlanceViewsResponse> {
  const [bounds] = await db.execute<{ min: string | null; max: string | null }>(sql`
    select min(date)::text as min, max(date)::text as max from daily_asin_gv where profile_id = ${profileId}`);
  const from = opts.from ?? bounds?.min ?? null;
  const to = opts.to ?? bounds?.max ?? null;

  if (!from || !to) {
    return { profileId, from, to, dates: [], trend: [], total: 0, rows: [], categories: [], category: opts.category ?? null, notes: ['No Amazon Pi glance-view data uploaded yet.'] };
  }

  const conds: SQL[] = [sql`g.profile_id = ${profileId}`, sql`g.date between ${from} and ${to}`];
  if (opts.category) conds.push(sql`coalesce(p.mapper_category, g.category, 'Unmapped') = ${opts.category}`);
  const where = sql.join(conds, sql` and `);
  const fromSql = sql`daily_asin_gv g left join products p on p.profile_id = g.profile_id and p.asin = g.asin`;

  const [trend, rows, cats] = await Promise.all([
    db.execute<{ date: string; gv: string }>(sql`
      select g.date::text as date, coalesce(sum(g.glance_views), 0)::text as gv
      from ${fromSql} where ${where} group by g.date order by g.date`),
    db.execute<{ asin: string; title: string | null; category: string | null; gv: string }>(sql`
      select g.asin, max(coalesce(p.mapper_title, p.report_title)) as title,
             coalesce(max(p.mapper_category), max(g.category), 'Unmapped') as category,
             coalesce(sum(g.glance_views), 0)::text as gv
      from ${fromSql} where ${where} group by g.asin`),
    db.execute<{ category: string }>(sql`
      select distinct coalesce(p.mapper_category, g.category, 'Unmapped') as category
      from daily_asin_gv g left join products p on p.profile_id = g.profile_id and p.asin = g.asin
      where g.profile_id = ${profileId} order by 1`),
  ]);

  const total = rows.reduce((a, r) => a + Number(r.gv), 0);
  const notes = ['Glance views are Amazon Pi indexed values for your ASINs only (not a share of the whole category).'];

  return {
    profileId,
    from,
    to,
    dates: trend.map((t) => t.date),
    trend: trend.map((t) => ({ date: t.date, glanceViews: Number(t.gv) })),
    total,
    rows: rows
      .map((r) => ({ asin: r.asin, title: r.title, category: r.category, glanceViews: Number(r.gv), sharePct: pct(Number(r.gv), total) }))
      .sort((a, b) => b.glanceViews - a.glanceViews),
    categories: cats.map((c) => c.category),
    category: opts.category ?? null,
    notes,
  };
}
