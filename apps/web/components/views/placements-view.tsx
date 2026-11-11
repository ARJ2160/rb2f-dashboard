'use client';

import { addAdBase, deriveAd, emptyAdBase, type AdBase, type AdMetrics, type PlacementRow } from '@dash/shared';
import { useState } from 'react';

import { HBars } from '@/components/charts';
import { getPlacements } from '@/lib/api';
import { fmtInt, fmtPct } from '@/lib/format';

import {
  AdCells,
  AdFilterBar,
  AdHeader,
  Card,
  CHART_METRICS,
  EMPTY_AD_FILTERS,
  fmtFor,
  MCell,
  Select,
  THEAD,
  TABLE_WRAP,
  useCompareReport,
  ViewShell,
  type AdFilterState,
  type RangeProps,
} from './shared';

const NAMES: Record<string, string> = { TOS: 'Top of Search (TOS)', ROS: 'Rest of Search (ROS)', PDP: 'Product Pages (PDP)' };
const label = (ch: string, p: string) => `${ch.toUpperCase()} · ${NAMES[p] ?? p}`;

/** Placements: SP + SB by TOS / ROS / PDP with every ad metric, a metric bar chart, and the shared filters. */
export function PlacementsView(props: RangeProps) {
  const [filters, setFilters] = useState<AdFilterState>(EMPTY_AD_FILTERS);
  const [channel, setChannel] = useState('');
  const [metric, setMetric] = useState<keyof AdMetrics>('spend');
  const comparing = !!props.compare;
  const { data, prev, error, loading } = useCompareReport(
    (p) => getPlacements(props.profileId, p.from, p.to, { channel: channel || 'all', ...filters }),
    [channel, filters.category, filters.adType, filters.targeting, filters.branding],
    props
  );
  const key = (r: { channel: string; placement: string }) => `${r.channel}|${r.placement}`;
  const prevBy = new Map(prev?.rows.map((r) => [key(r), r]) ?? []);
  const fmt = fmtFor(metric);

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={
        <>
          <Select label="Channel" value={channel} onChange={setChannel} options={[{ value: 'sp', label: 'SP' }, { value: 'sb', label: 'SB' }]} />
          <AdFilterBar value={filters} onChange={setFilters} options={data?.filterOptions} />
        </>
      }
    >
      {data && (
        <>
          <Card
            title="Placements"
            right={<Select label="Metric" value={metric} onChange={(v) => setMetric(v as keyof AdMetrics)} options={CHART_METRICS} allLabel={null} />}
          >
            <HBars
              items={data.rows.map((r) => ({
                label: label(r.channel, r.placement),
                value: (r[metric] as number | null) ?? 0,
                prev: (prevBy.get(key(r))?.[metric] as number | null | undefined) ?? null,
              }))}
              fmt={fmt}
              comparing={comparing}
            />
          </Card>
          {(['sp', 'sb'] as const)
            .filter((ch) => data.rows.some((r) => r.channel === ch))
            .map((ch) => (
              <ChannelTable
                key={ch}
                channel={ch}
                rows={data.rows.filter((r) => r.channel === ch)}
                prevBy={prevBy}
                keyOf={key}
                comparing={comparing}
              />
            ))}
        </>
      )}
    </ViewShell>
  );
}

/** One table per channel so SP and SB placements are shown separately, each with its own TOTAL. */
function ChannelTable({ channel, rows, prevBy, keyOf, comparing }: {
  channel: 'sp' | 'sb';
  rows: PlacementRow[];
  prevBy: Map<string, PlacementRow>;
  keyOf: (r: { channel: string; placement: string }) => string;
  comparing: boolean;
}) {
  const base: AdBase = rows.reduce((a, r) => addAdBase(a, r), emptyAdBase());
  const total = deriveAd(base);
  const prevBase: AdBase | null = comparing
    ? rows.reduce((a, r) => (prevBy.get(keyOf(r)) ? addAdBase(a, prevBy.get(keyOf(r))!) : a), emptyAdBase())
    : null;
  const prevTotal = prevBase ? deriveAd(prevBase) : undefined;
  const shareTotal = rows.reduce((a, r) => a + (r.spendSharePct ?? 0), 0);

  return (
    <div className="space-y-1.5">
      <div className="text-sm font-semibold text-ink">{channel.toUpperCase()}</div>
      <div className={TABLE_WRAP}>
        <table className="table table-sm">
          <thead className={THEAD}>
            <tr className="text-xs text-muted">
              <th className="px-3 py-2 text-left font-medium">Placement</th>
              <th className="px-3 py-2 text-right font-medium">Campaigns</th>
              <th className="px-3 py-2 text-right font-medium">Spend share</th>
              <AdHeader />
            </tr>
            <tr className="border-b border-line bg-accent-soft font-semibold">
              <td className="px-3 py-1.5" colSpan={2}>
                {channel.toUpperCase()} TOTAL
              </td>
              <td className="num px-3 py-1.5 text-right">{fmtPct(shareTotal)}</td>
              <AdCells m={total} prev={prevTotal} comparing={comparing} />
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={keyOf(r)} className="border-b border-line/60 align-top odd:bg-surface even:bg-stripe hover:bg-accent-soft">
                <td className="whitespace-nowrap px-3 py-1.5">{NAMES[r.placement] ?? r.placement}</td>
                <td className="num px-3 py-1.5 text-right">{fmtInt(r.campaigns)}</td>
                <MCell v={r.spendSharePct} prev={prevBy.get(keyOf(r))?.spendSharePct} fmt={fmtPct} comparing={comparing} />
                <AdCells m={r} prev={prevBy.get(keyOf(r))} comparing={comparing} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
