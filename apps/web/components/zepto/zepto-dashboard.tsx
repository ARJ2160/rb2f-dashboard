'use client';

import type { ZpMetaResponse } from '@dash/shared/zepto';
import { useEffect, useState, type ReactNode } from 'react';

import { ErrorBox } from '@/components/notes';
import { DashboardShell, PeriodPicker, SideCard, type ShellTab } from '@/components/shell/dashboard-shell';
import { MultiSelect, type Period } from '@/components/views/shared';
import { fmtDateLong, isoAddDays, isoToday } from '@/lib/format';
import { zeptoApi } from '@/lib/zepto-api';

import {
  AdsView,
  AsinView,
  CategoryAdvertisedView,
  CategoryView,
  CityView,
  DsrView,
  DurView,
  InventoryView,
  MainView,
  SearchTermsView,
  type ViewProps,
} from './views';

type Tab =
  | 'main'
  | 'ads'
  | 'dsr'
  | 'dur'
  | 'category'
  | 'asin'
  | 'city'
  | 'search'
  | 'catadv'
  | 'inventory';

const TABS: Array<ShellTab<Tab>> = [
  { id: 'main', label: 'Main View', hint: 'Sales and ads overview by category or SKU', icon: 'overview', group: 'Performance' },
  { id: 'ads', label: 'Ads Analysis', hint: 'Every campaign across SP / SB / SD, with its ad metrics', icon: 'mom', group: 'Performance' },
  { id: 'dsr', label: 'DSR', hint: 'Daily Sales Report — one row per date', icon: 'dsr', group: 'Performance' },
  { id: 'dur', label: 'DUR', hint: 'Daily Units Report — SKU × date', icon: 'dur', group: 'Performance' },
  { id: 'category', label: 'Category', hint: 'Sales and ads by canonical category', icon: 'category', group: 'Analysis' },
  { id: 'asin', label: 'ASIN Level', hint: 'Per-SKU: ad metrics (SP+SB+SD) + revenue from Total Sales', icon: 'keywords', group: 'Analysis' },
  { id: 'city', label: 'City Wise Data', hint: 'Sales by state and city, with the India map', icon: 'map', group: 'Analysis' },
  { id: 'search', label: 'Search Terms', hint: 'SP / SB keyword performance', icon: 'keywords', group: 'Analysis' },
  { id: 'catadv', label: 'Category Advertised', hint: 'Ad metrics grouped by the advertised category', icon: 'category', group: 'Analysis' },
  { id: 'inventory', label: 'Inventory · DOC', hint: 'Stock by SKU with days of cover from the sales run rate', icon: 'inventory', group: 'Stock' },
];

function bounds(m: ZpMetaResponse | null) {
  const tos = [m?.sales.to, ...(m?.ads.periods ?? []).map((p) => p.to)].filter((d): d is string => !!d).sort();
  const froms = [m?.sales.from, ...(m?.ads.periods ?? []).map((p) => p.from)]
    .filter((d): d is string => !!d)
    .sort();
  return { latest: tos.at(-1) ?? null, earliest: froms[0] ?? null };
}

function defaultRange(m: ZpMetaResponse | null): Period {
  const { latest, earliest } = bounds(m);
  const to = latest ?? isoToday();
  const from = isoAddDays(to, -29);
  return { from: earliest && from < earliest ? earliest : from, to };
}

const CHANNELS = [
  { value: 'sp', label: 'Sponsored Product' },
  { value: 'sb', label: 'Sponsored Brand' },
  { value: 'sd', label: 'Sponsored Display' },
];

