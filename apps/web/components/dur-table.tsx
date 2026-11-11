'use client';

import type { DurResponse, DurRow } from '@dash/shared';
import { useMemo, useState } from 'react';

import { DASH, fmtAvg, fmtDay, fmtInt } from '@/lib/format';

/** Sortable numeric columns: the per-row Totals / Avg, or a specific date column. */
type SortCol = 'totals' | 'avg' | `d:${string}`;
interface SortState {
  col: SortCol;
  dir: 'asc' | 'desc';
}

const valueOf = (r: DurRow, col: SortCol): number | null =>
  col === 'totals' ? r.totals : col === 'avg' ? r.avg : r.values[col.slice(2)] ?? null;

/** ▲ / ▼ shown on the active sort column. */
function SortArrow({ active, dir }: { active: boolean; dir: 'asc' | 'desc' }) {
  return <span className={`ml-1 text-[9px] ${active ? 'text-ink' : 'text-transparent'}`} aria-hidden>{dir === 'asc' ? '▲' : '▼'}</span>;
}

export function DurTable({ data, idLabel = 'ASIN', nameLabel = 'Item-name' }: { data: DurResponse; idLabel?: string; nameLabel?: string }) {
  const [sort, setSort] = useState<SortState | null>(null);

  // Column totals (one per date) and the grand total across the whole range.
  const colTotals = useMemo(() => {
    const t: Record<string, number | null> = {};
    for (const d of data.dates) {
      let sum: number | null = null;
      for (const r of data.rows) {
        const v = r.values[d];
        if (v != null) sum = (sum ?? 0) + v;
      }
      t[d] = sum;
    }
    return t;
  }, [data]);
  const grandTotal = useMemo(() => data.rows.reduce((a, r) => a + (r.totals ?? 0), 0), [data]);
  const grandAvg = data.days ? grandTotal / data.days : null;

  // Default order comes from the API (missing-ASIN first, then Totals desc).
  // Clicking a numeric header sorts by that column; nulls always sink to the bottom.
  const rows = useMemo(() => {
    if (!sort) return data.rows;
    const dir = sort.dir === 'asc' ? 1 : -1;
    return [...data.rows].sort((a, b) => {
      const av = valueOf(a, sort.col);
      const bv = valueOf(b, sort.col);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  }, [data, sort]);

  const toggle = (col: SortCol) =>
    setSort((s) => (s && s.col === col ? { col, dir: s.dir === 'desc' ? 'asc' : 'desc' } : { col, dir: 'desc' }));

  if (data.rows.length === 0) {
    return <p className="rounded-box border border-line bg-surface shadow-sm px-4 py-8 text-center text-sm text-muted">No {idLabel === 'ASIN' ? 'ASIN' : 'item'} sales in this range.</p>;
  }

  const sortable = 'cursor-pointer select-none hover:text-ink';
  return (
    <div className="max-h-[70vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
      <table className="table table-sm w-auto">
        <thead className="sticky top-0 z-20 bg-base-200 shadow-[0_1px_0_var(--color-line)]">
          <tr className="text-xs text-muted">
            <th className="sticky left-0 z-30 w-32 min-w-32 bg-base-200 px-3 py-2 text-left font-medium">{idLabel}</th>
            <th className="sticky left-32 z-30 w-72 min-w-72 bg-base-200 px-3 py-2 text-left font-medium">{nameLabel}</th>
            <th className="px-3 py-2 text-left font-medium">Category</th>
            <th
              onClick={() => toggle('totals')}
              className={`bg-accent-soft px-3 py-2 text-right font-semibold text-ink ${sortable}`}
              title="Sort by total"
            >
              Totals<SortArrow active={sort?.col === 'totals'} dir={sort?.col === 'totals' ? sort.dir : 'desc'} />
            </th>
            <th
              onClick={() => toggle('avg')}
              className={`bg-canvas px-3 py-2 text-right font-medium text-ink ${sortable}`}
              title="Sort by average"
            >
              Avg<SortArrow active={sort?.col === 'avg'} dir={sort?.col === 'avg' ? sort.dir : 'desc'} />
            </th>
            {data.dates.map((d) => {
              const col: SortCol = `d:${d}`;
              return (
                <th
                  key={d}
                  onClick={() => toggle(col)}
                  className={`whitespace-nowrap px-3 py-2 text-right font-medium ${sortable}`}
                  title={`Sort by ${fmtDay(d)}`}
                >
                  {fmtDay(d)}<SortArrow active={sort?.col === col} dir={sort?.col === col ? sort.dir : 'desc'} />
                </th>
              );
            })}
          </tr>
          {/* Column totals: the whole-range total per day across every row. */}
          <tr className="border-b border-line bg-accent-soft/70 font-semibold">
            <td className="sticky left-0 z-30 w-32 min-w-32 bg-accent-soft/70 px-3 py-1.5 text-ink">TOTAL</td>
            <td className="sticky left-32 z-30 w-72 min-w-72 bg-accent-soft/70 px-3 py-1.5" />
            <td className="bg-accent-soft/70 px-3 py-1.5" />
            <td className="num bg-accent-soft px-3 py-1.5 text-right text-ink">{fmtInt(grandTotal)}</td>
            <td className="num bg-canvas px-3 py-1.5 text-right text-ink">{fmtAvg(grandAvg)}</td>
            {data.dates.map((d) => (
              <td key={d} className="num px-3 py-1.5 text-right text-ink">
                {colTotals[d] == null ? DASH : fmtInt(colTotals[d])}
              </td>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.asin ?? '__missing'} className="border-b border-line/60 odd:bg-surface even:bg-stripe hover:bg-accent-soft">
              <td className="sticky left-0 z-10 w-32 min-w-32 bg-inherit px-3 py-1.5 font-mono text-xs">
                {r.asin ?? <span className="text-warn">null</span>}
              </td>
              <td className="sticky left-32 z-10 w-72 min-w-72 max-w-72 truncate bg-inherit px-3 py-1.5" title={r.itemName ?? ''}>
                {r.itemName ?? <span className="text-muted">{DASH}</span>}
              </td>
              <td className={`whitespace-nowrap px-3 py-1.5 ${r.category === 'Unmapped' ? 'text-warn' : ''}`}>{r.category}</td>
              <td className="num bg-accent-soft/60 px-3 py-1.5 text-right font-semibold">{fmtInt(r.totals)}</td>
              <td className="num bg-canvas px-3 py-1.5 text-right">{fmtAvg(r.avg)}</td>
              {data.dates.map((d) => {
                const v = r.values[d];
                return (
                  <td key={d} className={`num px-3 py-1.5 text-right ${v ? '' : 'text-muted/60'}`}>
                    {v == null ? DASH : fmtInt(v)}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
