'use client';

import type { SummaryResponse, SummaryRow } from '@dash/shared';
import { useEffect, useState } from 'react';

import { ErrorBox, Notes } from '@/components/notes';
import { getSummary } from '@/lib/api';
import { DatePicker } from '@/components/date-picker';
import { fmtDateLong } from '@/lib/format';

import { Select } from './shared';

const rupee = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
const int = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

function fmtValue(v: number | null, format: SummaryRow['format']): string {
  if (v == null) return '—';
  switch (format) {
    case 'money':
      return `₹${rupee.format(v)}`;
    case 'int':
      return int.format(v);
    case 'pct':
      return `${v.toFixed(2)}%`;
    case 'ratio':
      return v.toFixed(2);
  }
}

function Change({ v, better }: { v: number | null; better: SummaryRow['better'] }) {
  if (v == null) return <span className="text-muted">—</span>;
  const good = better === 'none' || Math.abs(v) < 0.005 ? null : better === 'up' ? v > 0 : v < 0;
  return (
    <span className={good == null ? '' : good ? 'font-medium text-good' : 'font-medium text-bad'}>
      {v > 0 ? '▲ ' : v < 0 ? '▼ ' : ''}
      {Math.abs(v).toFixed(2)}%
    </span>
  );
}

/**
 * MoM / WoW summary — the default screen. MTD vs the same days last month and
 * the last 7 days vs the 7 before, all ending on the latest day with data.
 */
export function SummaryView({
  profileId,
  load = getSummary,
}: {
  profileId: string;
  /** Data source — defaults to the Amazon summary; the Blinkit view passes its own loader (same response shape). */
  load?: (profileId: string, f: { asOf?: string; category?: string }) => Promise<SummaryResponse>;
}) {
  const [asOf, setAsOf] = useState('');
  const [category, setCategory] = useState('');
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    load(profileId, { asOf, category })
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId, asOf, category, load]);

  // Reset the manual date when switching profile.
  useEffect(() => setAsOf(''), [profileId]);

  const p = data?.periods;
  const head = 'border border-head-line bg-head px-3 text-head-ink';
  const cell = 'num border border-line px-3 py-1.5 text-center';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-muted">
          As of
          <DatePicker value={asOf || data?.asOf || ''} max={data?.autoAsOf} onChange={setAsOf} />
        </div>
        {asOf && data?.autoAsOf && asOf !== data.autoAsOf && (
          <button onClick={() => setAsOf('')} className="btn btn-link btn-xs px-0">
            Back to latest ({fmtDateLong(data.autoAsOf)})
          </button>
        )}
        <Select label="Category" value={category} onChange={setCategory} options={data?.categories ?? (category ? [category] : [])} />
        {data?.asOf && !asOf && <span className="text-xs text-muted">Latest data: {fmtDateLong(data.asOf)}</span>}
        {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
      </div>

      {error && <ErrorBox message={error} />}

      {data && p && (
        <div className="overflow-x-auto">
          <table className="table table-sm w-auto min-w-[760px] bg-surface">
            <thead>
              <tr className="text-[15px] font-semibold">
                <th className={`${head} py-2`} />
                <th className={`${head} py-2`}>{p.mtd.label}</th>
                <th className={`${head} py-2`}>{p.pmtd.label}</th>
                <th className={`${head} py-2`}>MoM</th>
                <th className={`${head} py-2`}>{p.l7d.label}</th>
                <th className={`${head} py-2`}>{p.p7d.label}</th>
                <th className={`${head} py-2`}>WoW</th>
              </tr>
              <tr className="font-semibold">
                <th className={`${head} py-1.5 text-left`}>Metrics</th>
                <th className={`${head} py-1.5`}>MTD</th>
                <th className={`${head} py-1.5`}>PMTD</th>
                <th className={`${head} py-1.5`}>Change %</th>
                <th className={`${head} py-1.5`}>L7D</th>
                <th className={`${head} py-1.5`}>P7D</th>
                <th className={`${head} py-1.5`}>Change %</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.key} className="hover:bg-accent-soft">
                  <th className={`${head} whitespace-nowrap py-1.5 text-left font-semibold`}>{r.label}</th>
                  <td className={cell}>{fmtValue(r.mtd, r.format)}</td>
                  <td className={cell}>{fmtValue(r.pmtd, r.format)}</td>
                  <td className={cell}>
                    <Change v={r.mom} better={r.better} />
                  </td>
                  <td className={cell}>{fmtValue(r.l7d, r.format)}</td>
                  <td className={cell}>{fmtValue(r.p7d, r.format)}</td>
                  <td className={cell}>
                    <Change v={r.wow} better={r.better} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-muted">
            Green / red = better / worse (for ACOS% and TACOS% a decrease is better; Ad Spends is neutral). Ratios are recomputed from each
            period&apos;s totals, never averaged.
          </p>
        </div>
      )}

      {data && <Notes notes={data.notes} />}
    </div>
  );
}
