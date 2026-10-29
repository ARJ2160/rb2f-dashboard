'use client';

import { METRICS, metricValue, type MetricKey, type Sums } from '@dash/shared/blinkit';

import { DASH, fmtAvg, fmtInt, fmtMoney, fmtPct } from '@/lib/format';

/** Blinkit metric value (null when the denominator is 0 / no data). */
export function bkVal(k: MetricKey, s: Sums): number | null {
  const v = metricValue(k, s);
  return Number.isFinite(v) ? v : null;
}

/** Same number formats as the Amazon tables. */
export function bkFmt(k: MetricKey, v: number | null): string {
  if (v == null) return DASH;
  switch (METRICS[k].fmt) {
    case 'inr':
    case 'inr1':
      return fmtMoney(v);
    case 'num':
      return fmtInt(v);
    case 'pct':
    case 'pct2':
      return fmtPct(v);
    case 'x2':
      return v.toFixed(2);
    case 'pos':
      return fmtAvg(v);
  }
}
export const bkShow = (k: MetricKey, s: Sums) => bkFmt(k, bkVal(k, s));

/** Change vs the comparison period; volumes are compared per day when the two windows differ in length. */
export function BkDelta({ k, cur, prev, daysA = 1, daysB = 1 }: { k: MetricKey; cur: Sums; prev: Sums | null | undefined; daysA?: number; daysB?: number }) {
  if (!prev) return <div className="text-[10px] text-muted">—</div>;
  const per = METRICS[k].additive && daysA !== daysB;
  const a = bkVal(k, cur), b = bkVal(k, prev);
  if (a == null || b == null) return <div className="text-[10px] text-muted">—</div>;
  if (b === 0) return <div className="text-[10px] text-muted">{a === 0 ? '0%' : 'new'}</div>;
  const d = ((a / (per ? daysA : 1) - b / (per ? daysB : 1)) / Math.abs(b / (per ? daysB : 1))) * 100;
  const flat = Math.abs(d) < 0.05;
  const good = METRICS[k].higherIsBetter ? d > 0 : d < 0;
  return (
    <div className={`num text-[10px] ${flat ? 'text-muted' : good ? 'text-good' : 'text-bad'}`}>
      {flat ? '±0%' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%${per ? '/day' : ''}`}
    </div>
  );
}

/** Numeric cell, with the comparison value and change underneath when comparing. */
export function BkCell({ k, s, prev, comparing, daysA, daysB, className = '' }: {
  k: MetricKey;
  s: Sums;
  prev?: Sums | null | undefined;
  comparing: boolean;
  daysA?: number;
  daysB?: number;
  className?: string;
}) {
  return (
    <td className={`num whitespace-nowrap px-3 py-1.5 text-right align-top ${className}`}>
      {bkShow(k, s)}
      {comparing && (
        <>
          <div className="text-[10px] text-muted">{prev ? bkShow(k, prev) : DASH}</div>
          <BkDelta k={k} cur={s} prev={prev} daysA={daysA} daysB={daysB} />
        </>
      )}
    </td>
  );
}

export const TH = 'whitespace-nowrap px-3 py-2 text-right font-medium';
export const TH_LEFT = 'sticky left-0 z-30 bg-base-200 px-3 py-2 text-left font-medium';
export const ROW = 'border-b border-line/60 odd:bg-surface even:bg-stripe hover:bg-accent-soft';
export const TD_LEFT = 'sticky left-0 z-10 whitespace-nowrap bg-inherit px-3 py-1.5';

/** The comparison window state shared by Category / City / Keywords (period B, or null). */
export interface BkViewProps {
  profileId: string;
  from: string;
  to: string;
  category: string;
  compare: { from: string; to: string } | null;
}
export const days = (p: { from: string; to: string }) => Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
