'use client';

import type { SummaryCompareResponse, SummaryResponse, SummaryRow } from '@dash/shared';
import { useEffect, useState } from 'react';

import { ErrorBox, Notes } from '@/components/notes';
import { getSummary, getSummaryCompare } from '@/lib/api';
import { DatePicker, DateRangePicker } from '@/components/date-picker';
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

/** Change as a soft pill: green = better, red = worse, grey = neutral (Ad Spends) or flat. */
function Change({ v, better }: { v: number | null; better: SummaryRow['better'] }) {
  if (v == null) return <span className="text-muted">—</span>;
  const good = better === 'none' || Math.abs(v) < 0.05 ? null : better === 'up' ? v > 0 : v < 0;
  const tone = good == null ? 'bg-black/[0.05] text-ink/75' : good ? 'bg-good/10 text-good' : 'bg-bad/10 text-bad';
  return (
    <span className={`num relative inline-flex min-w-[76px] items-center justify-center gap-1 rounded-full px-2.5 py-0.5 text-[13px] font-medium ${tone}`}>
      <span className="text-[10px]" aria-hidden>
        {v > 0 ? '▲' : v < 0 ? '▼' : ''}
      </span>
      {Math.abs(v).toFixed(1)}%
      <span className="sr-only">{good == null ? '' : good ? '(better)' : '(worse)'}</span>
    </span>
  );
}

/** Two-line column head: period on top, its short name below. */
function PeriodHead({ range, name, first }: { range: string; name: string; first?: boolean }) {
  return (
    <th className={`whitespace-nowrap px-4 py-2.5 text-right font-normal ${first ? 'border-l border-line' : ''}`}>
      <div className="font-medium text-ink">{range}</div>
      <div className="text-xs text-muted">{name}</div>
    </th>
  );
}

/**
 * MoM / WoW summary — the default screen. MTD vs the same days last month and
 * the last 7 days vs the 7 before, all ending on the latest day with data.
 */
