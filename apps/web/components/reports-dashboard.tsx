'use client';

import type { CoverageResponse, DsrResponse, DurMetric, DurResponse } from '@dash/shared';
import { useEffect, useState, type ReactNode } from 'react';

import { ChannelSplit, DsrTable } from '@/components/dsr-table';
import { DateRangePicker } from '@/components/date-picker';
import { DurTable } from '@/components/dur-table';
import { ErrorBox, Notes } from '@/components/notes';
import { getCoverage, getDsr, getDur } from '@/lib/api';
import { fmtDateLong, isoAddDays, isoToday } from '@/lib/format';
import { CategoryView } from '@/components/views/category-view';
import { PlacementsView } from '@/components/views/placements-view';
import { SearchTermsView } from '@/components/views/search-terms-view';
import { SqpView } from '@/components/views/sqp-view';
import { StatesView } from '@/components/views/states-view';
import { AdsView } from '@/components/views/ads-view';
import { HourlyView } from '@/components/views/hourly-view';
import { SummaryView } from '@/components/views/summary-view';
import { Select, type Period } from '@/components/views/shared';

type Tab = 'summary' | 'dsr' | 'dur' | 'category' | 'search' | 'sqp' | 'placement' | 'state' | 'ads' | 'hourly';

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'summary', label: 'MoM / WoW', hint: 'Month-to-date vs last month, last 7 days vs the 7 before — as of the latest data' },
  { id: 'dsr', label: 'DSR', hint: 'Daily Sales Report — one row per date' },
  { id: 'dur', label: 'DUR', hint: 'Daily Units Report — ASIN × date' },
  { id: 'category', label: 'Category', hint: 'DSR columns by ASIN-mapper category' },
  { id: 'ads', label: 'Ads Analysis', hint: 'Ad types, targeting, Branded / Competitor / Generic' },
  { id: 'search', label: 'Search Terms', hint: 'SP + SB search terms, SD targets' },
  { id: 'sqp', label: 'SQP', hint: 'Search Query Performance — queries where the brand beats the category but isn\'t targeted yet' },
  { id: 'placement', label: 'Placements', hint: 'SP + SB by Top of Search / Rest of Search / Product Pages' },
  { id: 'state', label: 'State Wise Data', hint: 'Sales and units by ship-to state' },
  { id: 'hourly', label: 'Hour-wise', hint: 'Ad metrics by hour of day' },
];

/** Days in an inclusive ISO range. */
function spanDays(p: Period) {
  return Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
}

/** The equal-length period immediately before `p`. */
function previousPeriod(p: Period): Period {
  const n = spanDays(p);
  return { from: isoAddDays(p.from, -n), to: isoAddDays(p.from, -1) };
}

/** Default window: the last 30 days that actually have data. */
function defaultRange(c: CoverageResponse | null): { from: string; to: string } {
  const latest =
    c?.sources
      .map((s) => s.to)
      .filter((d): d is string => !!d)
      .sort()
      .at(-1) ?? isoToday();
  const earliest =
    c?.sources
      .map((s) => s.from)
      .filter((d): d is string => !!d)
      .sort()[0] ?? latest;
  const from = isoAddDays(latest, -29);
  return { from: from < earliest ? earliest : from, to: latest };
}

/**
 * Every report tab (DSR, DUR, Category, Search Terms, …) for one profile.
 * Used by /reports (uploaded data) and /gcs (GCS warehouse data).
 */
