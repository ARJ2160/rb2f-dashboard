import { addAdBase, deriveAd, emptyAdBase, pct, type PlacementResponse } from '@dash/shared';
import { sql, type SQL } from 'drizzle-orm';

import { db } from '../db/client';
import { adFilterOptions, dimsJoin, dimsWhere, SUMS, toBase, type AdFilters, type Agg } from './filters';

const ORDER = ['TOS', 'ROS', 'PDP'];

/** Placement view: SP + SB placement reports by TOS / ROS / PDP; campaign-level filters via campaign_dims. */
export async function getPlacements(
  profileId: string,
  from: string,
  to: string,
  filters: AdFilters & { channel: 'all' | 'sp' | 'sb' }
): Promise<PlacementResponse> {
  const conds: SQL[] = [sql`pl.profile_id = ${profileId}`, sql`pl.date between ${from} and ${to}`];
  if (filters.channel !== 'all') conds.push(sql`pl.channel = ${filters.channel}`);
  conds.push(...dimsWhere(filters));
  const [rows, options] = await Promise.all([
    db.execute<Agg & { channel: 'sp' | 'sb'; placement: string; campaigns: string }>(sql`
      select pl.channel, pl.placement, count(distinct pl.campaign_name) as campaigns, ${SUMS('pl')}
      from daily_placements pl ${dimsJoin('pl')}
      where ${sql.join(conds, sql` and `)}
      group by pl.channel, pl.placement`),
    adFilterOptions(profileId),
  ]);
  const total = rows.reduce((a, r) => addAdBase(a, toBase(r)), emptyAdBase());
  const notes: string[] = [];
  if (!rows.length) notes.push('No SP / SB placement data for this range and filters.');
  return {
    profileId,
    from,
    to,
    total: deriveAd(total),
    rows: rows
      .map((r) => ({
        channel: r.channel,
        placement: r.placement,
        campaigns: Number(r.campaigns),
        spendSharePct: pct(Number(r.spend), total.spend),
        ...deriveAd(toBase(r)),
      }))
      .sort(
        (a, b) =>
          a.channel.localeCompare(b.channel) ||
          (ORDER.indexOf(a.placement) + 1 || 9) - (ORDER.indexOf(b.placement) + 1 || 9) ||
          b.spend - a.spend
      ),
    filterOptions: options,
    notes,
  };
}
