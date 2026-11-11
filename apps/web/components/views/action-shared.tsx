'use client';

import type { RuleMetric, TermActionRow, TermRule } from '@dash/shared';
import type { ReactNode } from 'react';

import { fmtInt, fmtMoney, fmtPct } from '@/lib/format';

import { TABLE_WRAP, THEAD } from './shared';

const x2 = (v: number | null) => (v == null ? '—' : v.toFixed(2));

/** Metric columns shared by the negation / rule / bid-move tables (orders + ad metrics + ROAS). */
const COLUMNS: Array<{ key: string; label: string; fmt: (v: number | null) => string; get: (r: TermActionRow) => number | null }> = [
  { key: 'orders', label: 'Orders', fmt: fmtInt, get: (r) => r.orders },
  { key: 'impressions', label: 'Impressions', fmt: fmtInt, get: (r) => r.impressions },
  { key: 'clicks', label: 'Clicks', fmt: fmtInt, get: (r) => r.clicks },
  { key: 'spend', label: 'Spend', fmt: fmtMoney, get: (r) => r.spend },
  { key: 'adSales', label: 'Ad Sales', fmt: fmtMoney, get: (r) => r.adSales },
  { key: 'adUnits', label: 'Ad Units', fmt: fmtInt, get: (r) => r.adUnits },
  { key: 'ctrPct', label: 'CTR %', fmt: fmtPct, get: (r) => r.ctrPct },
  { key: 'cpc', label: 'CPC', fmt: fmtMoney, get: (r) => r.cpc },
  { key: 'crPct', label: 'CR %', fmt: fmtPct, get: (r) => r.crPct },
  { key: 'acosPct', label: 'ACoS', fmt: fmtPct, get: (r) => r.acosPct },
  { key: 'roas', label: 'ROAS', fmt: x2, get: (r) => r.roas },
];

/** Metrics the rule builder can test, with display labels. */
export const RULE_METRICS: Array<{ value: RuleMetric; label: string }> = [
  { value: 'impressions', label: 'Impressions' },
  { value: 'clicks', label: 'Clicks' },
  { value: 'spend', label: 'Spend' },
  { value: 'adSales', label: 'Ad Sales' },
  { value: 'adUnits', label: 'Ad Units' },
  { value: 'orders', label: 'Orders' },
  { value: 'ctrPct', label: 'CTR %' },
  { value: 'cpc', label: 'CPC' },
  { value: 'crPct', label: 'CR %' },
  { value: 'acosPct', label: 'ACoS %' },
  { value: 'roas', label: 'ROAS' },
];

/** The most-used four, pre-loaded into the builder. */
export const DEFAULT_RULE_METRICS: RuleMetric[] = ['clicks', 'spend', 'orders', 'acosPct'];
export const MAX_RULES = 4;

/** A rule as edited in the UI — value kept as a string so it can be left blank (blank = inactive). */
export interface UiRule {
  metric: RuleMetric;
  op: 'gte' | 'lte';
  value: string;
}

export const defaultUiRules = (): UiRule[] => DEFAULT_RULE_METRICS.map((metric) => ({ metric, op: 'gte', value: '' }));

/** The active (non-blank) rules as the API wants them. */
export const activeRules = (rules: UiRule[]): TermRule[] =>
  rules
    .filter((r) => r.value.trim() !== '' && Number.isFinite(Number(r.value)))
    .map((r) => ({ metric: r.metric, op: r.op, value: Number(r.value) }));

