'use client';

import { useState } from 'react';

import { IndiaMap, type MapMetric } from '@/components/india-map';
import { getStates } from '@/lib/api';
import { fmtInt, fmtMoney, fmtPct } from '@/lib/format';

import { Card, MCell, Select, THEAD, TABLE_WRAP, useCompareReport, ViewShell, type RangeProps } from './shared';

const METRICS: Array<{ value: MapMetric; label: string }> = [
  { value: 'sales', label: 'Sales' },
  { value: 'units', label: 'Units' },
  { value: 'orders', label: 'Orders' },
];

/** State Wise Data (rule book §8 name): Seller Order report + Vendor Central State view. */
export function StatesView(props: RangeProps) {
  const [source, setSource] = useState('');
  const [category, setCategory] = useState('');
  const [metric, setMetric] = useState<MapMetric>('sales');
  const comparing = !!props.compare;
  const { data, prev, error, loading } = useCompareReport(
    (p) => getStates(props.profileId, p.from, p.to, { source: source || 'all', category }),
    [source, category],
    props
  );
  const prevBy = new Map(prev?.rows.map((r) => [r.state, r]) ?? []);

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={
        <>
          <Select
            label="Source"
            value={source}
            onChange={setSource}
            options={[
              { value: 'seller', label: 'Seller Central' },
              { value: 'vendor', label: 'Vendor Central' },
            ]}
          />
          {data && data.categories.length > 0 && <Select label="Category" value={category} onChange={setCategory} options={data.categories} />}
          <Select label="Map metric" value={metric} onChange={(v) => setMetric(v as MapMetric)} options={METRICS} allLabel={null} />
          {data && (
            <span className="text-xs text-muted">
              {data.sources.map((s) => `${s.source === 'seller' ? 'Seller' : 'Vendor'}: ${s.days} day(s)`).join(' · ')}
            </span>
          )}
        </>
      }
    >
      {data && (
        <>
          <Card title={`${METRICS.find((m) => m.value === metric)!.label} by state`}>
            <IndiaMap rows={data.rows} prev={prev?.rows ?? null} metric={metric} />
          </Card>
          <div className={TABLE_WRAP}>
            <table className="table table-sm">
              <thead className={THEAD}>
                <tr className="text-xs text-muted">
                  <th className="px-3 py-2 text-left font-medium">State</th>
                  <th className="px-3 py-2 text-right font-medium">Sales</th>
                  <th className="px-3 py-2 text-right font-medium">Sales share</th>
                  <th className="px-3 py-2 text-right font-medium">Units</th>
                  <th className="px-3 py-2 text-right font-medium">Units share</th>
                  <th className="px-3 py-2 text-right font-medium">Orders</th>
                  <th className="px-3 py-2 text-right font-medium">ASINs</th>
                </tr>
                <tr className="border-b border-line bg-accent-soft font-semibold">
                  <td className="px-3 py-1.5 align-top">TOTAL · {data.rows.length} states</td>
                  <MCell v={data.total.sales} prev={prev?.total.sales} fmt={fmtMoney} comparing={comparing} />
                  <td className="num px-3 py-1.5 text-right align-top">100%</td>
                  <MCell v={data.total.units} prev={prev?.total.units} fmt={fmtInt} comparing={comparing} />
                  <td className="num px-3 py-1.5 text-right align-top">100%</td>
                  <MCell v={data.total.orders} prev={prev?.total.orders} fmt={fmtInt} comparing={comparing} />
                  <MCell v={data.total.asins} prev={prev?.total.asins} fmt={fmtInt} comparing={comparing} />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => {
                  const p = prevBy.get(r.state);
                  return (
                    <tr key={r.state} className="border-b border-line/60 odd:bg-surface even:bg-stripe hover:bg-accent-soft">
                      <td className="whitespace-nowrap px-3 py-1.5 align-top">{r.state}</td>
                      <MCell v={r.sales} prev={p?.sales} fmt={fmtMoney} comparing={comparing} />
                      <MCell v={r.salesSharePct} prev={p?.salesSharePct} fmt={fmtPct} comparing={comparing} />
                      <MCell v={r.units} prev={p?.units} fmt={fmtInt} comparing={comparing} />
                      <MCell v={r.unitsSharePct} prev={p?.unitsSharePct} fmt={fmtPct} comparing={comparing} />
                      <MCell v={r.orders} prev={p?.orders} fmt={fmtInt} comparing={comparing} />
                      <MCell v={r.asins} prev={p?.asins} fmt={fmtInt} comparing={comparing} />
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
