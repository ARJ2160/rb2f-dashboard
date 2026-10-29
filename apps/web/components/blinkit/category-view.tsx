'use client';

import { METRICS, type BkDailyResponse, type BkGroupsResponse, type MetricKey } from '@dash/shared/blinkit';
import { useState } from 'react';

import { Columns, Donut, HBars } from '@/components/charts';
import { ErrorBox, Notes } from '@/components/notes';
import { Card, Select } from '@/components/views/shared';
import { bkDsr, bkGroups } from '@/lib/blinkit-api';
import { fmtDay, fmtInt, fmtMoney, fmtPct } from '@/lib/format';

import { BkCell, bkFmt, bkVal, days, ROW, TD_LEFT, TH, TH_LEFT, type BkViewProps } from './cells';
import { useLoad } from './dsr-dur';

const COLS: MetricKey[] = ['rev', 'orders', 'units', 'aov', 'spend', 'asales', 'organic', 'acos', 'tacos', 'roas', 'cpm', 'impr', 'atcr', 'cvr', 'mvp'];
const SHARE: Array<{ value: MetricKey; label: string }> = [
  { value: 'rev', label: 'Sales' },
  { value: 'units', label: 'Units' },
  { value: 'spend', label: 'Spends' },
  { value: 'asales', label: 'Ad Sales' },
];
const TREND: MetricKey[] = ['rev', 'orders', 'units', 'spend', 'asales', 'tacos', 'acos', 'roas', 'impr', 'cpm'];

/** Category / SKU performance (the mock-up's Main View + Comparison), with the period B deltas when comparing. */
export function CategoryView(p: BkViewProps) {
  const [groupBy, setGroupBy] = useState<'category' | 'sku'>('category');
  const [share, setShare] = useState<MetricKey>('rev');
  const [trend, setTrend] = useState<MetricKey>('rev');
  const cmp = p.compare;
  const deps = [p.profileId, p.from, p.to, p.category, groupBy, cmp?.from, cmp?.to];
  const { data, error, loading } = useLoad(
    () =>
      Promise.all([
        bkGroups(p.profileId, p, groupBy),
        cmp ? bkGroups(p.profileId, { ...cmp, category: p.category }, groupBy) : Promise.resolve(null),
        bkDsr(p.profileId, p),
      ]) as Promise<[BkGroupsResponse, BkGroupsResponse | null, BkDailyResponse]>,
    deps
  );
  const comparing = !!cmp;
  const [cur, prev, daily] = data ?? [null, null, null];
  const prevBy = new Map(prev?.groups.map((g) => [g.key, g.sums]) ?? []);
  const dA = days(p), dB = cmp ? days(cmp) : 1;
  const label = groupBy === 'sku' ? 'SKU' : 'Category';

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          label="Group by"
          value={groupBy}
          onChange={(v) => setGroupBy(v as 'category' | 'sku')}
          allLabel={null}
          options={[
            { value: 'category', label: 'Category' },
            { value: 'sku', label: 'SKU' },
          ]}
        />
        {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
      </div>
      {error && <ErrorBox message={error} />}
      {cur && daily && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card
              title={`Share by ${label.toLowerCase()}`}
              right={<Select label="Metric" value={share} onChange={(v) => setShare(v as MetricKey)} options={SHARE} allLabel={null} />}
            >
              <Donut
                items={cur.groups.map((g) => ({ label: g.key, value: bkVal(share, g.sums) ?? 0, prev: prevBy.has(g.key) ? bkVal(share, prevBy.get(g.key)!) : null }))}
                fmt={share === 'units' ? fmtInt : fmtMoney}
                comparing={comparing}
              />
            </Card>
            <Card title={`TACoS by ${label.toLowerCase()} (top 8 by Sales)`}>
              <HBars
                items={cur.groups
                  .filter((g) => g.sums.rev > 0)
                  .slice(0, 8)
                  .map((g) => ({ label: g.key, value: bkVal('tacos', g.sums) ?? 0, prev: prevBy.has(g.key) ? bkVal('tacos', prevBy.get(g.key)!) : null }))}
                fmt={fmtPct}
                comparing={comparing}
              />
              <p className="mt-2 text-[11px] text-muted">TACoS = Spends ÷ Sales. Lower is better.</p>
            </Card>
          </div>

          <Card
            title="Daily trend"
            right={
              <Select label="Metric" value={trend} onChange={(v) => setTrend(v as MetricKey)} allLabel={null} options={TREND.map((k) => ({ value: k, label: METRICS[k].label }))} />
            }
          >
            <Columns
              items={daily.dates.map((d, i) => ({ label: fmtDay(d), value: bkVal(trend, daily.series[i]!) ?? 0 }))}
              fmt={(v) => bkFmt(trend, v)}
            />
          </Card>

          <div className="max-h-[70vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
            <table className="table table-sm">
              <thead className="sticky top-0 z-20 bg-base-200 shadow-[0_1px_0_var(--color-line)]">
                <tr className="text-xs text-muted">
                  <th className={TH_LEFT}>{label}</th>
                  <th className={TH}>Sales share</th>
                  {COLS.map((c) => (
                    <th key={c} className={TH}>
                      {METRICS[c].label}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-line bg-accent-soft font-semibold">
                  <td className="sticky left-0 z-30 bg-accent-soft px-3 py-1.5">TOTAL</td>
                  <td className="num px-3 py-1.5 text-right">100%</td>
                  {COLS.map((c) => (
                    <BkCell key={c} k={c} s={cur.total} prev={prev?.total} comparing={comparing} daysA={dA} daysB={dB} />
                  ))}
                </tr>
              </thead>
              <tbody>
                {cur.groups.map((g) => (
                  <tr key={g.key} className={ROW}>
                    <td className={`${TD_LEFT} ${g.key === 'Unmapped' || g.key.endsWith('(no SKU)') ? 'text-warn' : ''}`}>{g.key}</td>
                    <td className="num px-3 py-1.5 text-right align-top">{cur.total.rev ? fmtPct((g.sums.rev / cur.total.rev) * 100) : '—'}</td>
                    {COLS.map((c) => (
                      <BkCell key={c} k={c} s={g.sums} prev={prevBy.get(g.key)} comparing={comparing} daysA={dA} daysB={dB} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Notes
            notes={[
              `Sales join to a ${label.toLowerCase()} through the SKU mapper (Item ID / product name); ads through the campaign mapper's ${groupBy === 'sku' ? 'SKU' : 'Category'}.`,
              ...(groupBy === 'sku'
                ? ['Campaigns whose mapper SKU covers several products (e.g. "Jam", "FH & TH") or has no SKU stay as their own ad-only rows — never split.']
                : []),
              ...(comparing && dA !== dB ? [`The two periods differ in length (${dA} vs ${dB} days), so volume changes are per day.`] : []),
              ...daily.notes,
            ]}
          />
        </>
      )}
    </div>
  );
}
