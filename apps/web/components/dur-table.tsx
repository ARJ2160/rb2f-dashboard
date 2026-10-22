import type { DurResponse } from '@dash/shared';

import { DASH, fmtAvg, fmtDay, fmtInt } from '@/lib/format';

export function DurTable({ data }: { data: DurResponse }) {
  if (data.rows.length === 0) {
    return <p className="rounded-md border border-line bg-surface px-4 py-8 text-center text-sm text-muted">No ASIN sales in this range.</p>;
  }
  return (
    <div className="max-h-[70vh] overflow-auto rounded-md border border-line bg-surface">
      <table className="border-collapse text-sm">
        <thead className="sticky top-0 z-20 bg-surface shadow-[0_1px_0_var(--color-line)]">
          <tr className="text-xs text-muted">
            <th className="sticky left-0 z-30 w-32 min-w-32 bg-surface px-3 py-2 text-left font-medium">ASIN</th>
            <th className="sticky left-32 z-30 w-72 min-w-72 bg-surface px-3 py-2 text-left font-medium">Item-name</th>
            <th className="px-3 py-2 text-left font-medium">Category</th>
            <th className="bg-accent-soft px-3 py-2 text-right font-semibold text-ink">Totals</th>
            <th className="bg-canvas px-3 py-2 text-right font-medium text-ink">Avg</th>
            {data.dates.map((d) => (
              <th key={d} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                {fmtDay(d)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.asin ?? '__missing'} className="border-b border-line/60 hover:bg-canvas">
              <td className="sticky left-0 z-10 w-32 min-w-32 bg-surface px-3 py-1.5 font-mono text-xs">
                {r.asin ?? <span className="text-warn">null</span>}
              </td>
              <td className="sticky left-32 z-10 w-72 min-w-72 max-w-72 truncate bg-surface px-3 py-1.5" title={r.itemName ?? ''}>
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
