import { addAdBase, deriveAd, emptyAdBase, pct, type HourlyResponse } from '@dash/shared';
import { sql, type SQL } from 'drizzle-orm';

import { db } from '../db/client';
import { adFilterOptions, dimsJoin, dimsWhere, SUMS, toBase, type AdFilters, type Agg } from './filters';

/** Hour-wise: campaign reports exported with "Start Time", by hour of day (0–23). */
export async function getHourly(
  profileId: string,
  from: string,
  to: string,
  f: AdFilters & { channel: 'all' | 'sp' | 'sb' | 'sd' }
): Promise<HourlyResponse> {
  const conds: SQL[] = [sql`h.profile_id = ${profileId}`, sql`h.date between ${from} and ${to}`];
  if (f.channel !== 'all') conds.push(sql`h.channel = ${f.channel}`);
  conds.push(...dimsWhere(f));
  const [rows, channels, options] = await Promise.all([
    db.execute<Agg & { hour: number }>(sql`
      select h.hour, ${SUMS('h')}
      from daily_hourly_ads h ${dimsJoin('h')}
      where ${sql.join(conds, sql` and `)}
      group by h.hour`),
    db.execute<{ channel: 'sp' | 'sb' | 'sd'; days: string }>(sql`
      select channel, count(distinct date) as days from daily_hourly_ads
      where profile_id = ${profileId} and date between ${from} and ${to} group by channel`),
    adFilterOptions(profileId),
  ]);
  const byHour = new Map(rows.map((r) => [Number(r.hour), toBase(r)]));
  const total = [...byHour.values()].reduce((a, b) => addAdBase(a, b), emptyAdBase());
  const notes: string[] = [];
  const have = new Set(channels.map((c) => c.channel));
  if (!have.size) notes.push('No hourly data in this range. Export SP / SB / SD campaign reports with the hourly time unit ("Start Time" column).');
  else {
    const missing = (['sp', 'sb', 'sd'] as const).filter((c) => !have.has(c)).map((c) => c.toUpperCase());
    if (missing.length) notes.push(`No hourly export uploaded for ${missing.join(' / ')} in this range — hours cover ${[...have].map((c) => c.toUpperCase()).join(' + ')} only.`);
  }
  return {
    profileId,
    from,
    to,
    total: deriveAd(total),
    rows: Array.from({ length: 24 }, (_, hour) => {
      const b = byHour.get(hour) ?? emptyAdBase();
      return { hour, spendSharePct: pct(b.spend, total.spend), ...deriveAd(b) };
    }),
    channels: channels.map((c) => ({ channel: c.channel, days: Number(c.days) })),
    filterOptions: options,
    notes,
  };
}
