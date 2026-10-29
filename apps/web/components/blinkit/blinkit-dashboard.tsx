'use client';

import type { BkMetaResponse } from '@dash/shared/blinkit';
import { useEffect, useState, type ReactNode } from 'react';

import { DateRangePicker } from '@/components/date-picker';
import { ErrorBox } from '@/components/notes';
import { DashboardShell, FieldSelect, PeriodPicker, SideCard, type ShellTab } from '@/components/shell/dashboard-shell';
import { previousRange } from '@/components/shell/use-load';
import type { Period } from '@/components/views/shared';
import { SummaryView } from '@/components/views/summary-view';
import { bkMeta, bkMom } from '@/lib/blinkit-api';
import { fmtDateLong, isoAddDays, isoToday } from '@/lib/format';

import { CategoryView } from './category-view';
import { CityView } from './city-view';
import { DsrView, DurView } from './dsr-dur';
import { InventoryView } from './inventory-view';
import { KeywordsView } from './keywords-view';
import { BkOverview } from './overview-view';

type Tab = 'overview' | 'mom' | 'dsr' | 'dur' | 'category' | 'city' | 'keywords' | 'inventory';

const TABS: Array<ShellTab<Tab>> = [
  { id: 'overview', label: 'Overview', hint: 'Ad performance overview — tick metrics to plot their daily trend', icon: 'overview' },
  { id: 'mom', label: 'MoM / WoW', hint: 'Month-to-date vs last month, last 7 days vs the 7 before — as of the latest data', icon: 'mom' },
  { id: 'dsr', label: 'DSR', hint: 'Daily Sales Report — one row per date', icon: 'dsr' },
  { id: 'dur', label: 'DUR', hint: 'Daily Units Report — Blinkit item × date', icon: 'dur' },
  { id: 'category', label: 'Category', hint: 'Sales and ads by category or SKU, with a daily trend', icon: 'category' },
  { id: 'city', label: 'City Wise Data', hint: 'Sales by state / city; ads only for campaigns that target an exact city', icon: 'map' },
  { id: 'keywords', label: 'Keywords', hint: 'Product Listing and Banner keywords, Recommendation placements', icon: 'keywords' },
  { id: 'inventory', label: 'Inventory · DOC', hint: 'Last-7-day run rate and days of cover per item × feeder warehouse', icon: 'inventory' },
];

const AD_TYPES = [
  { value: 'PL', label: 'Product Listing' },
  { value: 'PR', label: 'Product Recommendation' },
  { value: 'BL', label: 'Banner Listing' },
];

/** Latest / earliest day that has sales or ads. */
function bounds(m: BkMetaResponse | null) {
  const latest = [m?.sales.to, m?.ads.to].filter((d): d is string => !!d).sort().at(-1) ?? null;
  const earliest = [m?.sales.from, m?.ads.from].filter((d): d is string => !!d).sort()[0] ?? null;
  return { latest, earliest };
}

/** Last 30 days that have sales or ads. */
function defaultRange(m: BkMetaResponse | null): Period {
  const { latest, earliest } = bounds(m);
  const to = latest ?? isoToday();
  const from = isoAddDays(to, -29);
  return { from: earliest && from < earliest ? earliest : from, to };
}

/**
 * Every Blinkit report for one profile (`gcs_<brand>` on the GCS page), in the
 * shared Brand Central-style shell: sidebar of reports, filters on top.
 */
