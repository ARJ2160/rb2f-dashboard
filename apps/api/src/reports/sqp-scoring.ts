import type { SqpLaunch, SqpRow, SqpSort, SqpStrength, SqpTargeted } from '@dash/shared';

/**
 * Search Opportunities scoring, ported from eigen
 * (amazon-data-processor/src/services/search-query-opportunities.ts).
 *
 * Question answered: for which customer queries does this brand already engage
 * BETTER than the category, while not yet being targeted in every keyword
 * channel? Pure functions — no DB — so the rule is unit-tested.
 *
 * Targeting comes from daily_search_terms matched on `target` (the keyword
 * bid on), never on `search_term`: a phrase that merely triggered a broad or
 * auto keyword is not targeted, and that keyword's ACoS isn't this query's.
 */

/** Brand clicks at or below this are too thin to read a rate from. */
export const DEFAULT_MIN_BRAND_CLICKS = 15;

export interface SqpCounts {
  searchQuery: string;
  volume: number;
  impressionsTotal: number;
  impressionsBrand: number;
  clicksTotal: number;
  clicksBrand: number;
  cartAddsTotal: number;
  cartAddsBrand: number;
  purchasesTotal: number;
  purchasesBrand: number;
}

export interface Targeting {
  channels: Array<'SP' | 'SB'>;
  spend: number;
  adSales: number;
}

/** Rate in %, or null when the denominator is 0 ("no cart adds" ≠ "nobody bought"). */
export function ratePct(n: number, d: number): number | null {
  return d ? Number(((n / d) * 100).toFixed(2)) : null;
}

/** Strictly greater; a missing rate never wins, so it can't manufacture an opportunity. */
const beats = (brand: number | null, category: number | null) => brand != null && category != null && brand > category;

function statusOf(ch: Array<'SP' | 'SB'>): SqpTargeted {
  const sp = ch.includes('SP');
  const sb = ch.includes('SB');
  return sp && sb ? 'SP & SB' : sp ? 'SP' : sb ? 'SB' : 'Not Targeted';
}

function launchOf(s: SqpTargeted): SqpLaunch {
  return s === 'Not Targeted' ? 'SP & SB' : s === 'SP' ? 'SB' : s === 'SB' ? 'SP' : null;
}

const pct = (v: number | null) => (v == null ? 'n/a' : `${v.toFixed(1)}%`);
const clause = (label: string, b: number | null, c: number | null) =>
  `Brand ${label} ${pct(b)} vs category ${pct(c)}${beats(b, c) ? ' — beats category.' : ' — does not beat category.'}`;

/**
 * A query is an opportunity when:
 *   1. at least one of brand CTR, add-to-cart % and purchase % beats the
 *      category's rate for that query — strength = how many do:
 *      1 → Low, 2 → Medium, 3 → Strong;
 *   2. brand clicks > minBrandClicks (below that a rate is noise);
 *   3. it isn't already targeted in both SP and SB.
 * A bad ACoS on an existing bid doesn't cancel it — the ACoS column flags that separately.
 */
const STRENGTH: Record<number, SqpStrength> = { 1: 'Low', 2: 'Medium', 3: 'Strong' };
export function scoreQuery(
  row: SqpCounts,
  targeting: Targeting | undefined,
  accountAcosPct: number | null,
  minBrandClicks = DEFAULT_MIN_BRAND_CLICKS
): SqpRow {
  const ctrBrandPct = ratePct(row.clicksBrand, row.impressionsBrand);
  const ctrCategoryPct = ratePct(row.clicksTotal, row.impressionsTotal);
  const atcBrandPct = ratePct(row.cartAddsBrand, row.clicksBrand);
  const atcCategoryPct = ratePct(row.cartAddsTotal, row.clicksTotal);
  const purchaseBrandPct = ratePct(row.purchasesBrand, row.cartAddsBrand);
  const purchaseCategoryPct = ratePct(row.purchasesTotal, row.cartAddsTotal);

  const targeted = statusOf(targeting?.channels ?? []);
  const launchIn = launchOf(targeted);
  const spend = targeting ? Number(targeting.spend.toFixed(2)) : null;
  const acosPct = targeting && targeting.adSales > 0 ? Number(((targeting.spend / targeting.adSales) * 100).toFixed(2)) : null;
  const acosVsAccount = acosPct != null && accountAcosPct != null ? (acosPct > accountAcosPct ? 'worse' : 'better') : null;

  const wins = [
    beats(ctrBrandPct, ctrCategoryPct),
    beats(atcBrandPct, atcCategoryPct),
    beats(purchaseBrandPct, purchaseCategoryPct),
  ].filter(Boolean).length;
  const isOpportunity = wins > 0 && row.clicksBrand > minBrandClicks && launchIn !== null;

  return {
    query: row.searchQuery,
    volume: row.volume,
    brandClicks: row.clicksBrand,
    ctrBrandPct,
    ctrCategoryPct,
    atcBrandPct,
    atcCategoryPct,
    purchaseBrandPct,
    purchaseCategoryPct,
    targeted,
    launchIn,
    spend,
    acosPct,
    acosVsAccount,
    isOpportunity,
    strength: isOpportunity ? STRENGTH[wins]! : null,
    wins,
    impressionsTotal: row.impressionsTotal,
    impressionsBrand: row.impressionsBrand,
    impressionShare: ratePct(row.impressionsBrand, row.impressionsTotal),
    clicksTotal: row.clicksTotal,
    clicksBrand: row.clicksBrand,
    clickShare: ratePct(row.clicksBrand, row.clicksTotal),
    cartAddsTotal: row.cartAddsTotal,
    cartAddsBrand: row.cartAddsBrand,
    cartAddShare: ratePct(row.cartAddsBrand, row.cartAddsTotal),
    purchasesTotal: row.purchasesTotal,
    purchasesBrand: row.purchasesBrand,
    purchaseShare: ratePct(row.purchasesBrand, row.purchasesTotal),
    basis: [
      clause('CTR', ctrBrandPct, ctrCategoryPct),
      clause('add-to-cart', atcBrandPct, atcCategoryPct),
      clause('purchase', purchaseBrandPct, purchaseCategoryPct),
    ].join(' '),
  };
}

const SORT_FIELD: Record<Exclude<SqpSort, 'strength'>, keyof SqpRow> = {
  volume: 'volume',
  acos: 'acosPct',
  spend: 'spend',
  impressionShare: 'impressionShare',
  clickShare: 'clickShare',
  cartAddShare: 'cartAddShare',
  purchaseShare: 'purchaseShare',
  purchasesBrand: 'purchasesBrand',
};

/** Descending, with missing values always last (otherwise sorting by ACoS floats every untargeted query to the top). */
export function compareBy(sort: SqpSort) {
  // Strength: Strong → Medium → Low, then by search volume.
  if (sort === 'strength')
    return (a: SqpRow, b: SqpRow): number => b.wins - a.wins || b.volume - a.volume || a.query.localeCompare(b.query);
  const f = SORT_FIELD[sort];
  return (a: SqpRow, b: SqpRow): number => {
    const av = a[f] as number | null;
    const bv = b[f] as number | null;
    if (av == null && bv == null) return a.query.localeCompare(b.query);
    if (av == null) return 1;
    if (bv == null) return -1;
    return av === bv ? a.query.localeCompare(b.query) : bv - av;
  };
}
