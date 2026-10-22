/**
 * Metric formulas (rule book §7 / §10.1).
 *
 * Always sum raw numbers first, then derive ratios — never average ratios.
 * A ratio with a zero/absent denominator is `null` (rendered "—"), never 0,
 * so "no data" can't be mistaken for "zero performance".
 */

export function ratio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num == null || den == null || den === 0) return null;
  return num / den;
}

export function pct(num: number | null | undefined, den: number | null | undefined): number | null {
  const r = ratio(num, den);
  return r == null ? null : r * 100;
}

/** Summable inputs behind one DSR row. */
export interface DsrBase {
  sales: number;
  unitsSold: number;
  impressions: number;
  clicks: number;
  spends: number;
  adSales: number;
  adUnits: number;
  /** null = no page-view data exists for this row (vs. a real 0). */
  pageViews: number | null;
}

export interface DsrMetrics extends DsrBase {
  aov: number | null;
  cpc: number | null;
  ctrPct: number | null;
  adCrPct: number | null;
  acosPct: number | null;
  tacosPct: number | null;
  organicSales: number;
}

export function deriveDsr(b: DsrBase): DsrMetrics {
  return {
    ...b,
    aov: ratio(b.sales, b.unitsSold),
    cpc: ratio(b.spends, b.clicks),
    ctrPct: pct(b.clicks, b.impressions),
    adCrPct: pct(b.adUnits, b.clicks),
    acosPct: pct(b.spends, b.adSales),
    tacosPct: pct(b.spends, b.sales),
    organicSales: b.sales - b.adSales,
  };
}

export function emptyDsrBase(): DsrBase {
  return { sales: 0, unitsSold: 0, impressions: 0, clicks: 0, spends: 0, adSales: 0, adUnits: 0, pageViews: null };
}

export function addDsrBase(a: DsrBase, b: DsrBase): DsrBase {
  return {
    sales: a.sales + b.sales,
    unitsSold: a.unitsSold + b.unitsSold,
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    spends: a.spends + b.spends,
    adSales: a.adSales + b.adSales,
    adUnits: a.adUnits + b.adUnits,
    pageViews: a.pageViews == null && b.pageViews == null ? null : (a.pageViews ?? 0) + (b.pageViews ?? 0),
  };
}

export function scaleDsrBase(b: DsrBase, factor: number): DsrBase {
  return {
    sales: b.sales * factor,
    unitsSold: b.unitsSold * factor,
    impressions: b.impressions * factor,
    clicks: b.clicks * factor,
    spends: b.spends * factor,
    adSales: b.adSales * factor,
    adUnits: b.adUnits * factor,
    pageViews: b.pageViews == null ? null : b.pageViews * factor,
  };
}

/** Ad-only metric set (rule book §7 ad-side) for views with no sales denominator. */
export interface AdBase {
  impressions: number;
  clicks: number;
  spend: number;
  adSales: number;
  adUnits: number;
}

export interface AdMetrics extends AdBase {
  ctrPct: number | null;
  cpc: number | null;
  crPct: number | null;
  acosPct: number | null;
  adAov: number | null;
}

export function emptyAdBase(): AdBase {
  return { impressions: 0, clicks: 0, spend: 0, adSales: 0, adUnits: 0 };
}

export function addAdBase(a: AdBase, b: AdBase): AdBase {
  return {
    impressions: a.impressions + b.impressions,
    clicks: a.clicks + b.clicks,
    spend: a.spend + b.spend,
    adSales: a.adSales + b.adSales,
    adUnits: a.adUnits + b.adUnits,
  };
}

export function deriveAd(b: AdBase): AdMetrics {
  return {
    ...b,
    ctrPct: pct(b.clicks, b.impressions),
    cpc: ratio(b.spend, b.clicks),
    crPct: pct(b.adUnits, b.clicks),
    acosPct: pct(b.spend, b.adSales),
    adAov: ratio(b.adSales, b.adUnits),
  };
}