export function BlinkitDashboard({ profileId, title, subtitle, emptyState }: {
  profileId: string;
  title: string;
  subtitle?: ReactNode;
  emptyState: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('overview');
  const [meta, setMeta] = useState<BkMetaResponse | null>(null);
  const [range, setRange] = useState<Period | null>(null);
  const [category, setCategory] = useState('');
  const [adType, setAdType] = useState('');
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

  const { latest, earliest } = bounds(meta);
  const hasData = !!meta && (meta.sales.rows > 0 || meta.ads.rows > 0 || meta.inventory.snapshots.length > 0);
  const ownPeriod = tab === 'mom' || tab === 'inventory';
  const comparable = tab === 'category' || tab === 'city' || tab === 'keywords';
  const compare = comparable && compareOn && compareRange && compareRange.from <= compareRange.to ? compareRange : null;
  const toggleCompare = () => {
    if (!compareOn && range) setCompareRange(previousRange(range));
    setCompareOn(!compareOn);
  };

  const toolbar = (
    <>
      {range && !ownPeriod && (latest ? <PeriodPicker value={range} onChange={setRange} latest={latest} earliest={earliest} /> : <DateRangePicker value={range} onChange={setRange} />)}
      {/* MoM / WoW has its own As-of date and category picker (same as Amazon). */}
      {tab !== 'mom' && meta && <FieldSelect label="Category" value={category} onChange={setCategory} options={meta.categories} allLabel="All" />}
      {tab === 'overview' && <FieldSelect label="Campaign type" value={adType} onChange={setAdType} options={AD_TYPES} allLabel="All" />}
      {range && comparable && (
        <>
          <label className="field cursor-pointer select-none">
            <input type="checkbox" className="checkbox checkbox-xs checkbox-primary" checked={compareOn} onChange={toggleCompare} />
            <span className="font-medium">Compare</span>
          </label>
          {compareOn && compareRange && (
            <>
              <DateRangePicker value={compareRange} onChange={setCompareRange} />
              <button onClick={() => setCompareRange(previousRange(range))} className="btn btn-link btn-xs px-0 text-muted">
                Previous period
              </button>
            </>
          )}
        </>
      )}
    </>
  );

  return (
    <DashboardShell
      marketplace="blinkit"
      title={title}
      subtitle={subtitle}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      toolbar={toolbar}
      heading={tab !== 'overview'}
      sideCard={meta && hasData ? <Coverage meta={meta} /> : null}
    >
      {meta && !hasData && <div className="rounded-xl border border-line bg-side px-5 py-6 text-sm">{emptyState}</div>}
      {error && <ErrorBox message={error} />}

      {hasData && tab === 'mom' && <SummaryView profileId={profileId} load={bkMom} />}
      {hasData && range && range.from <= range.to && (
        <>
          {tab === 'overview' && <BkOverview profileId={profileId} from={range.from} to={range.to} category={category} adType={adType} latest={latest} />}
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
    </DashboardShell>
  );
}

/** Data coverage — pinned to the foot of the sidebar. */
function Coverage({ meta }: { meta: BkMetaResponse }) {
  const span = (r: { from: string | null; to: string | null }) => (r.from && r.to ? `${fmtDateLong(r.from)} – ${fmtDateLong(r.to)}` : 'none');
  const unmapped = meta.unmappedItems.length + meta.unmappedCampaigns.length;
  const snaps = meta.inventory.snapshots;
  return (
    <SideCard title="Data coverage">
      <dl className="space-y-1">
        <div>
          <dt className="font-semibold text-ink">Sales</dt>
          <dd>{span(meta.sales)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Ads</dt>
          <dd>{span(meta.ads)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Inventory</dt>
          <dd>{snaps[0] ? `${fmtDateLong(snaps[0])} · ${snaps.length} snapshot${snaps.length === 1 ? '' : 's'}` : 'none'}</dd>
        </div>
        <div
          title={[...meta.unmappedItems.map((i) => `Item ${i.itemId} ${i.name}`), ...meta.unmappedCampaigns.map((c) => `Campaign ${c.name}`)].join('\n')}
        >
          <dt className="font-semibold text-ink">Mappers</dt>
          <dd className={unmapped ? 'font-medium text-warn' : ''}>
            {unmapped ? `${meta.unmappedItems.length} item(s), ${meta.unmappedCampaigns.length} campaign(s) unmapped` : 'All items and campaigns mapped'}
          </dd>
        </div>
      </dl>
    </SideCard>
  );
}
