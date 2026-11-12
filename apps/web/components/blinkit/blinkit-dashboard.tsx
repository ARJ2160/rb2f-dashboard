'use client';

import { QC_FLAVOURS, type BkMetaResponse, type QcMarket } from '@dash/shared/blinkit';
import { useEffect, useState, type ReactNode } from 'react';

import { DateRangePicker } from '@/components/date-picker';
import { ErrorBox } from '@/components/notes';
import { DashboardShell, FieldSelect, PeriodPicker, SideCard, type ShellTab } from '@/components/shell/dashboard-shell';
import { previousRange } from '@/components/shell/use-load';
import type { Period } from '@/components/views/shared';
import { SummaryView } from '@/components/views/summary-view';
import { fmtDateLong, isoAddDays, isoToday } from '@/lib/format';

import { CategoryView } from './category-view';
import { CityView } from './city-view';
import { DsrView, DurView } from './dsr-dur';
import { InventoryView } from './inventory-view';
import { KeywordsView } from './keywords-view';
import { BkOverview } from './overview-view';
import { QcProvider, useQc } from './qc-context';

type Tab = 'overview' | 'mom' | 'dsr' | 'dur' | 'category' | 'city' | 'keywords' | 'inventory';

const TABS: Array<ShellTab<Tab>> = [
  // Same names and order as the Amazon dashboard.
  { id: 'mom', label: 'Account Overview', hint: 'Month-to-date vs last month, last 7 days vs the 7 before — as of the latest data', icon: 'mom', group: 'Performance' },
  { id: 'overview', label: 'Ads Overview', hint: 'Ad performance overview — tick metrics to plot their daily trend', icon: 'overview', group: 'Performance' },
  { id: 'dsr', label: 'DSR', hint: 'Daily Sales Report — one row per date', icon: 'dsr', group: 'Performance' },
  { id: 'dur', label: 'DUR', hint: 'Daily Units Report — Blinkit item × date', icon: 'dur', group: 'Performance' },
  { id: 'category', label: 'Category', hint: 'Sales and ads by category or SKU, with a daily trend', icon: 'category', group: 'Analysis' },
  { id: 'city', label: 'City Wise Data', hint: 'Sales by state / city; ads only for campaigns that target an exact city', icon: 'map', group: 'Analysis' },
  { id: 'keywords', label: 'Keywords', hint: 'Product Listing and Banner keywords, Recommendation placements', icon: 'keywords', group: 'Analysis' },
  { id: 'inventory', label: 'Inventory · DOC', hint: 'Last-7-day run rate and days of cover per item × feeder warehouse', icon: 'inventory', group: 'Stock' },
];

/** Tab list for a marketplace: Instamart's ads report has the city on every row and there is no inventory feed yet. */
function tabsFor(market: QcMarket): Array<ShellTab<Tab>> {
  if (market === 'blinkit') return TABS;
  return TABS.filter((t) => t.id !== 'inventory' || QC_FLAVOURS[market].inventory).map((t) =>
    t.id === 'dur'
      ? { ...t, hint: 'Daily Units Report — Instamart item code × date' }
      : t.id === 'city'
        ? { ...t, hint: 'Sales and ad spend by city — exact, the ads report carries the city on every row' }
        : t.id === 'keywords'
          ? { ...t, hint: 'Keyword, Search Inline Banner and Auto Suggest keywords — by city, campaign and ad property' }
          : t
  );
}

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
 * Every quick-commerce report for one profile (`gcs_<brand>` on the GCS page),
 * in the shared Brand Central-style shell: sidebar of reports, filters on top.
 * `market` picks the API (/api/blinkit or /api/instamart) and what the views show.
 */
export function BlinkitDashboard({ market = 'blinkit', ...p }: {
  market?: QcMarket;
  profileId: string;
  title: string;
  subtitle?: ReactNode;
  emptyState: ReactNode;
}) {
  return (
    <QcProvider market={market}>
      <QcDashboard {...p} />
    </QcProvider>
  );
}

function QcDashboard({ profileId, title, subtitle, emptyState }: {
  profileId: string;
  title: string;
  subtitle?: ReactNode;
  emptyState: ReactNode;
}) {
  const { api, flavour } = useQc();
  const tabs = tabsFor(flavour.id);
  const [tab, setTab] = useState<Tab>('mom'); // opens on Account Overview, like Amazon
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
    api.meta(profileId)
      .then((m) => alive && (setMeta(m), setRange(defaultRange(m))))
      .catch((e: Error) => alive && (setError(e.message), setRange(defaultRange(null))));
    return () => {
      alive = false;
    };
  }, [profileId, api]);

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
      {tab === 'overview' && (
        <FieldSelect label={flavour.id === 'instamart' ? 'Ad property' : 'Campaign type'} value={adType} onChange={setAdType} options={flavour.adTypes} allLabel="All" />
      )}
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
      marketplace={flavour.logo}
      title={title}
      subtitle={subtitle}
      tabs={tabs}
      tab={tab}
      onTab={setTab}
      toolbar={toolbar}
      heading={tab !== 'overview'}
      sideCard={meta && hasData ? <Coverage meta={meta} inventory={flavour.inventory} /> : null}
    >
      {meta && !hasData && <div className="rounded-xl border border-line bg-side px-5 py-6 text-sm">{emptyState}</div>}
      {error && <ErrorBox message={error} />}

      {hasData && tab === 'mom' && <SummaryView profileId={profileId} load={api.mom} />}
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
      {hasData && tab === 'inventory' && flavour.inventory && <InventoryView profileId={profileId} category={category} />}
    </DashboardShell>
  );
}

/** Data coverage — pinned to the foot of the sidebar. */
function Coverage({ meta, inventory }: { meta: BkMetaResponse; inventory: boolean }) {
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
        {inventory && (
          <div>
            <dt className="font-semibold text-ink">Inventory</dt>
            <dd>{snaps[0] ? `${fmtDateLong(snaps[0])} · ${snaps.length} snapshot${snaps.length === 1 ? '' : 's'}` : 'none'}</dd>
          </div>
        )}
        <div
          title={[...meta.unmappedItems.map((i) => `Item ${i.itemId} ${i.name}`), ...meta.unmappedCampaigns.map((c) => `Campaign ${c.name}`)].join('\n')}
        >
          <dt className="font-semibold text-ink">Mappers</dt>
          <dd className={unmapped ? 'font-medium text-warn' : ''}>
            {unmapped ? `${meta.unmappedItems.length} item(s), ${meta.unmappedCampaigns.length} campaign(s) unmapped` : 'All items and campaigns mapped'}
          </dd>
        </div>
        {meta.notes.map((n) => (
          <dd key={n} className="text-[11px] leading-snug text-ink/70">
            {n}
          </dd>
        ))}
      </dl>
    </SideCard>
  );
}
