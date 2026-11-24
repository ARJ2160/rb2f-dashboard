'use client';

import { METRICS, metricValue, type MetricKey, type Sums } from '@dash/shared/zepto';
import { useState, type ReactNode } from 'react';

import { bkShow, BkCell, ROW, TD_LEFT, TH, TH_LEFT } from '../blinkit/cells';

/* Shared building blocks for the Zepto views: a stat-card strip and a sortable
   metric table. Zepto reuses the quick-commerce metric cells (same `Sums`). */

/** Metrics Zepto's reports don't carry (no order IDs, no ad rank / new users). */
export const ZP_HIDDEN = new Set<MetricKey>(['orders', 'aov', 'nu', 'mvp', 'dsales']);
export const zShow = (k: MetricKey) => !ZP_HIDDEN.has(k);
export const zLabel = (k: MetricKey) => METRICS[k].label;

/** All Zepto metrics, in a sensible column order. */
export const ZP_ALL: MetricKey[] = [
  'rev',
  'units',
  'asp',
  'spend',
  'asales',
  'organic',
  'acos',
  'tacos',
  'roas',
  'troas',
  'impr',
  'clicks',
  'ctr',
  'cpc',
  'cpm',
  'atc',
  'atcr',
  'cvr',
  'aunits',
  'adshare',
  'cpa',
];

export function StatCards({ items, sums }: { items: MetricKey[]; sums: Sums }) {
  return (
    <div className="stats stats-vertical w-full border border-line bg-base-100 shadow-sm sm:stats-horizontal">
      {items.filter(zShow).map((k) => (
        <div key={k} className="stat px-4 py-3">
          <div className="stat-title text-xs">{zLabel(k)}</div>
          <div className="stat-value num text-lg">{bkShow(k, sums)}</div>
        </div>
      ))}
    </div>
  );
}

export interface MetricRow {
  key: string;
  /** small second line under the name (e.g. category, channel) */
  sub?: string | undefined;
  title?: string | undefined;
  sums: Sums;
}

/** Sortable table: a name column + a toggleable set of metric columns. Sorted client-side (asc/desc). */
export function MetricTable({
  rows,
  nameHeader,
  columns = ZP_ALL,
  defaultShown,
  defaultSort = 'spend',
  note,
  renderName,
}: {
  rows: MetricRow[];
  nameHeader: string;
  columns?: MetricKey[];
  defaultShown: MetricKey[];
  defaultSort?: MetricKey;
  note?: ReactNode;
  renderName?: (r: MetricRow) => ReactNode;
}) {
  const [shown, setShown] = useState<MetricKey[]>(defaultShown.filter(zShow));
  const [sort, setSort] = useState<MetricKey>(defaultSort);
  const [dir, setDir] = useState<'asc' | 'desc'>('desc');

  const val = (s: Sums) => {
    const v = metricValue(sort, s);
    return Number.isFinite(v) ? v : null;
  };
  const sorted = [...rows].sort((a, b) => {
    const x = val(a.sums),
      y = val(b.sums);
    if (x == null && y == null) return 0;
    if (x == null) return 1;
    if (y == null) return -1;
    return (x - y) * (dir === 'asc' ? 1 : -1);
  });
  const cols = columns.filter(zShow);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1">
        {cols.map((k) => (
          <button
            key={k}
            onClick={() => setShown(shown.includes(k) ? shown.filter((x) => x !== k) : [...shown, k])}
            className={`btn btn-xs ${shown.includes(k) ? 'btn-primary' : 'btn-outline border-line font-normal'}`}
          >
            {zLabel(k)}
          </button>
        ))}
      </div>
      <div className="max-h-[70vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
        <table className="table table-sm">
          <thead className="sticky top-0 z-20 bg-base-200 shadow-[0_1px_0_var(--color-line)]">
            <tr className="text-xs text-muted">
              <th className={TH_LEFT}>{nameHeader}</th>
              {cols
                .filter((k) => shown.includes(k))
                .map((k) => (
                  <th
                    key={k}
                    className={`${TH} cursor-pointer select-none`}
                    onClick={() => {
                      if (sort === k) setDir((d) => (d === 'desc' ? 'asc' : 'desc'));
                      else {
                        setSort(k);
                        setDir('desc');
                      }
                    }}
                    title="Sort by this column — click again to reverse"
                  >
                    {zLabel(k)}
                    {sort === k ? (dir === 'desc' ? ' ▾' : ' ▴') : ''}
                  </th>
                ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((r) => (
              <tr key={r.key} className={ROW}>
                <td className={TD_LEFT} title={r.title}>
                  {renderName ? (
                    renderName(r)
                  ) : (
                    <>
                      <div className="font-medium">{r.key}</div>
                      {r.sub && <div className="text-[11px] text-muted">{r.sub}</div>}
                    </>
                  )}
                </td>
                {cols
                  .filter((k) => shown.includes(k))
                  .map((k) => (
                    <BkCell key={k} k={k} s={r.sums} comparing={false} />
                  ))}
              </tr>
            ))}
            {sorted.length === 0 && (
              <tr>
                <td colSpan={cols.filter((k) => shown.includes(k)).length + 1} className="px-3 py-6 text-center text-sm text-muted">
                  No data for this selection.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {note}
    </div>
  );
}
