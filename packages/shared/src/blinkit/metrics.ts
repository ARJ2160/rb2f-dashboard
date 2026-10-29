/* Only additive raw sums travel over the API. Every ratio is derived here from
   sums, so any date range / city / category aggregates correctly. */

export interface Sums {
  rev: number;      // Total Gross Bill Amount
  units: number;    // Quantity
  orders: number;   // distinct Order Id
  impr: number;     // Impressions
  atc: number;      // Direct + Indirect ATC
  aunits: number;   // Direct + Indirect Quantities Sold
  asales: number;   // Direct + Indirect Sales
  dsales: number;   // Direct Sales
  spend: number;    // Estimated Budget Consumed
  nu: number;       // New Users Acquired
  mvpw: number;     // Σ(Most Viewed Position × Impressions)
  mvpi: number;     // Σ Impressions of rows that carry a position
}

export const blank = (): Sums => ({
  rev: 0, units: 0, orders: 0, impr: 0, atc: 0, aunits: 0, asales: 0, dsales: 0, spend: 0, nu: 0, mvpw: 0, mvpi: 0,
});

export function addInto(t: Sums, a: Partial<Sums>): Sums {
  for (const k of Object.keys(t) as (keyof Sums)[]) t[k] += Number(a[k] ?? 0);
  return t;
}

const div = (a: number, b: number) => (b ? a / b : NaN);

export type MetricKey =
  | 'rev' | 'orders' | 'units' | 'aov' | 'spend' | 'asales' | 'dsales' | 'organic' | 'acos' | 'tacos' | 'roas'
  | 'impr' | 'cpm' | 'atc' | 'atcr' | 'cvr' | 'aunits' | 'mvp' | 'nu' | 'adshare'
  | 'asp' | 'troas' | 'orgshare' | 'cpa';

export type Fmt = 'inr' | 'inr1' | 'num' | 'pct' | 'pct2' | 'x2' | 'pos';

export interface MetricDef {
  label: string;
  fmt: Fmt;
  get: (a: Sums) => number;
  /** true when a higher value is better (drives delta colour) */
  higherIsBetter: boolean;
  /** additive metrics are compared per-day when windows differ in length */
  additive?: boolean;
  /** needs sales data / needs ads data */
  needs: 'sales' | 'ads' | 'both';
}

