'use client';

import type { AdMetrics } from '@dash/shared';
import { useState } from 'react';

import { Columns } from '@/components/charts';
import { getHourly } from '@/lib/api';
import { fmtPct } from '@/lib/format';

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

const hourLabel = (h: number) => `${String(h).padStart(2, '0')}:00`;

/** Hour-wise: every ad metric by hour of day (from hourly campaign exports). */
export function HourlyView(props: RangeProps) {
  const [filters, setFilters] = useState<AdFilterState>(EMPTY_AD_FILTERS);
  const [channel, setChannel] = useState('');
  const [metric, setMetric] = useState<keyof AdMetrics>('spend');
  const comparing = !!props.compare;
  const { data, prev, error, loading } = useCompareReport(
    (p) => getHourly(props.profileId, p.from, p.to, { channel: channel || 'all', ...filters }),
    [channel, filters.category, filters.adType, filters.targeting, filters.branding],
    props
  );
  const prevBy = new Map(prev?.rows.map((r) => [r.hour, r]) ?? []);
  const label = CHART_METRICS.find((m) => m.value === metric)?.label ?? metric;

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={
        <>
          <Select
            label="Channel"
            value={channel}
            onChange={setChannel}
            options={[
              { value: 'sp', label: 'SP' },
              { value: 'sb', label: 'SB' },
              { value: 'sd', label: 'SD' },
            ]}
          />
          <AdFilterBar value={filters} onChange={setFilters} options={data?.filterOptions} />
          {data && (
            <span className="text-xs text-muted">
              {data.channels.length ? data.channels.map((c) => `${c.channel.toUpperCase()}: ${c.days} day(s)`).join(' · ') : 'No hourly data in range'}
            </span>
          )}
        </>
      }
    >
      {data && (
        <>
          <Card
            title={`${label} by hour`}
            right={<Select label="Metric" value={metric} onChange={(v) => setMetric(v as keyof AdMetrics)} options={CHART_METRICS} allLabel={null} />}
          >
            <Columns
              items={data.rows.map((r) => ({
                label: hourLabel(r.hour),
                value: (r[metric] as number | null) ?? 0,
                prev: (prevBy.get(r.hour)?.[metric] as number | null | undefined) ?? null,
              }))}
              fmt={fmtFor(metric)}
              comparing={comparing}
              height={220}
            />
          </Card>
          <div className={TABLE_WRAP}>
            <table className="w-full border-collapse text-sm">
              <thead className={THEAD}>
                <tr className="text-xs text-muted">
                  <th className="px-3 py-2 text-left font-medium">Hour</th>
                  <th className="px-3 py-2 text-right font-medium">Spend share</th>
                  <AdHeader />
                </tr>
                <tr className="border-b border-line bg-accent-soft font-semibold">
                  <td className="px-3 py-1.5 align-top">TOTAL</td>
                  <td className="num px-3 py-1.5 text-right align-top">100%</td>
                  <AdCells m={data.total} prev={prev?.total} comparing={comparing} />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const p = prevBy.get(r.hour);
                  return (
                    <tr key={r.hour} className="border-b border-line/60 hover:bg-canvas">
                      <td className="num whitespace-nowrap px-3 py-1.5 align-top">{hourLabel(r.hour)}</td>
                      <MCell v={r.spendSharePct} prev={p?.spendSharePct} fmt={fmtPct} comparing={comparing} />
                      <AdCells m={r} prev={p} comparing={comparing} />
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ViewShell>
  );
}
