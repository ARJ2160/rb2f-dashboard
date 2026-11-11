'use client';

import type { CoverageResponse, DsrResponse, DurMetric, DurResponse } from '@dash/shared';
import { useEffect, useState, type ReactNode } from 'react';

import { DsrTable } from '@/components/dsr-table';
import { DateRangePicker } from '@/components/date-picker';
import { DurTable } from '@/components/dur-table';
import { ErrorBox, Notes } from '@/components/notes';
import { getCoverage, getDsr, getDur, getSummaryCompare } from '@/lib/api';
import { fmtDateLong, isoToday } from '@/lib/format';
import { CategoryView } from '@/components/views/category-view';
import { PlacementsView } from '@/components/views/placements-view';
import { SearchTermsView } from '@/components/views/search-terms-view';
import { SqpView } from '@/components/views/sqp-view';
import { HarvestView } from '@/components/views/harvest-view';
import { StatesView } from '@/components/views/states-view';
import { AdsView } from '@/components/views/ads-view';
import { HourlyView } from '@/components/views/hourly-view';
import { SummaryView } from '@/components/views/summary-view';
import { NegationsView } from '@/components/views/negations-view';
import { TermRulesView } from '@/components/views/term-rules-view';
// Targeting page hidden for now — restore this import with its tab + render block below.
// import { TargetingView } from '@/components/views/targeting-view';
import type { Period } from '@/components/views/shared';
import { AmazonOverview } from '@/components/views/overview-view';
import { DashboardShell, FieldSelect, PeriodPicker, SideCard, presetRange, type ShellTab } from '@/components/shell/dashboard-shell';
import { previousRange } from '@/components/shell/use-load';

type Tab =
  | 'summary'
  | 'overview'
  | 'dsr'
  | 'dur'
  | 'category'
  | 'search'
  | 'negations'
  | 'termrules'
  | 'targeting'
  | 'sqp'
  | 'harvest'
  | 'placement'
  | 'state'
  | 'ads'
  | 'hourly';

const TABS: Array<ShellTab<Tab>> = [
  { id: 'summary', label: 'Account Overview', hint: 'Month-to-date vs last month, last 7 days vs the 7 before, and a custom period compare', icon: 'mom', group: 'Performance' },
  { id: 'overview', label: 'Ads Overview', hint: 'Ad performance overview — tick metrics to plot their daily trend', icon: 'overview', group: 'Performance' },
  { id: 'dsr', label: 'DSR', hint: 'Daily Sales Report — one row per date', icon: 'dsr', group: 'Performance' },
  { id: 'dur', label: 'DUR', hint: 'Daily Units Report — ASIN × date', icon: 'dur', group: 'Performance' },
  { id: 'category', label: 'Category', hint: 'DSR columns by ASIN-mapper category', icon: 'category', group: 'Analysis' },
  { id: 'ads', label: 'Ads Analysis', hint: 'Ad types, targeting, Branded / Competitor / Generic', icon: 'ads', group: 'Analysis' },
  { id: 'placement', label: 'Placements', hint: 'SP + SB by Top of Search / Rest of Search / Product Pages', icon: 'placement', group: 'Analysis' },
  { id: 'state', label: 'State Wise Data', hint: 'Sales and units by ship-to state', icon: 'map', group: 'Analysis' },
  { id: 'hourly', label: 'Hour-wise', hint: 'Ad metrics by hour of day', icon: 'hourly', group: 'Analysis' },
  { id: 'search', label: 'Search Terms', hint: 'SP + SB search terms, SD targets', icon: 'search', group: 'Keywords' },
  { id: 'negations', label: 'Search Term Negations', hint: 'Terms with 0 orders & high clicks, or ACoS far above the account with few orders', icon: 'search', group: 'Keywords' },
  { id: 'termrules', label: 'Search Term Rules', hint: 'List search terms by your own metric rules (clicks, ACoS, ROAS, …)', icon: 'keywords', group: 'Keywords' },
  { id: 'harvest', label: 'Keyword Harvesting', hint: 'SP / SB search terms with multiple orders that are not manual targets yet', icon: 'harvest', group: 'Keywords' },
  // Targeting page hidden for now — uncomment to restore (also the import and render block).
  // { id: 'targeting', label: 'Targeting', hint: 'Target-level rules, bid reduction and bid scale-up (range > 3 days)', icon: 'ads', group: 'Keywords' },
  { id: 'sqp', label: 'SQP', hint: "Search Query Performance — queries where the brand beats the category but isn't targeted yet", icon: 'sqp', group: 'Keywords' },
];

/** Latest / earliest day any source has data. */
function bounds(c: CoverageResponse | null) {
  const latest = c?.sources.map((s) => s.to).filter((d): d is string => !!d).sort().at(-1) ?? null;
  const earliest = c?.sources.map((s) => s.from).filter((d): d is string => !!d).sort()[0] ?? null;
  return { latest, earliest };
}

/** Default window: this month (month-to-date), up to the latest day with data. */
function defaultRange(c: CoverageResponse | null): { from: string; to: string } {
  const { latest, earliest } = bounds(c);
  const to = latest ?? isoToday();
  return presetRange('mtd', to, earliest);
}