export const METRICS: Record<MetricKey, MetricDef> = {
  rev:     { label: 'Revenue',        fmt: 'inr',  get: (a) => a.rev,                      higherIsBetter: true,  additive: true, needs: 'sales' },
  orders:  { label: 'Orders',         fmt: 'num',  get: (a) => a.orders,                   higherIsBetter: true,  additive: true, needs: 'sales' },
  units:   { label: 'Units',          fmt: 'num',  get: (a) => a.units,                    higherIsBetter: true,  additive: true, needs: 'sales' },
  aov:     { label: 'AOV',            fmt: 'inr',  get: (a) => div(a.rev, a.orders),       higherIsBetter: true,  needs: 'sales' },
  spend:   { label: 'Spend',          fmt: 'inr',  get: (a) => a.spend,                    higherIsBetter: false, additive: true, needs: 'ads' },
  asales:  { label: 'Ad Sales',       fmt: 'inr',  get: (a) => a.asales,                   higherIsBetter: true,  additive: true, needs: 'ads' },
  dsales:  { label: 'Direct Sales',   fmt: 'inr',  get: (a) => a.dsales,                   higherIsBetter: true,  additive: true, needs: 'ads' },
  organic: { label: 'Organic Sales',  fmt: 'inr',  get: (a) => (a.rev ? a.rev - a.asales : NaN), higherIsBetter: true, additive: true, needs: 'both' }, // no sales data → —
  acos:    { label: 'ACoS',           fmt: 'pct',  get: (a) => div(a.spend, a.asales) * 100, higherIsBetter: false, needs: 'ads' },
  tacos:   { label: 'TACoS',          fmt: 'pct',  get: (a) => div(a.spend, a.rev) * 100,  higherIsBetter: false, needs: 'both' },
  roas:    { label: 'ROAS',           fmt: 'x2',   get: (a) => div(a.asales, a.spend),     higherIsBetter: true,  needs: 'ads' },
  impr:    { label: 'Impressions',    fmt: 'num',  get: (a) => a.impr,                     higherIsBetter: true,  additive: true, needs: 'ads' },
  cpm:     { label: 'CPM',            fmt: 'inr1', get: (a) => div(a.spend, a.impr) * 1000, higherIsBetter: false, needs: 'ads' },
  atc:     { label: 'Add to Carts',   fmt: 'num',  get: (a) => a.atc,                      higherIsBetter: true,  additive: true, needs: 'ads' },
  atcr:    { label: 'ATC %',          fmt: 'pct2', get: (a) => div(a.atc, a.impr) * 100,   higherIsBetter: true,  needs: 'ads' },
  cvr:     { label: 'Conversion %',   fmt: 'pct',  get: (a) => div(a.aunits, a.atc) * 100, higherIsBetter: true,  needs: 'ads' },
  aunits:  { label: 'Ad Units',       fmt: 'num',  get: (a) => a.aunits,                   higherIsBetter: true,  additive: true, needs: 'ads' },
  mvp:     { label: 'Most Viewed Pos',fmt: 'pos',  get: (a) => div(a.mvpw, a.mvpi),        higherIsBetter: false, needs: 'ads' },
  nu:      { label: 'New Users',      fmt: 'num',  get: (a) => a.nu,                       higherIsBetter: true,  additive: true, needs: 'ads' },
  adshare: { label: 'Ad Contribution', fmt: 'pct',  get: (a) => div(a.asales, a.rev) * 100, higherIsBetter: false, needs: 'both' },
  orgshare:{ label: 'Organic Contribution', fmt: 'pct', get: (a) => div(a.rev - a.asales, a.rev) * 100, higherIsBetter: true, needs: 'both' },
  asp:     { label: 'ASP (₹/unit)',   fmt: 'inr',  get: (a) => div(a.rev, a.units),       higherIsBetter: true,  needs: 'sales' },
  troas:   { label: 'Total ROAS',     fmt: 'x2',   get: (a) => (a.rev ? div(a.rev, a.spend) : NaN), higherIsBetter: true, needs: 'both' },
  cpa:     { label: 'CPA (Spend/unit)', fmt: 'inr1', get: (a) => div(a.spend, a.units),  higherIsBetter: false, needs: 'both' },
};

export const metricValue = (k: MetricKey, a: Sums) => METRICS[k].get(a);

export function formatValue(fmt: Fmt, v: number): string {
  if (!Number.isFinite(v)) return '—';
  switch (fmt) {
    case 'inr': return '₹' + Math.round(v).toLocaleString('en-IN');
    case 'inr1': return '₹' + v.toLocaleString('en-IN', { maximumFractionDigits: 1 });
    case 'num': return Math.round(v).toLocaleString('en-IN');
    case 'pct': return v.toFixed(1) + '%';
    case 'pct2': return v.toFixed(2) + '%';
    case 'x2': return v.toFixed(2);
    case 'pos': return v.toFixed(1);
  }
}
export const fmtMetric = (k: MetricKey, a: Sums) => formatValue(METRICS[k].fmt, metricValue(k, a));

/** Δ% of A vs B. Additive metrics compare per-day when the windows differ. */
export function deltaPct(k: MetricKey, a: Sums, b: Sums | null, daysA = 1, daysB = 1): number | null {
  if (!b) return null;
  const per = METRICS[k].additive && daysA !== daysB;
  const va = metricValue(k, a) / (per ? daysA : 1);
  const vb = metricValue(k, b) / (per ? daysB : 1);
  if (!Number.isFinite(va) || !Number.isFinite(vb) || vb === 0) return null;
  return ((va - vb) / Math.abs(vb)) * 100;
}
