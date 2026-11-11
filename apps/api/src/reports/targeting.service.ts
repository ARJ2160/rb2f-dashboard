import {
  daysInRange,
  deriveAd,
  type AdFilterOptions,
  type BidActionsResponse,
  type NegationsResponse,
  type RuleMetric,
  type TermActionGrain,
  type TermActionRow,
  type TermRule,
  type TermRulesResponse,
} from '@dash/shared';
import { sql, type SQL } from 'drizzle-orm';

import { db } from '../db/client';
import { getDsr } from './dsr.service';
import { getBrandTerms, targetTypeSql, termClassJoin } from './dims';
import { adFilterOptions, dimsJoin, dimsWhere, toBase, type AdFilters, type Agg } from './filters';

/** Orders = "Total Orders (#)", falling back to ad units on rows/exports without that column. */
const ORDERS = sql`sum(coalesce(st.ad_orders, st.ad_units))`;
const ACOS = sql`(100.0 * sum(st.spend) / nullif(sum(st.ad_sales), 0))`;

/** Grouped-sum SQL for every metric a rule / bid move can test. */
const METRIC_SQL: Record<RuleMetric, SQL> = {
  impressions: sql`sum(st.impressions)`,
  clicks: sql`sum(st.clicks)`,
  spend: sql`sum(st.spend)`,
  adSales: sql`sum(st.ad_sales)`,
  adUnits: sql`sum(st.ad_units)`,
  orders: ORDERS,
  ctrPct: sql`(100.0 * sum(st.clicks) / nullif(sum(st.impressions), 0))`,
  cpc: sql`(sum(st.spend) / nullif(sum(st.clicks), 0))`,
  crPct: sql`(100.0 * sum(st.ad_units) / nullif(sum(st.clicks), 0))`,
  acosPct: ACOS,
  roas: sql`(sum(st.ad_sales) / nullif(sum(st.spend), 0))`,
};

type RawRow = Agg & {
  key: string;
  orders: string;
  channels: string | null;
  branding: string | null;
  target_type: string | null;
  match_type: string | null;
  campaigns: string;
};

const fmtChannels = (csv: string | null) =>
  (csv ?? '')
    .split(',')
    .filter(Boolean)
    .map((c) => c.toUpperCase())
    .sort((a, b) => ['SP', 'SB', 'SD'].indexOf(a) - ['SP', 'SB', 'SD'].indexOf(b))
    .join(' & ');

function toRow(r: RawRow, grain: TermActionGrain): TermActionRow {
  const base = toBase(r);
  const m = deriveAd(base);
  return {
    key: r.key,
    ...(grain === 'target' ? { targetType: r.target_type ?? 'Other', matchType: r.match_type ?? '' } : {}),
    channels: fmtChannels(r.channels),
    branding: r.branding ?? undefined,
    orders: Number(r.orders),
    roas: base.spend > 0 ? base.adSales / base.spend : null,
    campaigns: Number(r.campaigns),
    ...m,
  };
}

/**
 * Per-term / per-target aggregate with a caller-supplied HAVING filter. One row
 * per search term (grain "term") or per targeting expression + match type
 * (grain "target"), ordered by spend, fetching one extra row to flag truncation.
 */
async function aggregate(
  profileId: string,
  from: string,
  to: string,
  grain: TermActionGrain,
  filters: AdFilters,
  having: SQL,
  limit: number
): Promise<{ rows: RawRow[]; truncated: boolean }> {
  const st = sql.raw('st');
  const tType = targetTypeSql(sql`${st}.target`, sql`${st}.match_type`, sql`${st}.channel`);
  const tClass = sql`coalesce(tc.branding, 'Generic')`;

  const conds: SQL[] = [
    sql`st.profile_id = ${profileId}`,
    sql`st.date between ${from} and ${to}`,
    ...dimsWhere(filters, { targeting: tType, branding: tClass }),
  ];

  const keyExpr = grain === 'term' ? sql`st.search_term` : sql`st.target`;
  const groupCols = grain === 'term' ? sql`st.search_term` : sql`st.target, st.match_type`;
  const dimCols =
    grain === 'target'
      ? sql`min(${tType}) as target_type, min(st.match_type) as match_type, min(${tClass}) as branding,`
      : sql`'' as target_type, '' as match_type, min(${tClass}) as branding,`;

  const rows = await db.execute<RawRow>(sql`
    select ${keyExpr} as key,
           ${dimCols}
           string_agg(distinct st.channel, ',') as channels,
           count(distinct st.campaign_name) as campaigns,
           sum(st.impressions) as impressions, sum(st.clicks) as clicks, sum(st.spend) as spend,
           sum(st.ad_sales) as ad_sales, sum(st.ad_units) as ad_units, ${ORDERS} as orders
    from daily_search_terms st ${dimsJoin('st')} ${termClassJoin('st')}
    where ${sql.join(conds, sql` and `)}
    group by ${groupCols}
    having ${having}
    order by sum(st.spend) desc, ${keyExpr}
    limit ${limit + 1}`);

  return { rows: rows.slice(0, limit), truncated: rows.length > limit };
}