export function SummaryView({
  profileId,
  load = getSummary,
  compareLoad,
}: {
  profileId: string;
  /** Data source — defaults to the Amazon summary; the Blinkit view passes its own loader (same response shape). */
  load?: (profileId: string, f: { asOf?: string; category?: string }) => Promise<SummaryResponse>;
  /** Optional custom A-vs-B compare loader. When provided, a "Compare periods" section is shown. */
  compareLoad?: (
    profileId: string,
    f: { aFrom: string; aTo: string; bFrom: string; bTo: string; category?: string }
  ) => Promise<SummaryCompareResponse>;
}) {
  const [asOf, setAsOf] = useState('');
  const [category, setCategory] = useState('');
  const [data, setData] = useState<SummaryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Custom A-vs-B compare (like the analysis tabs).
  const [compareOn, setCompareOn] = useState(false);
  const [rangeA, setRangeA] = useState<{ from: string; to: string } | null>(null);
  const [rangeB, setRangeB] = useState<{ from: string; to: string } | null>(null);
  const [cmp, setCmp] = useState<SummaryCompareResponse | null>(null);
  const [cmpError, setCmpError] = useState<string | null>(null);
  const [cmpLoading, setCmpLoading] = useState(false);

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

  // Reset the manual date and compare state when switching profile.
  useEffect(() => {
    setAsOf('');
    setCompareOn(false);
    setRangeA(null);
    setRangeB(null);
  }, [profileId]);

  // Seed the A / B ranges from the MTD / PMTD windows once data is in.
  useEffect(() => {
    if (rangeA || !data?.periods) return;
    setRangeA({ from: data.periods.mtd.from, to: data.periods.mtd.to });
    setRangeB({ from: data.periods.pmtd.from, to: data.periods.pmtd.to });
  }, [data, rangeA]);

  // Load the compare data whenever the toggle, ranges or category change.
  useEffect(() => {
    if (!compareOn || !compareLoad || !rangeA || !rangeB || rangeA.from > rangeA.to || rangeB.from > rangeB.to) return;
    let alive = true;
    setCmpLoading(true);
    setCmpError(null);
    compareLoad(profileId, { aFrom: rangeA.from, aTo: rangeA.to, bFrom: rangeB.from, bTo: rangeB.to, category })
      .then((d) => alive && setCmp(d))
      .catch((e: Error) => alive && setCmpError(e.message))
      .finally(() => alive && setCmpLoading(false));
    return () => {
      alive = false;
    };
  }, [compareOn, compareLoad, profileId, rangeA, rangeB, category]);

  const p = data?.periods;
  const td = 'num whitespace-nowrap px-4 py-3 text-right';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2.5">
        <DatePicker prefix="As of" value={asOf || data?.asOf || ''} max={data?.autoAsOf} onChange={setAsOf} />
        {asOf && data?.autoAsOf && asOf !== data.autoAsOf && (
          <button onClick={() => setAsOf('')} className="btn btn-link btn-xs px-0 text-muted">
            Back to latest ({fmtDateLong(data.autoAsOf)})
          </button>
        )}
        <Select label="Category" value={category} onChange={setCategory} options={data?.categories ?? (category ? [category] : [])} />
        {compareLoad && (
          <label className="field cursor-pointer select-none">
            <input type="checkbox" className="checkbox checkbox-xs checkbox-primary" checked={compareOn} onChange={() => setCompareOn((v) => !v)} />
            <span className="font-medium">Compare periods</span>
          </label>
        )}
        {data?.asOf && !asOf && <span className="text-sm text-muted">Latest data: {fmtDateLong(data.asOf)}</span>}
        {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
      </div>

      {error && <ErrorBox message={error} />}

      {data && p && (
        <div className="space-y-2">
          <div className="overflow-x-auto rounded-xl border border-line bg-surface">
            <table className="w-full min-w-[820px] border-collapse text-sm">
              <thead className="bg-side text-muted">
                <tr className="border-b border-line">
                  <th rowSpan={2} className="sticky left-0 z-10 w-[230px] bg-side px-4 py-2.5 text-left align-bottom font-medium">
                    Metric
                  </th>
                  <th colSpan={3} className="border-l border-line px-4 pb-1 pt-2.5 text-left text-[13px] font-semibold text-ink">
                    Month on month
                  </th>
                  <th colSpan={3} className="border-l border-line px-4 pb-1 pt-2.5 text-left text-[13px] font-semibold text-ink">
                    Week on week
                  </th>
                </tr>
                <tr className="border-b border-line">
                  <PeriodHead range={p.mtd.label} name="MTD" first />
                  <PeriodHead range={p.pmtd.label} name="PMTD" />
                  <th className="px-4 py-2.5 text-center font-medium">Change</th>
                  <PeriodHead range={p.l7d.label} name="L7D" first />
                  <PeriodHead range={p.p7d.label} name="P7D" />
                  <th className="px-4 py-2.5 text-center font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.key} className="group border-b border-line/70 last:border-0 hover:bg-side/70">
                    <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-surface px-4 py-3 text-left font-medium text-ink group-hover:bg-side">
                      {r.label}
                    </th>
                    <td className={`${td} border-l border-line font-medium`}>{fmtValue(r.mtd, r.format)}</td>
                    <td className={`${td} text-ink/70`}>{fmtValue(r.pmtd, r.format)}</td>
                    <td className="px-4 py-3 text-center">
                      <Change v={r.mom} better={r.better} />
                    </td>
                    <td className={`${td} border-l border-line font-medium`}>{fmtValue(r.l7d, r.format)}</td>
                    <td className={`${td} text-ink/70`}>{fmtValue(r.p7d, r.format)}</td>
                    <td className="px-4 py-3 text-center">
                      <Change v={r.wow} better={r.better} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted">
            Green / red = better / worse (for ACOS% and TACOS% a decrease is better; Ad Spends is neutral). Ratios are recomputed from each
            period&apos;s totals, never averaged.
          </p>
        </div>
      )}

      {compareLoad && compareOn && rangeA && rangeB && (
        <div className="space-y-2 rounded-xl border border-line bg-surface p-4">
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-[13px] font-semibold text-ink">Compare periods</span>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <span className="font-medium text-ink">A</span>
              <DateRangePicker value={rangeA} onChange={setRangeA} />
            </label>
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <span className="font-medium text-ink">B</span>
              <DateRangePicker value={rangeB} onChange={setRangeB} />
            </label>
            {cmpLoading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
          </div>

          {cmpError && <ErrorBox message={cmpError} />}

          {cmp && (
            <>
              <div className="overflow-x-auto rounded-xl border border-line bg-surface">
                <table className="w-full min-w-[560px] border-collapse text-sm">
                  <thead className="bg-side text-muted">
                    <tr className="border-b border-line">
                      <th className="sticky left-0 z-10 w-[230px] bg-side px-4 py-2.5 text-left font-medium">Metric</th>
                      <PeriodHead range={cmp.a.label} name={`A · ${cmp.a.days}d`} first />
                      <PeriodHead range={cmp.b.label} name={`B · ${cmp.b.days}d`} />
                      <th className="px-4 py-2.5 text-center font-medium">Change</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cmp.rows.map((r) => (
                      <tr key={r.key} className="group border-b border-line/70 last:border-0 hover:bg-side/70">
                        <th scope="row" className="sticky left-0 z-10 whitespace-nowrap bg-surface px-4 py-3 text-left font-medium text-ink group-hover:bg-side">
                          {r.label}
                        </th>
                        <td className={`${td} border-l border-line font-medium`}>{fmtValue(r.a, r.format)}</td>
                        <td className={`${td} text-ink/70`}>{fmtValue(r.b, r.format)}</td>
                        <td className="px-4 py-3 text-center">
                          <Change v={r.change} better={r.better} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-muted">Change = period A vs period B. {cmp.a.label} compared with {cmp.b.label}.</p>
              {cmp.notes.length > 0 && <Notes notes={cmp.notes} />}
            </>
          )}
        </div>
      )}

      {data && <Notes notes={data.notes} />}
    </div>
  );
}
