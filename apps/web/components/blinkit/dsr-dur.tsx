'use client';

import { AD_TYPE_LABEL, blank, type BkDailyResponse, type MetricKey } from '@dash/shared/blinkit';
import type { DurResponse } from '@dash/shared';
import { useEffect, useState } from 'react';

import { DurTable } from '@/components/dur-table';
import { ErrorBox, Notes } from '@/components/notes';
import { fmtDateLong, fmtMoney, fmtPct } from '@/lib/format';

import { bkShow, ROW, TD_LEFT, TH, TH_LEFT } from './cells';
import { useQc } from './qc-context';

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

/** DSR columns — the quick-commerce equivalents of the Amazon DSR. Columns a marketplace doesn't report
    (Blinkit: clicks / CTR / CPC; Instamart: orders / AOV / new users) are dropped per flavour. */
export const DSR_COLS: Array<{ k: MetricKey; label: string }> = [
  { k: 'rev', label: 'Sales' },
  { k: 'units', label: 'Units Sold' },
  { k: 'orders', label: 'Orders' },
  { k: 'aov', label: 'AOV' },
  { k: 'impr', label: 'Impressions' },
  { k: 'clicks', label: 'Clicks' },
  { k: 'ctr', label: 'CTR' },
  { k: 'cpc', label: 'CPC' },
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
  { k: 'mvp', label: 'Avg Ad Rank' },
];

/** PL / PR / BL split of ad spend for the range (Blinkit's SP / SB / SD cards). */
function AdTypeSplit({ data }: { data: BkDailyResponse }) {
  const { flavour } = useQc();
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
            {c.adType === 'BL' && flavour.id === 'blinkit'
              ? `Impressions ${Math.round(c.impr).toLocaleString('en-IN')} · banners report no sales`
              : `Ad Sales ${fmtMoney(c.asales)} · ACoS ${c.asales ? fmtPct((c.spend / c.asales) * 100) : '—'}`}
          </div>
        </div>
      ))}
    </div>
  );
}

export function DsrView(p: RangeProps) {
  const { api, flavour, show } = useQc();
  const { data, error, loading } = useLoad(() => api.dsr(p.profileId, p), [p.profileId, p.from, p.to, p.category, flavour.id]);
  // Avg Ad Rank only where the report has one (Instamart); Blinkit's "most viewed position" stays in Keywords.
  const cols = DSR_COLS.filter((c) => show(c.k) && (c.k !== 'mvp' || flavour.id === 'instamart')).map((c) => ({ ...c, label: flavour.labels[c.k] ?? c.label }));
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
              {cols.map((c) => (
                <th key={c.k} className={TH}>
                  {c.label}
                </th>
              ))}
            </tr>
            <tr className="bg-accent-soft font-semibold">
              <td className="sticky left-0 z-30 bg-accent-soft px-3 py-1.5">TOTAL</td>
              {cols.map((c) => (
                <td key={c.k} className="num whitespace-nowrap px-3 py-1.5 text-right">
                  {bkShow(c.k, data.total)}
                </td>
              ))}
            </tr>
            <tr className="border-b border-line bg-canvas font-medium">
              <td className="sticky left-0 z-30 bg-canvas px-3 py-1.5">AVG</td>
              {/* volumes ÷ days; ratios are the TOTAL ratio (computed from sums, never averaged) */}
              {cols.map((c) => (
                <td key={c.k} className="num whitespace-nowrap px-3 py-1.5 text-right">
                  {bkShow(c.k, ['aov', 'atcr', 'cpm', 'cvr', 'acos', 'tacos', 'roas', 'ctr', 'cpc', 'mvp'].includes(c.k) ? data.total : avg)}
                </td>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ d, s }) => (
              <tr key={d} className={ROW}>
                <td className={TD_LEFT}>{fmtDateLong(d)}</td>
                {cols.map((c) => (
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
          flavour.id === 'instamart'
            ? 'Sales = GMV of the Instamart sales export · Ad Sales = TOTAL_GMV · Ad Conversions = TOTAL_CONVERSIONS · Spends = TOTAL_BUDGET_BURNT · Organic = Sales − Ad Sales · Ad CR % = Conversions ÷ ATC · TACoS = Spends ÷ Sales · Avg Ad Rank is impression-weighted. No order IDs in the export, so no Orders / AOV.'
            : 'Sales = Total Gross Bill Amount · Ad Sales / Ad Units / ATC = direct + indirect · Spends = Estimated Budget Consumed · Organic = Sales − Ad Sales · Ad CR % = Ad Units ÷ ATC · TACoS = Spends ÷ Sales.',
        ]}
      />
    </div>
  );
}

export function DurView(p: RangeProps) {
  const { api, flavour, show } = useQc();
  const [metric, setMetric] = useState<'units' | 'orders' | 'revenue'>('units');
  const { data, error, loading } = useLoad<DurResponse>(() => api.dur(p.profileId, p, metric), [p.profileId, p.from, p.to, p.category, metric, flavour.id]);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-xs text-muted">Values</span>
        <div className="join">
          {(['units', 'orders', 'revenue'] as const).filter((m) => m !== 'orders' || show('orders')).map((m) => (
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
          <DurTable data={data} idLabel={flavour.id === 'instamart' ? 'Item Code' : 'Item ID'} nameLabel="SKU · item name" />
          <Notes notes={data.notes} />
        </>
      )}
    </div>
  );
}