/** Whole-account ACoS (all ads) for the range — the DSR account figure. */
async function accountAcosPct(profileId: string, from: string, to: string): Promise<number | null> {
  const dsr = await getDsr(profileId, from, to);
  return dsr.total.acosPct;
}

/**
 * Search-term negations: terms that spend without converting. Flags a term when
 * it has 0 orders with more than `minClicks` clicks, OR an ACoS above
 * `acosMultiple` × the account ACoS with fewer than `maxOrders` orders.
 */
export async function getNegations(
  profileId: string,
  from: string,
  to: string,
  filters: AdFilters,
  opts: { minClicks?: number; acosMultiple?: number; maxOrders?: number; limit?: number } = {}
): Promise<NegationsResponse> {
  const minClicks = opts.minClicks ?? 20;
  const acosMultiple = opts.acosMultiple ?? 2.5;
  const maxOrders = opts.maxOrders ?? 3;
  const limit = opts.limit ?? 1000;

  const [acct, options] = await Promise.all([accountAcosPct(profileId, from, to), adFilterOptions(profileId)]);
  const acosThreshold = acct == null ? null : acosMultiple * acct;

  const zeroRule = sql`(${ORDERS} = 0 and sum(st.clicks) > ${minClicks})`;
  const having =
    acosThreshold == null
      ? zeroRule
      : sql`${zeroRule} or (sum(st.ad_sales) > 0 and ${ACOS} > ${acosThreshold} and ${ORDERS} < ${maxOrders})`;

  const { rows, truncated } = await aggregate(profileId, from, to, 'term', filters, having, limit);

  const mapped = rows.map((r) => {
    const row = toRow(r, 'term');
    row.reason = row.orders === 0 && row.clicks > minClicks ? 'zero-orders' : 'high-acos';
    return row;
  });

  const notes: string[] = [];
  if (acct == null) notes.push('No account ad-sales in this range, so the high-ACoS rule is off — only "0 orders with clicks" terms are shown.');
  else notes.push(`Account ACoS for the range is ${acct.toFixed(1)}%; the high-ACoS rule flags terms above ${(acosMultiple * acct).toFixed(1)}%.`);
  if (truncated) notes.push(`Showing the top ${limit} by spend — narrow the filters to see the rest.`);

  return {
    profileId,
    from,
    to,
    accountAcosPct: acct,
    thresholds: { minClicks, acosMultiple, maxOrders },
    rows: mapped,
    totalMatched: mapped.length,
    truncated,
    filterOptions: options,
    notes,
  };
}

const CMP = { gte: sql.raw('>='), lte: sql.raw('<=') };

/**
 * Dynamic rules: show every term (grain "term") or target (grain "target")
 * whose metrics satisfy ALL the supplied rules (metric op value). Ratio metrics
 * with no denominator are treated as "no match".
 */
export async function getTermRules(
  profileId: string,
  from: string,
  to: string,
  grain: TermActionGrain,
  rules: TermRule[],
  filters: AdFilters,
  opts: { limit?: number } = {}
): Promise<TermRulesResponse> {
  const limit = opts.limit ?? 1000;
  const options = await adFilterOptions(profileId);
  const noun = grain === 'term' ? 'search terms' : 'targets';

  const notes: string[] = [];
  // No rules → show everything; otherwise AND the rule fragments into a HAVING.
  const having = rules.length
    ? sql.join(
        rules.map((r) => sql`${METRIC_SQL[r.metric]} ${CMP[r.op]} ${r.value}`),
        sql` and `
      )
    : sql`true`;
  if (!rules.length) notes.push(`Showing all ${noun} — set a rule value to filter.`);

  const { rows, truncated } = await aggregate(profileId, from, to, grain, filters, having, limit);
  if (truncated) notes.push(`Showing the top ${limit} by spend — ${rules.length ? 'tighten the rules' : 'add a rule'} to narrow it.`);

  return {
    profileId,
    from,
    to,
    grain,
    rules,
    rows: rows.map((r) => toRow(r, grain)),
    totalMatched: rows.length,
    truncated,
    filterOptions: options,
    notes,
  };
}