/**
 * Every report tab (Overview, DSR, DUR, Category, Search Terms, …) for one profile,
 * in the shared Brand Central-style shell. Used by /reports (uploaded data) and
 * /gcs (GCS warehouse data).
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
  const [categories, setCategories] = useState<string[]>([]);
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
        ? getDsr(profileId, range.from, range.to, category).then((d) => alive && (setDsr(d), setCategories(d.categories)))
        : getDur(profileId, range.from, range.to, metric, category).then((d) => alive && (setDur(d), setCategories(d.categories)));
    req.catch((e: Error) => alive && setError(e.message)).finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId, tab, range, metric, category]);

  const { latest, earliest } = bounds(coverage);
  const hasAnyData = coverage?.sources.some((s) => s.days > 0);
  // MoM / WoW, SQP and Keyword Harvesting choose their own periods, so the date range doesn't apply to them.
  const isSummary = tab === 'summary' || tab === 'sqp' || tab === 'harvest';
  // Rule / negation / targeting pages use the selected range but have no comparison period.
  const isActionTab = tab === 'negations' || tab === 'termrules' || tab === 'targeting';
  const isView = tab !== 'dsr' && tab !== 'dur' && tab !== 'overview' && !isSummary && !isActionTab;
  const compare: Period | null =
    isView && compareOn && compareRange && compareRange.from <= compareRange.to ? compareRange : null;
  const toggleCompare = () => {
    if (!compareOn && range) setCompareRange(previousRange(range));
    setCompareOn(!compareOn);
  };

  const toolbar = (
    <>
      {range && !isSummary &&
        (latest ? <PeriodPicker value={range} onChange={setRange} latest={latest} earliest={earliest} /> : <DateRangePicker value={range} onChange={setRange} />)}

      {(tab === 'overview' || tab === 'dsr' || tab === 'dur') && (
        <FieldSelect
          label="Category"
          value={category}
          onChange={setCategory}
          allLabel="All"
          options={categories.length ? categories : category ? [category] : []}
        />
      )}

      {tab === 'dur' && (
        <div className="field gap-1 px-1">
          {(['units', 'orders'] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMetric(m)}
              className={`rounded-md px-3 py-1 text-sm ${metric === m ? 'bg-ink font-medium text-white' : 'text-ink/75 hover:bg-black/5'}`}
            >
              {m === 'units' ? 'Units sold' : 'Orders'}
            </button>
          ))}
        </div>
      )}

      {range && isView && (
        <>
          <label className="field cursor-pointer select-none">
            <input type="checkbox" className="checkbox checkbox-xs checkbox-primary" checked={compareOn} onChange={toggleCompare} />
            <span className="font-medium">Compare</span>
          </label>
          {compareOn && compareRange && (
            <>
              <DateRangePicker value={compareRange} onChange={setCompareRange} />
              <button
                onClick={() => setCompareRange(previousRange(range))}
                className="btn btn-link btn-xs px-0 text-muted"
                title="Equal-length period just before the selected range"
              >
                Previous period
              </button>
            </>
          )}
        </>
      )}

      {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
    </>
  );

  return (
    <DashboardShell
      marketplace="amazon"
      title={title}
      subtitle={subtitle ?? `Profile: ${profileId}`}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      toolbar={toolbar}
      heading={tab !== 'overview'}
      sideCard={coverage && hasAnyData ? <CoverageCard coverage={coverage} /> : null}
    >
      {coverage && !hasAnyData && tab !== 'sqp' && (
        <div className="rounded-xl border border-line bg-side px-5 py-6 text-sm">{emptyState}</div>
      )}
      {error && <ErrorBox message={error} />}

      {tab === 'summary' && <SummaryView profileId={profileId} compareLoad={getSummaryCompare} />}
      {tab === 'sqp' && <SqpView profileId={profileId} />}
      {tab === 'harvest' && <HarvestView profileId={profileId} />}
      {tab === 'dsr' && dsr && (
        <>
          <DsrTable data={dsr} />
          <Notes notes={dsr.notes} />
        </>
      )}
      {range && range.from <= range.to && (
        <>
          {tab === 'overview' && hasAnyData && (
            <AmazonOverview profileId={profileId} from={range.from} to={range.to} category={category} latest={latest} onCategories={setCategories} />
          )}
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
          {tab === 'negations' && <NegationsView profileId={profileId} from={range.from} to={range.to} />}
          {tab === 'termrules' && <TermRulesView profileId={profileId} from={range.from} to={range.to} grain="term" />}
          {/* Targeting page hidden for now — restore the import, the tab entry, and this line to bring it back. */}
          {/* {tab === 'targeting' && <TargetingView profileId={profileId} from={range.from} to={range.to} />} */}
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
    </DashboardShell>
  );
}

const SOURCE_LABEL: Record<string, string> = {
  seller: 'Seller Central',
  vendor: 'Vendor Central',
  ads_sp: 'SP',
  ads_sb: 'SB',
  ads_sd: 'SD',
};

function CoverageCard({ coverage }: { coverage: CoverageResponse }) {
  const rate = coverage.asinMapper.matchRatePct;
  return (
    <SideCard title="Data coverage">
      <dl className="space-y-1">
        {coverage.sources
          .filter((s) => s.days > 0)
          .map((s) => (
            <div key={s.source}>
              <dt className="font-semibold text-ink">{SOURCE_LABEL[s.source] ?? s.source}</dt>
              <dd>
                {fmtDateLong(s.from!)} – {fmtDateLong(s.to!)} ({s.days}d)
              </dd>
            </div>
          ))}
        <div>
          <dt className="font-semibold text-ink">ASIN mapper match</dt>
          <dd className={rate != null && rate < 50 ? 'font-medium text-warn' : ''}>
            {rate == null ? '—' : `${rate.toFixed(0)}%`} ({coverage.asinMapper.mappedAsins}/{coverage.asinMapper.asinsWithSales})
          </dd>
        </div>
      </dl>
    </SideCard>
  );
}
