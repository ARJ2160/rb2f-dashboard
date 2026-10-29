'use client';

import type { BkMetaResponse } from '@dash/shared/blinkit';
import { useEffect, useState, type ReactNode } from 'react';

import { DateRangePicker } from '@/components/date-picker';
import { ErrorBox } from '@/components/notes';
import { Select, type Period } from '@/components/views/shared';
import { SummaryView } from '@/components/views/summary-view';
import { bkMeta, bkMom } from '@/lib/blinkit-api';
import { fmtDateLong, isoAddDays, isoToday } from '@/lib/format';

import { CategoryView } from './category-view';
import { CityView } from './city-view';
import { DsrView, DurView } from './dsr-dur';
import { InventoryView } from './inventory-view';
import { KeywordsView } from './keywords-view';

type Tab = 'mom' | 'dsr' | 'dur' | 'category' | 'city' | 'keywords' | 'inventory';

const TABS: Array<{ id: Tab; label: string; hint: string }> = [
  { id: 'mom', label: 'MoM / WoW', hint: 'Month-to-date vs last month, last 7 days vs the 7 before — as of the latest data' },
  { id: 'dsr', label: 'DSR', hint: 'Daily Sales Report — one row per date' },
  { id: 'dur', label: 'DUR', hint: 'Daily Units Report — Blinkit item × date' },
  { id: 'category', label: 'Category', hint: 'Sales and ads by category or SKU, with a daily trend' },
  { id: 'city', label: 'City Wise Data', hint: 'Sales by state / city; ads only for campaigns that target an exact city' },
  { id: 'keywords', label: 'Keywords', hint: 'Product Listing and Banner keywords, Recommendation placements' },
  { id: 'inventory', label: 'Inventory · DOC', hint: 'Last-7-day run rate and days of cover per item × feeder warehouse' },
];

const previousPeriod = (p: Period): Period => {
  const n = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
  return { from: isoAddDays(p.from, -n), to: isoAddDays(p.from, -1) };
};

/** Last 30 days that have sales or ads. */
function defaultRange(m: BkMetaResponse | null): Period {
  const latest = [m?.sales.to, m?.ads.to].filter((d): d is string => !!d).sort().at(-1) ?? isoToday();
  const earliest = [m?.sales.from, m?.ads.from].filter((d): d is string => !!d).sort()[0] ?? latest;
  const from = isoAddDays(latest, -29);
  return { from: from < earliest ? earliest : from, to: latest };
}

/**
 * Every Blinkit report tab for one profile (`gcs_<brand>` on the GCS page).
 * Same layout and controls as the Amazon ReportsDashboard.
 */
export function BlinkitDashboard({ profileId, title, subtitle, emptyState }: {
  profileId: string;
  title: string;
  subtitle?: ReactNode;
  emptyState: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('mom');
  const [meta, setMeta] = useState<BkMetaResponse | null>(null);
  const [range, setRange] = useState<Period | null>(null);
  const [category, setCategory] = useState('');
  const [compareOn, setCompareOn] = useState(false);
  const [compareRange, setCompareRange] = useState<Period | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRange(null);
    bkMeta(profileId)
      .then((m) => alive && (setMeta(m), setRange(defaultRange(m))))
      .catch((e: Error) => alive && (setError(e.message), setRange(defaultRange(null))));
    return () => {
      alive = false;
    };
  }, [profileId]);

  const hasData = !!meta && (meta.sales.rows > 0 || meta.ads.rows > 0 || meta.inventory.snapshots.length > 0);
  const ownPeriod = tab === 'mom' || tab === 'inventory';
  const comparable = tab === 'category' || tab === 'city' || tab === 'keywords';
  const compare = comparable && compareOn && compareRange && compareRange.from <= compareRange.to ? compareRange : null;
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

        {range && !ownPeriod && <DateRangePicker value={range} onChange={setRange} />}
        {/* MoM / WoW has its own As-of date and category picker (same as Amazon). */}
        {tab !== 'mom' && meta && <Select label="Category" value={category} onChange={setCategory} options={meta.categories} />}
        {range && comparable && (
          <div className="flex items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" className="checkbox checkbox-xs checkbox-primary" checked={compareOn} onChange={toggleCompare} />
              Compare with
            </label>
            {compareOn && compareRange && (
              <>
                <DateRangePicker value={compareRange} onChange={setCompareRange} />
                <button onClick={() => setCompareRange(previousPeriod(range))} className="btn btn-link btn-xs px-0">
                  Previous period
                </button>
              </>
            )}
          </div>
        )}
      </div>

      {meta && !hasData && <div className="rounded-box border border-line bg-surface px-4 py-6 text-sm shadow-sm">{emptyState}</div>}
      {meta && hasData && <CoverageStrip meta={meta} />}
      {error && <ErrorBox message={error} />}

      {hasData && tab === 'mom' && <SummaryView profileId={profileId} load={bkMom} />}
      {hasData && range && range.from <= range.to && (
        <>
          {tab === 'dsr' && <DsrView profileId={profileId} from={range.from} to={range.to} category={category} />}
          {tab === 'dur' && <DurView profileId={profileId} from={range.from} to={range.to} category={category} />}
          {tab === 'category' && <CategoryView profileId={profileId} from={range.from} to={range.to} category={category} compare={compare} />}
          {tab === 'city' && <CityView profileId={profileId} from={range.from} to={range.to} category={category} compare={compare} />}
          {tab === 'keywords' && meta && (
            <KeywordsView profileId={profileId} from={range.from} to={range.to} category={category} compare={compare} meta={meta} />
          )}
        </>
      )}
      {hasData && tab === 'inventory' && <InventoryView profileId={profileId} category={category} />}
    </div>
  );
}

function CoverageStrip({ meta }: { meta: BkMetaResponse }) {
  const span = (r: { from: string | null; to: string | null }) => (r.from && r.to ? `${fmtDateLong(r.from)} – ${fmtDateLong(r.to)}` : 'none');
  const unmapped = meta.unmappedItems.length + meta.unmappedCampaigns.length;
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
      <span>
        <span className="font-medium text-ink">Sales</span> {span(meta.sales)}
      </span>
      <span>
        <span className="font-medium text-ink">Ads</span> {span(meta.ads)}
      </span>
      <span>
        <span className="font-medium text-ink">Inventory</span>{' '}
        {meta.inventory.snapshots[0] ? `${fmtDateLong(meta.inventory.snapshots[0])} (${meta.inventory.snapshots.length} snapshot${meta.inventory.snapshots.length === 1 ? '' : 's'})` : 'none'}
      </span>
      <span
        className={unmapped ? 'font-medium text-warn' : ''}
        title={[...meta.unmappedItems.map((i) => `Item ${i.itemId} ${i.name}`), ...meta.unmappedCampaigns.map((c) => `Campaign ${c.name}`)].join('\n')}
      >
        Mappers: {unmapped ? `${meta.unmappedItems.length} item(s), ${meta.unmappedCampaigns.length} campaign(s) unmapped` : 'all items and campaigns mapped'}
      </span>
    </div>
  );
}