export function ReportsDashboard({
  profileId,
  title = 'Reports',
  subtitle,
  emptyState,
}: {
  profileId: string;
  title?: string;
  subtitle?: ReactNode;
  /** Shown when the profile has no data at all. */
  emptyState: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('summary');
  const [coverage, setCoverage] = useState<CoverageResponse | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  const [metric, setMetric] = useState<DurMetric>('units');
  const [dsr, setDsr] = useState<DsrResponse | null>(null);
  const [dur, setDur] = useState<DurResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [compareOn, setCompareOn] = useState(false);
  const [compareRange, setCompareRange] = useState<Period | null>(null);

  // Coverage → initial date range (re-run when the profile changes).
  useEffect(() => {
    let alive = true;
    setRange(null);
    getCoverage(profileId)
      .then((c) => alive && (setCoverage(c), setRange(defaultRange(c))))
      .catch((e: Error) => alive && (setError(e.message), setRange(defaultRange(null))));
    return () => {
      alive = false;
    };
  }, [profileId]);

  useEffect(() => {
    if (!range || range.from > range.to || (tab !== 'dsr' && tab !== 'dur')) return;
    let alive = true;
    setLoading(true);
    setError(null);
    const req =
      tab === 'dsr'
        ? getDsr(profileId, range.from, range.to, category).then((d) => alive && setDsr(d))
        : getDur(profileId, range.from, range.to, metric, category).then((d) => alive && setDur(d));
    req.catch((e: Error) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId, tab, range, metric, category]);

  const hasAnyData = coverage?.sources.some((s) => s.days > 0);
  // MoM / WoW and SQP choose their own periods, so the date range doesn't apply to them.
  const isSummary = tab === 'summary' || tab === 'sqp';
  const isView = tab !== 'dsr' && tab !== 'dur' && !isSummary;
  const compare: Period | null =
    isView && compareOn && compareRange && compareRange.from <= compareRange.to ? compareRange : null;
  const toggleCompare = () => {
    if (!compareOn && range) setCompareRange(previousPeriod(range));
    setCompareOn(!compareOn);
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
          <p className="text-xs text-muted">{subtitle ?? `Profile: ${profileId}`}</p>
        </div>

        <div className="tabs tabs-border basis-full flex-wrap border-b border-line" role="tablist">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              aria-selected={tab === t.id}
              title={t.hint}
              onClick={() => setTab(t.id)}
              className={`tab ${tab === t.id ? 'tab-active font-medium text-accent' : 'text-muted'}`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {range && !isSummary && (
          <DateRangePicker value={range} onChange={setRange} />
        )}

        {range && isView && (
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" className="checkbox checkbox-xs checkbox-primary" checked={compareOn} onChange={toggleCompare} />
              Compare with
            </label>
            {compareOn && compareRange && (
              <>
                <DateRangePicker value={compareRange} onChange={setCompareRange} />
                <button
                  onClick={() => setCompareRange(previousPeriod(range))}
                  className="btn btn-link btn-xs px-0"
                  title="Equal-length period just before the selected range"
                >
                  Previous period
                </button>
              </>
            )}
          </div>
        )}

        {!isView && !isSummary && (
          <Select
            label="Category"
            value={category}
            onChange={setCategory}
            options={(tab === 'dsr' ? dsr?.categories : dur?.categories) ?? (category ? [category] : [])}
          />
        )}

        {tab === 'dur' && (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-xs text-muted">Values</span>
            <div className="join">
              {(['units', 'orders'] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMetric(m)}
                  className={`btn btn-sm join-item ${metric === m ? 'btn-primary' : 'font-normal'}`}
                >
                  {m === 'units' ? 'Units sold' : 'Orders'}
                </button>
              ))}
            </div>
          </div>
        )}

        {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
      </div>

      {coverage && !hasAnyData && tab !== 'sqp' && (
        <div className="rounded-box border border-line bg-surface px-4 py-6 text-sm shadow-sm">{emptyState}</div>
      )}

      {coverage && hasAnyData && <CoverageStrip coverage={coverage} />}
      {error && <ErrorBox message={error} />}

      {tab === 'summary' && <SummaryView profileId={profileId} />}
      {tab === 'sqp' && <SqpView profileId={profileId} />}
      {tab === 'dsr' && dsr && (
        <>
          <ChannelSplit data={dsr} />
          <DsrTable data={dsr} />
          <Notes notes={dsr.notes} />
        </>
      )}
      {range && range.from <= range.to && (
        <>
          {tab === 'category' && (
            <CategoryView profileId={profileId} from={range.from} to={range.to} compare={compare} />
          )}
          {tab === 'search' && (
            <SearchTermsView profileId={profileId} from={range.from} to={range.to} compare={compare} />
          )}
          {tab === 'placement' && (
            <PlacementsView profileId={profileId} from={range.from} to={range.to} compare={compare} />
          )}
          {tab === 'state' && (
            <StatesView profileId={profileId} from={range.from} to={range.to} compare={compare} />
          )}
          {tab === 'ads' && (
            <AdsView profileId={profileId} from={range.from} to={range.to} compare={compare} />
          )}
          {tab === 'hourly' && (
            <HourlyView profileId={profileId} from={range.from} to={range.to} compare={compare} />
          )}
        </>
      )}
      {tab === 'dur' && dur && (
        <>
          <DurTable data={dur} />
          <Notes notes={dur.notes} />
        </>
      )}
    </div>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  seller: 'Seller Central',
  vendor: 'Vendor Central',
  ads_sp: 'SP',
  ads_sb: 'SB',
  ads_sd: 'SD',
};

function CoverageStrip({ coverage }: { coverage: CoverageResponse }) {
  const rate = coverage.asinMapper.matchRatePct;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
      {coverage.sources
        .filter((s) => s.days > 0)
        .map((s) => (
          <span key={s.source}>
            <span className="font-medium text-ink">{SOURCE_LABEL[s.source] ?? s.source}</span>{' '}
            {fmtDateLong(s.from!)} – {fmtDateLong(s.to!)} ({s.days}d)
          </span>
        ))}
      <span className={rate != null && rate < 50 ? 'font-medium text-warn' : ''}>
        ASIN mapper match: {rate == null ? '—' : `${rate.toFixed(0)}%`} ({coverage.asinMapper.mappedAsins}/
        {coverage.asinMapper.asinsWithSales})
      </span>
    </div>
  );
}