/**
 * Bid moves at the target level. Reduce = ACoS ≥ `reduceAcosMultiple` × account
 * ACoS with at least `reduceMinClicks` clicks. Scale up = ACoS ≤
 * `scaleAcosMultiple` × account ACoS with at least `scaleMinOrders` orders.
 * Only meaningful over a range longer than 3 days.
 */
export async function getBidActions(
  profileId: string,
  from: string,
  to: string,
  filters: AdFilters,
  opts: {
    reduceAcosMultiple?: number;
    reduceMinClicks?: number;
    scaleAcosMultiple?: number;
    scaleMinOrders?: number;
    limit?: number;
  } = {}
): Promise<BidActionsResponse> {
  const reduceAcosMultiple = opts.reduceAcosMultiple ?? 1.5;
  const reduceMinClicks = opts.reduceMinClicks ?? 10;
  const scaleAcosMultiple = opts.scaleAcosMultiple ?? 0.6;
  const scaleMinOrders = opts.scaleMinOrders ?? 2;
  const limit = opts.limit ?? 1000;

  const rangeOk = daysInRange(from, to) > 3;
  const [acct, options] = await Promise.all([accountAcosPct(profileId, from, to), adFilterOptions(profileId)]);
  const notes: string[] = [];
  const empty = { thresholds: {}, rows: [] as TermActionRow[], totalMatched: 0, truncated: false };

  if (!rangeOk) {
    notes.push('Bid moves need a time frame longer than 3 days — widen the date range.');
    return {
      profileId,
      from,
      to,
      accountAcosPct: acct,
      rangeOk,
      reduce: { ...empty, thresholds: { acosMultiple: reduceAcosMultiple, minClicks: reduceMinClicks } },
      scaleUp: { ...empty, thresholds: { acosMultiple: scaleAcosMultiple, minOrders: scaleMinOrders } },
      filterOptions: options,
      notes,
    };
  }

  if (acct == null) {
    notes.push('No account ad-sales in this range, so bid moves (which compare to account ACoS) cannot be computed.');
    return {
      profileId,
      from,
      to,
      accountAcosPct: acct,
      rangeOk,
      reduce: { ...empty, thresholds: { acosMultiple: reduceAcosMultiple, minClicks: reduceMinClicks } },
      scaleUp: { ...empty, thresholds: { acosMultiple: scaleAcosMultiple, minOrders: scaleMinOrders } },
      filterOptions: options,
      notes,
    };
  }

  // Reduce = inefficient spenders with enough clicks to trust the signal: either
  // spend with NO sales at all (the worst offenders), or an ACoS well above the
  // account. The old rule required ad_sales > 0, which hid the zero-sale wasters.
  const reduceHaving = sql`sum(st.clicks) >= ${reduceMinClicks} and (sum(st.ad_sales) = 0 or ${ACOS} >= ${reduceAcosMultiple * acct})`;
  // Scale up = efficient performers converting below the account ACoS.
  const scaleHaving = sql`sum(st.ad_sales) > 0 and ${ACOS} <= ${scaleAcosMultiple * acct} and ${ORDERS} >= ${scaleMinOrders}`;

  const [reduce, scaleUp] = await Promise.all([
    aggregate(profileId, from, to, 'target', filters, reduceHaving, limit),
    aggregate(profileId, from, to, 'target', filters, scaleHaving, limit),
  ]);

  notes.push(
    `Account ACoS for the range is ${acct.toFixed(1)}%. Reduce = ${reduceMinClicks}+ clicks with either no sales or ACoS ≥ ${(reduceAcosMultiple * acct).toFixed(1)}%. Scale up = ACoS ≤ ${(scaleAcosMultiple * acct).toFixed(1)}% with ${scaleMinOrders}+ orders.`
  );

  return {
    profileId,
    from,
    to,
    accountAcosPct: acct,
    rangeOk,
    reduce: {
      thresholds: { acosMultiple: reduceAcosMultiple, minClicks: reduceMinClicks },
      rows: reduce.rows.map((r) => toRow(r, 'target')),
      totalMatched: reduce.rows.length,
      truncated: reduce.truncated,
    },
    scaleUp: {
      thresholds: { acosMultiple: scaleAcosMultiple, minOrders: scaleMinOrders },
      rows: scaleUp.rows.map((r) => toRow(r, 'target')),
      totalMatched: scaleUp.rows.length,
      truncated: scaleUp.truncated,
    },
    filterOptions: options,
    notes,
  };
}
