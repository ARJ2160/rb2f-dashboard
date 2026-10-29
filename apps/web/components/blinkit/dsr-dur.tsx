'use client';

import { AD_TYPE_LABEL, blank, type BkDailyResponse, type MetricKey } from '@dash/shared/blinkit';
import type { DurResponse } from '@dash/shared';
import { useEffect, useState } from 'react';

import { DurTable } from '@/components/dur-table';
import { ErrorBox, Notes } from '@/components/notes';
import { bkDsr, bkDur } from '@/lib/blinkit-api';
import { fmtDateLong, fmtMoney, fmtPct } from '@/lib/format';

import { bkShow, ROW, TD_LEFT, TH, TH_LEFT } from './cells';

interface RangeProps {
  profileId: string;
  from: string;
  to: string;
  category: string;
}

function useLoad<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    load()
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return { data, error, loading };
}
export { useLoad };

/** DSR columns — the Blinkit equivalents of the Amazon DSR (no clicks / CPC / page views on Blinkit). */
export const DSR_COLS: Array<{ k: MetricKey; label: string }> = [
  { k: 'rev', label: 'Sales' },
  { k: 'units', label: 'Units Sold' },
  { k: 'orders', label: 'Orders' },
  { k: 'aov', label: 'AOV' },
  { k: 'impr', label: 'Impressions' },
  { k: 'atc', label: 'Add to Carts' },
  { k: 'atcr', label: 'ATC %' },
  { k: 'spend', label: 'Spends' },
  { k: 'cpm', label: 'CPM' },
  { k: 'asales', label: 'Ad Sales' },
  { k: 'aunits', label: 'Ad Units' },
  { k: 'cvr', label: 'Ad CR %' },
  { k: 'acos', label: 'ACoS' },
  { k: 'tacos', label: 'TACoS' },
  { k: 'roas', label: 'ROAS' },
  { k: 'organic', label: 'Organic Sales' },
  { k: 'nu', label: 'New Users' },
];

/** PL / PR / BL split of ad spend for the range (Blinkit's SP / SB / SD cards). */
function AdTypeSplit({ data }: { data: BkDailyResponse }) {
  const total = data.byAdType.reduce((a, c) => a + c.spend, 0);
  return (
    <div className="stats stats-vertical w-full border border-line bg-base-100 shadow-sm sm:stats-horizontal">
      {data.byAdType.map((c) => (
        <div key={c.adType} className="stat px-4 py-3">
          <div className="stat-title flex items-baseline justify-between gap-3 text-xs">
            <span className="font-semibold text-ink">{AD_TYPE_LABEL[c.adType] ?? c.adType}</span>
            <span className={c.days ? 'text-muted' : 'text-warn'}>{c.days ? `${c.days}/${data.dates.length} days` : 'no data'}</span>
          </div>
          <div className="stat-value num text-xl">
            {fmtMoney(c.spend)}
            <span className="ml-1.5 text-sm font-normal text-muted">{total ? fmtPct((c.spend / total) * 100) : '—'} of spend</span>
          </div>
          <div className="stat-desc num">
            {c.adType === 'BL'
              ? `Impressions ${Math.round(c.impr).toLocaleString('en-IN')} · banners report no sales`
              : `Ad Sales ${fmtMoney(c.asales)} · ACoS ${c.asales ? fmtPct((c.spend / c.asales) * 100) : '—'}`}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DsrView(p: RangeProps) {
  const { data, error, loading } = useLoad(() => bkDsr(p.profileId, p), [p.profileId, p.from, p.to, p.category]);
  if (error) return <ErrorBox message={error} />;
  if (!data) return loading ? <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" /> : null;
  const n = data.dates.length || 1;
  const avg = blank();
  for (const k of Object.keys(avg) as (keyof typeof avg)[]) avg[k] = data.total[k] / n;
  const rows = data.dates.map((d, i) => ({ d, s: data.series[i] ?? blank() })).reverse();
  return (
    <div className="space-y-3">
      <AdTypeSplit data={data} />
      <div className="max-h-[70vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
        <table className="table table-sm">
          <thead className="sticky top-0 z-20 bg-base-200 shadow-[0_1px_0_var(--color-line)]">
            <tr className="text-xs text-muted">
              <th className={TH_LEFT}>Date</th>
              {DSR_COLS.map((c) => (
                <th key={c.k} className={TH}>
                  {c.label}
                </th>
              ))}
            </tr>
            <tr className="bg-accent-soft font-semibold">
              <td className="sticky left-0 z-30 bg-accent-soft px-3 py-1.5">TOTAL</td>
              {DSR_COLS.map((c) => (
                <td key={c.k} className="num whitespace-nowrap px-3 py-1.5 text-right">
                  {bkShow(c.k, data.total)}
                </td>
              ))}
            </tr>
            <tr className="border-b border-line bg-canvas font-medium">
              <td className="sticky left-0 z-30 bg-canvas px-3 py-1.5">AVG</td>
              {/* volumes ÷ days; ratios are the TOTAL ratio (computed from sums, never averaged) */}
              {DSR_COLS.map((c) => (
                <td key={c.k} className="num whitespace-nowrap px-3 py-1.5 text-right">
                  {bkShow(c.k, ['aov', 'atcr', 'cpm', 'cvr', 'acos', 'tacos', 'roas'].includes(c.k) ? data.total : avg)}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ d, s }) => (
              <tr key={d} className={ROW}>
                <td className={TD_LEFT}>{fmtDateLong(d)}</td>
                {DSR_COLS.map((c) => (
                  <td key={c.k} className="num whitespace-nowrap px-3 py-1.5 text-right">
                    {bkShow(c.k, s)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Notes
        notes={[
          ...data.notes,
          'Sales = Total Gross Bill Amount · Ad Sales / Ad Units / ATC = direct + indirect · Spends = Estimated Budget Consumed · Organic = Sales − Ad Sales · Ad CR % = Ad Units ÷ ATC · TACoS = Spends ÷ Sales.',
        ]}
      />
    </div>
  );
}

export function DurView(p: RangeProps) {
  const [metric, setMetric] = useState<'units' | 'orders' | 'revenue'>('units');
  const { data, error, loading } = useLoad<DurResponse>(() => bkDur(p.profileId, p, metric), [p.profileId, p.from, p.to, p.category, metric]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs text-muted">Values</span>
        <div className="join">
          {(['units', 'orders', 'revenue'] as const).map((m) => (
            <button key={m} onClick={() => setMetric(m)} className={`btn btn-sm join-item ${metric === m ? 'btn-primary' : 'font-normal'}`}>
              {m === 'units' ? 'Units sold' : m === 'orders' ? 'Orders' : 'Sales'}
            </button>
          ))}
        </div>
        {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
      </div>
      {error && <ErrorBox message={error} />}
      {data && (
        <>
          <DurTable data={data} idLabel="Item ID" nameLabel="SKU · item name" />
          <Notes notes={data.notes} />
        </>
      )}
    </div>
  );
}
