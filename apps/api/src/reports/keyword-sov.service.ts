import type { KeywordMetricDef, KeywordSovResponse } from '@dash/shared';
import { sql } from 'drizzle-orm';

import { db } from '../db/client';

/** The metric picker — defaults mirror Amazon Pi's "Select Metrics" ticks (≤ 6 on by default). */
export const KEYWORD_METRIC_DEFS: KeywordMetricDef[] = [
  { key: 'firstPageOrganicCoverage', label: 'First Page Organic SOV %', group: 'organic', format: 'pct', default: true },
  { key: 'firstPageSpSOV', label: 'First Page SP SOV %', group: 'sp', format: 'pct', default: true },
  { key: 'firstPageTopSpSOV', label: 'First Page Top SP SOV %', group: 'sp', format: 'pct', default: true },
  { key: 'overallSpSOV', label: 'Overall SP SOV %', group: 'sp', format: 'pct', default: true },
  { key: 'overallSpCPC', label: 'Overall SP CPC', group: 'sp', format: 'money', default: true },
  { key: 'overallSpACOS', label: 'Overall SP ACoS %', group: 'sp', format: 'pct', default: true },
  { key: 'firstPageSpCTR', label: 'First Page SP CTR %', group: 'sp', format: 'pct', default: false },
  { key: 'firstPageSpCPC', label: 'First Page SP CPC', group: 'sp', format: 'money', default: false },
  { key: 'firstPageSpACOS', label: 'First Page SP ACoS %', group: 'sp', format: 'pct', default: false },
  { key: 'firstPageSpConversions', label: 'First Page SP Conv %', group: 'sp', format: 'pct', default: false },
  { key: 'overallSpCTR', label: 'Overall SP CTR %', group: 'sp', format: 'pct', default: false },
  { key: 'overallSpConversions', label: 'Overall SP Conv %', group: 'sp', format: 'pct', default: false },
  { key: 'restOfSearchSpSOV', label: 'Rest of Search SP SOV %', group: 'sp', format: 'pct', default: false },
  { key: 'topDisplayedSPAsin', label: 'Top Displayed SP ASIN', group: 'sp', format: 'asin', default: false },
  { key: 'totalFirstPageCoverage', label: 'Total First Page Coverage %', group: 'sp', format: 'pct', default: false },
  { key: 'firstPageSpCoverage', label: 'First Page SP Coverage %', group: 'sp', format: 'pct', default: false },
  { key: 'firstPageSbSOV', label: 'First Page SB SOV %', group: 'sb', format: 'pct', default: false },
  { key: 'firstPageTopSbSOV', label: 'First Page Top SB SOV %', group: 'sb', format: 'pct', default: false },
  { key: 'overallSbSOV', label: 'Overall SB SOV %', group: 'sb', format: 'pct', default: false },
  { key: 'overallSbCPC', label: 'Overall SB CPC', group: 'sb', format: 'money', default: false },
  { key: 'overallSbACOS', label: 'Overall SB ACoS %', group: 'sb', format: 'pct', default: false },
  { key: 'firstPageSbCTR', label: 'First Page SB CTR %', group: 'sb', format: 'pct', default: false },
  { key: 'firstPageSbCPC', label: 'First Page SB CPC', group: 'sb', format: 'money', default: false },
  { key: 'firstPageSbACOS', label: 'First Page SB ACoS %', group: 'sb', format: 'pct', default: false },
  { key: 'firstPageSbConversions', label: 'First Page SB Conv %', group: 'sb', format: 'pct', default: false },
  { key: 'overallSbCTR', label: 'Overall SB CTR %', group: 'sb', format: 'pct', default: false },
  { key: 'overallSbConversions', label: 'Overall SB Conv %', group: 'sb', format: 'pct', default: false },
  { key: 'restOfSearchSbSOV', label: 'Rest of Search SB SOV %', group: 'sb', format: 'pct', default: false },
  { key: 'overallOrganicSOV', label: 'Overall Organic SOV %', group: 'organic', format: 'pct', default: false },
  { key: 'topDisplayedOrganicAsin', label: 'Top Displayed Organic ASIN', group: 'organic', format: 'asin', default: false },
];

/** Amazon Pi keyword SOV for one duration + snapshot date, optionally filtered to a keyword type (tab). */
export async function getKeywordSov(
  profileId: string,
  opts: { duration?: string; date?: string; keywordType?: string } = {}
): Promise<KeywordSovResponse> {
  const durRows = await db.execute<{ duration: string }>(sql`
    select distinct duration from keyword_sov where profile_id = ${profileId} order by duration`);
  const durations = durRows.map((d) => d.duration);
  const duration =
    opts.duration && durations.includes(opts.duration)
      ? opts.duration
      : durations.includes('15days')
        ? '15days'
        : (durations[0] ?? '15days');

  if (!durations.length) {
    return { profileId, duration, durations, dates: [], date: null, types: [], keywordType: opts.keywordType ?? null, metricDefs: KEYWORD_METRIC_DEFS, rows: [], notes: ['No Amazon Pi keyword data uploaded yet.'] };
  }

  // Snapshot dates available for the chosen duration (latest first).
  const dateRows = await db.execute<{ d: string }>(sql`
    select distinct snapshot_date::text as d from keyword_sov where profile_id = ${profileId} and duration = ${duration} order by d desc`);
  const dates = dateRows.map((r) => r.d);
  const date = opts.date && dates.includes(opts.date) ? opts.date : (dates[0] ?? null);

  const typeRows = await db.execute<{ t: string }>(sql`
    select distinct keyword_type as t from keyword_sov where profile_id = ${profileId} and duration = ${duration} and snapshot_date = ${date} order by 1`);
  const types = typeRows.map((r) => r.t);
  const typeCond = opts.keywordType && opts.keywordType !== 'ALL' ? sql`and keyword_type = ${opts.keywordType}` : sql``;

  const rows = await db.execute<{
    keyword: string;
    keywordType: string;
    searches: string | null;
    rank: number | null;
    mostClickedOrganicAsin: string | null;
    mostClickedSpAsin: string | null;
    metrics: Record<string, number | string | null>;
    [k: string]: unknown;
  }>(sql`
    select keyword, keyword_type as "keywordType", searches, rank,
           most_clicked_organic_asin as "mostClickedOrganicAsin", most_clicked_sp_asin as "mostClickedSpAsin",
           metrics
    from keyword_sov
    where profile_id = ${profileId} and duration = ${duration} and snapshot_date = ${date} ${typeCond}
    order by rank asc nulls last
    limit 2000`);

  return {
    profileId,
    duration,
    durations,
    dates,
    date,
    types,
    keywordType: opts.keywordType ?? null,
    metricDefs: KEYWORD_METRIC_DEFS,
    rows,
    notes: [],
  };
}
