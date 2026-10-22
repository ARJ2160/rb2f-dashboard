'use client';

import type { AdFilterOptions, AdMetrics } from '@dash/shared';
import { useEffect, useState, type ReactNode } from 'react';

import { ErrorBox, Notes } from '@/components/notes';
import { fmtInt, fmtMoney, fmtPct } from '@/lib/format';

export interface Period {
  from: string;
  to: string;
}

export interface RangeProps extends Period {
  profileId: string;
  /** Second period to compare against, or null when comparison is off. */
  compare: Period | null;
}

/**
 * Fetch period A (and B when comparing) on every dependency change, ignoring
 * stale responses.
 */
export function useCompareReport<T>(load: (p: Period) => Promise<T>, deps: unknown[], props: RangeProps) {
  const [data, setData] = useState<T | null>(null);
  const [prev, setPrev] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const cmp = props.compare;
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    Promise.all([load({ from: props.from, to: props.to }), cmp ? load(cmp) : Promise.resolve(null)])
      .then(([a, b]) => {
        if (!alive) return;
        setData(a);
        setPrev(b);
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, props.profileId, props.from, props.to, cmp?.from, cmp?.to]);
  return { data, prev, error, loading };
}

export function ViewShell({ error, loading, notes, toolbar, children }: {
  error: string | null;
  loading: boolean;
  notes?: string[] | undefined;
  toolbar?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      {(toolbar || loading) && (
        <div className="flex flex-wrap items-center gap-3">
          {toolbar}
          {loading && <span className="text-xs text-muted">Loading…</span>}
        </div>
      )}
      {error && <ErrorBox message={error} />}
      {children}
      {notes && notes.length > 0 && <Notes notes={notes} />}
    </div>
  );
}

export function Select({ label, value, onChange, options, allLabel = 'All' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | { value: string; label: string }>;
  allLabel?: string | null;
}) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 max-w-56 rounded-md border border-line bg-surface px-2 text-sm text-ink"
      >
        {allLabel !== null && <option value="">{allLabel}</option>}
        {options.map((o) => {
          const v = typeof o === 'string' ? o : o.value;
          return (
            <option key={v} value={v}>
              {typeof o === 'string' ? o : o.label}
            </option>
          );
        })}
      </select>
    </label>
  );
}

// ── Ad filters (category, ad type, targeting, branding) ─────────────

export interface AdFilterState {
  category: string;
  adType: string;
  targeting: string;
  branding: string;
}

export const EMPTY_AD_FILTERS: AdFilterState = { category: '', adType: '', targeting: '', branding: '' };

export function AdFilterBar({ value, onChange, options }: {
  value: AdFilterState;
  onChange: (v: AdFilterState) => void;
  options: AdFilterOptions | undefined;
}) {
  if (!options) return null;
  const set = (k: keyof AdFilterState) => (v: string) => onChange({ ...value, [k]: v });
  return (
    <>
      <Select label="Category" value={value.category} onChange={set('category')} options={options.categories} />
      <Select label="Ad type" value={value.adType} onChange={set('adType')} options={options.adTypes} />
      <Select label="Targeting" value={value.targeting} onChange={set('targeting')} options={options.targetings} />
      <Select label="Branding" value={value.branding} onChange={set('branding')} options={options.brandings} />
    </>
  );
}

// ── Comparison cells ────────────────────────────────────────────────

/** Metrics where a decrease is an improvement. */
const LOWER_IS_BETTER = new Set(['cpc', 'acosPct', 'tacosPct']);

export function Delta({ cur, prev, metric }: { cur: number | null | undefined; prev: number | null | undefined; metric?: string }) {
  if (cur == null || prev == null) return <div className="text-[10px] text-muted">—</div>;
  if (prev === 0) return <div className="text-[10px] text-muted">{cur === 0 ? '0%' : 'new'}</div>;
  const d = ((cur - prev) / Math.abs(prev)) * 100;
  if (!Number.isFinite(d)) return <div className="text-[10px] text-muted">—</div>;
  const good = LOWER_IS_BETTER.has(metric ?? '') ? d < 0 : d > 0;
  const flat = Math.abs(d) < 0.05;
  return (
    <div className={`num text-[10px] ${flat ? 'text-muted' : good ? 'text-good' : 'text-bad'}`}>
      {flat ? '±0%' : `${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%`}
    </div>
  );
}

/** A numeric table cell, with the change vs the comparison period underneath when comparing. */
export function MCell({ v, prev, fmt, metric, comparing, className = '' }: {
  v: number | null | undefined;
  prev?: number | null | undefined;
  fmt: (v: number | null) => string;
  metric?: string;
  comparing: boolean;
  className?: string;
}) {
  return (
    <td className={`num whitespace-nowrap px-3 py-1.5 text-right align-top ${className}`}>
      {fmt(v ?? null)}
      {comparing && (
        <>
          <div className="text-[10px] text-muted">{fmt(prev ?? null)}</div>
          <Delta cur={v} prev={prev} metric={metric} />
        </>
      )}
    </td>
  );
}

/** Ad-side columns (rule book §7). */
export const AD_COLUMNS: Array<{ key: keyof AdMetrics; label: string; fmt: (v: number | null) => string }> = [
  { key: 'impressions', label: 'Impressions', fmt: fmtInt },
  { key: 'clicks', label: 'Clicks', fmt: fmtInt },
  { key: 'spend', label: 'Spend', fmt: fmtMoney },
  { key: 'adSales', label: 'Ad Sales', fmt: fmtMoney },
  { key: 'adUnits', label: 'Ad Units', fmt: fmtInt },
  { key: 'adAov', label: 'Ad AOV', fmt: fmtMoney },
  { key: 'ctrPct', label: 'CTR %', fmt: fmtPct },
  { key: 'cpc', label: 'CPC', fmt: fmtMoney },
  { key: 'crPct', label: 'CR %', fmt: fmtPct },
  { key: 'acosPct', label: 'ACoS', fmt: fmtPct },
];

export function AdCells({ m, prev, comparing = false }: { m: AdMetrics; prev?: AdMetrics | undefined; comparing?: boolean }) {
  return (
    <>
      {AD_COLUMNS.map((c) => (
        <MCell
          key={c.key}
          v={m[c.key] as number | null}
          prev={prev ? (prev[c.key] as number | null) : null}
          fmt={c.fmt}
          metric={c.key}
          comparing={comparing}
        />
      ))}
    </>
  );
}

export function AdHeader() {
  return (
    <>
      {AD_COLUMNS.map((c) => (
        <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">
          {c.label}
        </th>
      ))}
    </>
  );
}

/** Metric picker for charts. */
export const CHART_METRICS: Array<{ value: keyof AdMetrics; label: string }> = AD_COLUMNS.map((c) => ({ value: c.key, label: c.label }));
export const fmtFor = (k: string) => AD_COLUMNS.find((c) => c.key === k)?.fmt ?? fmtMoney;

export function Card({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-md border border-line bg-surface p-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h3 className="text-sm font-semibold">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export const TABLE_WRAP = 'max-h-[70vh] overflow-auto rounded-md border border-line bg-surface';
export const THEAD = 'sticky top-0 z-20 bg-surface shadow-[0_1px_0_var(--color-line)]';