export function ZeptoDashboard({
  profileId,
  title,
  subtitle,
  emptyState,
}: {
  profileId: string;
  title: string;
  subtitle?: ReactNode;
  emptyState: ReactNode;
}) {
  const [tab, setTab] = useState<Tab>('main');
  const [meta, setMeta] = useState<ZpMetaResponse | null>(null);
  const [range, setRange] = useState<Period | null>(null);
  const [category, setCategory] = useState('');
  const [channel, setChannel] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setRange(null);
    zeptoApi
      .meta(profileId)
      .then((m) => alive && (setMeta(m), setRange(defaultRange(m))))
      .catch((e: Error) => alive && (setError(e.message), setRange(defaultRange(null))));
    return () => {
      alive = false;
    };
  }, [profileId]);

  const { latest, earliest } = bounds(meta);
  const hasData =
    !!meta && (meta.sales.rows > 0 || meta.ads.periods.length > 0 || meta.inventory.snapshots.length > 0);
  const adsTab = tab === 'ads' || tab === 'search' || tab === 'catadv';

  const toolbar = (
    <>
      {range && latest && tab !== 'inventory' && (
        <PeriodPicker value={range} onChange={setRange} latest={latest} earliest={earliest} />
      )}
      {meta && tab !== 'dsr' && (
        <MultiSelect label="Category" value={category} onChange={setCategory} options={meta.categories} allLabel="All categories" />
      )}
      {adsTab && (
        <MultiSelect label="Channel" value={channel} onChange={setChannel} options={CHANNELS} allLabel="All channels" />
      )}
    </>
  );

  const vp: ViewProps | null =
    range && range.from <= range.to
      ? { profileId, from: range.from, to: range.to, category, channel: adsTab ? channel : '' }
      : null;

  return (
    <DashboardShell
      marketplace="zepto"
      title={title}
      subtitle={subtitle}
      tabs={TABS}
      tab={tab}
      onTab={setTab}
      toolbar={toolbar}
      sideCard={meta && hasData ? <Coverage meta={meta} /> : null}
    >
      {meta && !hasData && (
        <div className="rounded-xl border border-line bg-side px-5 py-6 text-sm">{emptyState}</div>
      )}
      {error && <ErrorBox message={error} />}

      {hasData && tab === 'inventory' && <InventoryView profileId={profileId} category={category} />}
      {hasData && vp && tab !== 'inventory' && (
        <>
          {tab === 'main' && <MainView {...vp} />}
          {tab === 'ads' && <AdsView {...vp} />}
          {tab === 'dsr' && <DsrView {...vp} />}
          {tab === 'dur' && <DurView {...vp} />}
          {tab === 'category' && <CategoryView {...vp} />}
          {tab === 'asin' && <AsinView {...vp} />}
          {tab === 'city' && <CityView {...vp} />}
          {tab === 'search' && <SearchTermsView {...vp} />}
          {tab === 'catadv' && <CategoryAdvertisedView {...vp} />}
        </>
      )}
    </DashboardShell>
  );
}

function Coverage({ meta }: { meta: ZpMetaResponse }) {
  const span = (r: { from: string | null; to: string | null }) =>
    r.from && r.to ? `${fmtDateLong(r.from)} – ${fmtDateLong(r.to)}` : 'none';
  const periods = meta.ads.periods;
  const snaps = meta.inventory.snapshots;
  const unmapped = meta.unmappedSkus.length + meta.unmappedCampaigns.length;
  return (
    <SideCard title="Data coverage">
      <dl className="space-y-1">
        <div>
          <dt className="font-semibold text-ink">Sales</dt>
          <dd>{span(meta.sales)}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Ads</dt>
          <dd>
            {periods.length
              ? `${periods.length} window${periods.length === 1 ? '' : 's'} · ${span({ from: periods[0]!.from, to: periods.at(-1)!.to })}`
              : 'none'}
          </dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Inventory</dt>
          <dd>{snaps[0] ? `${fmtDateLong(snaps[0])} · ${snaps.length} snapshot${snaps.length === 1 ? '' : 's'}` : 'none'}</dd>
        </div>
        <div>
          <dt className="font-semibold text-ink">Mappers</dt>
          <dd className={unmapped ? 'font-medium text-warn' : ''}>
            {unmapped
              ? `${meta.unmappedSkus.length} SKU(s), ${meta.unmappedCampaigns.length} campaign(s) unmapped`
              : 'All SKUs and campaigns mapped'}
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
