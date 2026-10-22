'use client';

import type { DsrMetrics } from '@dash/shared';
import { useState } from 'react';

import { Donut, HBars } from '@/components/charts';
import { COLUMNS } from '@/components/dsr-table';
import { getCategory } from '@/lib/api';
import { fmtInt, fmtMoney, fmtPct } from '@/lib/format';

import { Card, MCell, Select, THEAD, TABLE_WRAP, useCompareReport, ViewShell, type RangeProps } from './shared';

function DsrCells({ m, prev, comparing }: { m: DsrMetrics; prev?: DsrMetrics | undefined; comparing: boolean }) {
  return (
    <>
      {COLUMNS.map((c) => (
        <MCell
          key={c.key}
          v={m[c.key] as number | null}
          prev={prev ? (prev[c.key] as number | null) : null}
          fmt={c.fmt}
          metric={c.key}
          comparing={comparing}
        />
      ))}
    </>
  );
}

const SHARE_METRICS = [
  { value: 'sales', label: 'Sales' },
  { value: 'unitsSold', label: 'Units Sold' },
  { value: 'spends', label: 'Spends' },
  { value: 'adSales', label: 'Ad Sales' },
] as const;

/**
 * Category-wise (rule book §10.4): DSR columns by ASIN-mapper category, a
 * share chart, and the ASIN-level table below (filter to one category).
 */
export function CategoryView(props: RangeProps) {
  const [category, setCategory] = useState('');
  const [shareMetric, setShareMetric] = useState<(typeof SHARE_METRICS)[number]['value']>('sales');
  const comparing = !!props.compare;
  const { data, prev, error, loading } = useCompareReport(
    (p) => getCategory(props.profileId, p.from, p.to, { category }),
    [category],
    props
  );
  const prevCat = new Map(prev?.rows.map((r) => [r.category, r]) ?? []);
  const prevAsin = new Map(prev?.asinRows.map((r) => [r.asin, r]) ?? []);
  const cats = data?.categories ?? [];
  const fmtShare = shareMetric === 'unitsSold' ? fmtInt : fmtMoney;

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={<Select label="Category (ASIN table)" value={category} onChange={setCategory} options={cats} allLabel="All categories" />}
    >
      {data && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card
              title="Share by category"
              right={
                <Select
                  label="Metric"
                  value={shareMetric}
                  onChange={(v) => setShareMetric(v as typeof shareMetric)}
                  options={[...SHARE_METRICS]}
                  allLabel={null}
                />
              }
            >
              <Donut
                items={data.rows.map((r) => ({ label: r.category, value: r[shareMetric], prev: prevCat.get(r.category)?.[shareMetric] }))}
                fmt={fmtShare}
                colorKeys={cats}
                comparing={comparing}
              />
            </Card>
            <Card title="ACoS / TACoS by category (top 8 by Sales)">
              <HBars
                items={data.rows.slice(0, 8).map((r) => ({ label: r.category, value: r.tacosPct ?? 0, prev: prevCat.get(r.category)?.tacosPct }))}
                fmt={fmtPct}
                comparing={comparing}
              />
              <p className="mt-2 text-[11px] text-muted">TACoS = Spends ÷ Sales. Lower is better.</p>
            </Card>
          </div>

          <div className={TABLE_WRAP}>
            <table className="w-full border-collapse text-sm">
              <thead className={THEAD}>
                <tr className="text-xs text-muted">
                  <th className="sticky left-0 z-30 bg-surface px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">ASINs</th>
                  <th className="px-3 py-2 text-right font-medium">Sales share</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
                <tr className="border-b border-line bg-accent-soft font-semibold">
                  <td className="sticky left-0 z-30 bg-accent-soft px-3 py-1.5">TOTAL</td>
                  <td className="num px-3 py-1.5 text-right">{fmtInt(data.rows.reduce((a, r) => a + r.asins, 0))}</td>
                  <td className="num px-3 py-1.5 text-right">100%</td>
                  <DsrCells m={data.total} prev={prev?.total} comparing={comparing} />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr
                    key={r.category}
                    onClick={() => setCategory(r.category === category ? '' : r.category)}
                    className={`cursor-pointer border-b border-line/60 hover:bg-canvas ${r.category === category ? 'bg-accent-soft/50' : ''}`}
                    title="Click to show this category's ASINs below"
                  >
                    <td className={`sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1.5 align-top ${r.category === 'Unmapped' || r.category.startsWith('(') ? 'text-warn' : ''}`}>
                      {r.category}
                    </td>
                    <td className="num px-3 py-1.5 text-right align-top">{fmtInt(r.asins)}</td>
                    <td className="num px-3 py-1.5 text-right align-top">{fmtPct(r.salesSharePct)}</td>
                    <DsrCells m={r} prev={prevCat.get(r.category)} comparing={comparing} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <h3 className="pt-2 text-sm font-semibold">
            ASINs {category ? `· ${category}` : '· all categories'}{' '}
            <span className="font-normal text-muted">
              ({data.asinRows.length < data.asinTotal ? `top ${data.asinRows.length} of ` : ''}
              {fmtInt(data.asinTotal)})
            </span>
          </h3>
          <div className={TABLE_WRAP}>
            <table className="w-full border-collapse text-sm">
              <thead className={THEAD}>
                <tr className="text-xs text-muted">
                  <th className="sticky left-0 z-30 w-32 min-w-32 bg-surface px-3 py-2 text-left font-medium">ASIN</th>
                  <th className="min-w-64 px-3 py-2 text-left font-medium">Item-name</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  {COLUMNS.map((c) => (
                    <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.asinRows.map((r) => (
                  <tr key={r.asin || '__missing'} className="border-b border-line/60 hover:bg-canvas">
                    <td className="sticky left-0 z-10 w-32 min-w-32 bg-surface px-3 py-1.5 align-top font-mono text-xs">{r.asin || 'null'}</td>
                    <td className="max-w-80 px-3 py-1.5 align-top">
                      <div className="truncate" title={r.title ?? ''}>
                        {r.title ?? '—'}
                      </div>
                    </td>
                    <td className={`whitespace-nowrap px-3 py-1.5 align-top ${r.category === 'Unmapped' ? 'text-warn' : ''}`}>{r.category}</td>
                    <DsrCells m={r} prev={prevAsin.get(r.asin)} comparing={comparing} />
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ViewShell>
  );
}
