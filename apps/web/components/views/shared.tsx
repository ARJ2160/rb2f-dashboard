'use client';

import type { AdFilterOptions, AdMetrics } from '@dash/shared';
import { useEffect, useRef, useState, type ReactNode } from 'react';

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
          {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
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
    <label className="field cursor-pointer">
      <span className="text-xs text-muted">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="max-w-56 cursor-pointer bg-transparent pr-1 font-medium text-ink outline-none"
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

/**
 * Multi-select dropdown. Several values are held in one comma-separated string
 * (so it drops into the same CSV query param the API already splits on). Empty =
 * "All".
 */
export function MultiSelect({ label, value, onChange, options, allLabel = 'All' }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: Array<string | { value: string; label: string }>;
  allLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const opts = options.map((o) => (typeof o === 'string' ? { value: o, label: o } : o));
  const selected = new Set(value.split(',').map((s) => s.trim()).filter(Boolean));
  const toggle = (v: string) => {
    const next = new Set(selected);
    next.has(v) ? next.delete(v) : next.add(v);
    onChange(opts.filter((o) => next.has(o.value)).map((o) => o.value).join(','));
  };
  const summary =
    selected.size === 0
      ? allLabel
      : selected.size === 1
        ? opts.find((o) => selected.has(o.value))?.label ?? [...selected][0]
        : `${selected.size} selected`;

  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} className="field cursor-pointer">
        <span className="text-xs text-muted">{label}</span>
        <span className="max-w-56 truncate font-medium text-ink">{summary}</span>
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 text-muted" aria-hidden>
          <path d="M5.5 7.5 10 12l4.5-4.5" stroke="currentColor" strokeWidth="1.5" fill="none" />
        </svg>
      </button>
      {open && (
        <div className="absolute left-0 top-full z-50 mt-1 max-h-72 w-56 overflow-auto rounded-box border border-line bg-base-100 p-1 shadow-lg">
          <button
            type="button"
            onClick={() => onChange('')}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5 ${selected.size === 0 ? 'font-medium text-ink' : 'text-muted'}`}
          >
            <span className="grid size-4 place-items-center">{selected.size === 0 ? '•' : ''}</span>
            {allLabel}
          </button>
          {opts.map((o) => {
            const on = selected.has(o.value);
            return (
              <button
                key={o.value}
                type="button"
                onClick={() => toggle(o.value)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm hover:bg-black/5"
              >
                <input type="checkbox" checked={on} readOnly className="checkbox checkbox-xs checkbox-primary pointer-events-none" />
                <span className={`truncate ${on ? 'font-medium text-ink' : 'text-ink/80'}`}>{o.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Ad filters (category, ad type, targeting, branding) ─────────────

export interface AdFilterState {
  /** Comma-separated values when multi-select is on; a single value otherwise. */
  category: string;
  adType: string;
  targeting: string;
  branding: string;
}

export const EMPTY_AD_FILTERS: AdFilterState = { category: '', adType: '', targeting: '', branding: '' };

export function AdFilterBar({ value, onChange, options, multi = false }: {
  value: AdFilterState;
  onChange: (v: AdFilterState) => void;
  options: AdFilterOptions | undefined;
  /** Render multi-select dropdowns (ticked lists) instead of single-choice selects. */
  multi?: boolean;
}) {
  if (!options) return null;
  const set = (k: keyof AdFilterState) => (v: string) => onChange({ ...value, [k]: v });
  const Field = multi ? MultiSelect : Select;
  return (
    <>
      <Field label="Category" value={value.category} onChange={set('category')} options={options.categories} />
      <Field label="Ad type" value={value.adType} onChange={set('adType')} options={options.adTypes} />
      <Field label="Targeting" value={value.targeting} onChange={set('targeting')} options={options.targetings} />
      <Field label="Branding" value={value.branding} onChange={set('branding')} options={options.brandings} />
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
    <section className="rounded-xl border border-line bg-surface p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h3 className="text-[16px] font-semibold tracking-tight">{title}</h3>
        {right}
      </div>
      {children}
    </section>
  );
}

export const TABLE_WRAP = 'max-h-[70vh] overflow-auto rounded-xl border border-line bg-surface';
export const THEAD = 'sticky top-0 z-20 bg-side text-muted shadow-[0_1px_0_var(--color-line)]';