/** Table of flagged terms / targets. `leading` lets a view add a column before the metrics (e.g. a reason badge). */
export function ActionTable({
  rows,
  keyLabel,
  grain,
  emptyText,
  leading,
}: {
  rows: TermActionRow[];
  keyLabel: string;
  grain: 'term' | 'target';
  emptyText: string;
  leading?: { label: string; render: (r: TermActionRow) => ReactNode };
}) {
  if (rows.length === 0) {
    return <p className="rounded-xl border border-line bg-surface px-4 py-8 text-center text-sm text-muted">{emptyText}</p>;
  }
  return (
    <div className={TABLE_WRAP}>
      <table className="table table-sm">
        <thead className={THEAD}>
          <tr className="text-xs text-muted">
            <th className="sticky left-0 z-30 min-w-64 bg-side px-3 py-2 text-left font-medium">{keyLabel}</th>
            {grain === 'target' && <th className="px-3 py-2 text-left font-medium">Type</th>}
            <th className="px-3 py-2 text-left font-medium">Channel</th>
            {leading && <th className="px-3 py-2 text-left font-medium">{leading.label}</th>}
            {COLUMNS.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.key}|${r.matchType ?? ''}`} className="border-b border-line/60 align-top odd:bg-surface even:bg-stripe hover:bg-accent-soft">
              <td className="sticky left-0 z-10 max-w-80 bg-inherit px-3 py-1.5">
                <div className="truncate font-medium" title={r.key}>
                  {r.key}
                </div>
              </td>
              {grain === 'target' && (
                <td className="whitespace-nowrap px-3 py-1.5 text-xs">
                  {r.targetType}
                  {r.matchType ? <span className="ml-1 text-muted">· {r.matchType}</span> : null}
                </td>
              )}
              <td className="whitespace-nowrap px-3 py-1.5 text-xs">{r.channels}</td>
              {leading && <td className="whitespace-nowrap px-3 py-1.5">{leading.render(r)}</td>}
              {COLUMNS.map((c) => (
                <td key={c.key} className="num whitespace-nowrap px-3 py-1.5 text-right">
                  {c.fmt(c.get(r))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Add / edit / remove up to MAX_RULES metric conditions (metric · operator ·
 * value), all AND-combined. A row with a blank value is inactive, so the table
 * shows all data until you type a threshold.
 */
export function RuleBuilder({ rules, onChange }: { rules: UiRule[]; onChange: (r: UiRule[]) => void }) {
  const set = (i: number, patch: Partial<UiRule>) => onChange(rules.map((r, j) => (i === j ? { ...r, ...patch } : r)));
  const used = new Set(rules.map((r) => r.metric));
  const nextMetric = (RULE_METRICS.find((m) => !used.has(m.value)) ?? RULE_METRICS[0]!).value;
  const add = () => rules.length < MAX_RULES && onChange([...rules, { metric: nextMetric, op: 'gte', value: '' }]);
  const remove = (i: number) => onChange(rules.filter((_, j) => j !== i));
  const activeCount = rules.filter((r) => r.value.trim() !== '').length;

  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] font-semibold text-ink">
          Rules — a term/target must match all of them{' '}
          <span className="font-normal text-muted">(up to {MAX_RULES} metrics; blank = ignored)</span>
        </span>
        <button onClick={add} disabled={rules.length >= MAX_RULES} className="btn btn-sm btn-neutral">
          + Add metric
        </button>
      </div>
      <div className="space-y-2">
        {rules.map((r, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <select
              value={r.metric}
              onChange={(e) => set(i, { metric: e.target.value as RuleMetric })}
              className="select select-sm select-bordered w-40"
            >
              {RULE_METRICS.map((m) => (
                <option key={m.value} value={m.value} disabled={m.value !== r.metric && used.has(m.value)}>
                  {m.label}
                </option>
              ))}
            </select>
            <div className="join">
              <button
                onClick={() => set(i, { op: 'gte' })}
                className={`btn btn-sm join-item ${r.op === 'gte' ? 'btn-primary' : 'font-normal'}`}
                title="Greater than or equal to"
              >
                ≥
              </button>
              <button
                onClick={() => set(i, { op: 'lte' })}
                className={`btn btn-sm join-item ${r.op === 'lte' ? 'btn-primary' : 'font-normal'}`}
                title="Less than or equal to"
              >
                ≤
              </button>
            </div>
            <input
              type="number"
              value={r.value}
              placeholder="any"
              onChange={(e) => set(i, { value: e.target.value })}
              className="input input-sm input-bordered w-28"
              step="any"
            />
            <button onClick={() => remove(i)} className="btn btn-sm btn-ghost text-muted" aria-label="Remove rule">
              ✕
            </button>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">{activeCount === 0 ? 'Showing all data — type a value in any row to filter.' : `Filtering by ${activeCount} metric${activeCount === 1 ? '' : 's'}.`}</p>
    </div>
  );
}
