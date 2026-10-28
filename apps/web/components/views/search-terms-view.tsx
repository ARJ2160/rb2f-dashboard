'use client';

import { useEffect, useState } from 'react';

import { Donut, HBars } from '@/components/charts';
import { getSearchTerms } from '@/lib/api';
import { fmtInt, fmtMoney } from '@/lib/format';

import {
  AdCells,
  AdFilterBar,
  AdHeader,
  Card,
  EMPTY_AD_FILTERS,
  Select,
  THEAD,
  TABLE_WRAP,
  useCompareReport,
  ViewShell,
  type AdFilterState,
  type RangeProps,
} from './shared';

const CHANNELS = [
  { value: 'sp', label: 'SP' },
  { value: 'sb', label: 'SB' },
  { value: 'sd', label: 'SD (targets)' },
];
const SORTS = [
  { value: 'adSales', label: 'Ad Sales' },
  { value: 'clicks', label: 'Clicks' },
  { value: 'impressions', label: 'Impressions' },
  { value: 'adUnits', label: 'Ad Units' },
];
const BRAND_KEYS = ['Branded', 'Competitor', 'Generic'];

function List({ items, total, className = '' }: { items: string[]; total: number; className?: string }) {
  if (!items.length) return <span className="text-muted">—</span>;
  const shown = items.slice(0, 3);
  return (
    <div className={`space-y-0.5 text-xs ${className}`} title={items.join('\n')}>
      {shown.map((t) => (
        <div key={t} className="truncate">
          {t}
        </div>
      ))}
      {total > shown.length && <div className="text-muted">+{total - shown.length} more</div>}
    </div>
  );
}

/** Search Terms: SP + SB search terms and SD targets, with the targets that triggered them and their campaigns. */
export function SearchTermsView(props: RangeProps) {
  const [filters, setFilters] = useState<AdFilterState>(EMPTY_AD_FILTERS);
  const [channel, setChannel] = useState('');
  const [sort, setSort] = useState('');
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(qDraft.trim()), 350);
    return () => clearTimeout(t);
  }, [qDraft]);
  const comparing = !!props.compare;

  const { data, prev, error, loading } = useCompareReport(
    (p) => getSearchTerms(props.profileId, p.from, p.to, { channel: channel || 'all', ...filters, q, sort: sort || 'spend' }),
    [channel, filters.category, filters.adType, filters.targeting, filters.branding, q, sort],
    props
  );
  const prevBy = new Map(prev?.rows.map((r) => [r.searchTerm, r]) ?? []);

  // Branding mix of the listed terms (spend).
  const mix = BRAND_KEYS.map((k) => ({
    label: k,
    value: data?.rows.filter((r) => r.branding === k).reduce((a, r) => a + r.spend, 0) ?? 0,
    prev: prev?.rows.filter((r) => r.branding === k).reduce((a, r) => a + r.spend, 0),
  }));

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={
        <>
          <input
            value={qDraft}
            onChange={(e) => setQDraft(e.target.value)}
            placeholder="Search terms…"
            className="input input-sm w-52"
          />
          <Select label="Channel" value={channel} onChange={setChannel} options={CHANNELS} />
          <AdFilterBar value={filters} onChange={setFilters} options={data?.filterOptions} />
          <Select label="Sort by" value={sort} onChange={setSort} options={SORTS} allLabel="Spend" />
        </>
      }
    >
      {data && (
        <>
          <div className="grid gap-3 lg:grid-cols-2">
            <Card title="Top 10 terms by spend">
              <HBars
                items={[...data.rows]
                  .sort((a, b) => b.spend - a.spend)
                  .slice(0, 10)
                  .map((r) => ({ label: r.searchTerm, value: r.spend, prev: prevBy.get(r.searchTerm)?.spend }))}
                fmt={fmtMoney}
                comparing={comparing}
              />
            </Card>
            <Card title={`Spend by branding (listed ${fmtInt(data.rows.length)} terms)`}>
              <Donut items={mix} fmt={fmtMoney} colorKeys={BRAND_KEYS} comparing={comparing} />
            </Card>
          </div>
          <div className={TABLE_WRAP}>
            <table className="table table-sm">
              <thead className={THEAD}>
                <tr className="text-xs text-muted">
                  <th className="sticky left-0 z-30 min-w-64 bg-base-200 px-3 py-2 text-left font-medium">Search term</th>
                  <th className="px-3 py-2 text-left font-medium">Channel</th>
                  <th className="px-3 py-2 text-left font-medium">Branding</th>
                  <th className="min-w-56 px-3 py-2 text-left font-medium">Targeting</th>
                  <th className="min-w-64 px-3 py-2 text-left font-medium">Campaigns</th>
                  <AdHeader />
                </tr>
                <tr className="border-b border-line bg-accent-soft font-semibold">
                  <td className="sticky left-0 z-30 bg-accent-soft px-3 py-1.5">TOTAL · {fmtInt(data.totalTerms)} terms</td>
                  <td colSpan={4} />
                  <AdCells m={data.total} prev={prev?.total} comparing={comparing} />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.searchTerm} className="border-b border-line/60 align-top odd:bg-surface even:bg-stripe hover:bg-accent-soft">
                    <td className="sticky left-0 z-10 max-w-80 bg-inherit px-3 py-1.5">
                      <div className="truncate" title={r.searchTerm}>
                        {r.searchTerm}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">{r.channels}</td>
                    <td className={`whitespace-nowrap px-3 py-1.5 text-xs ${r.branding === 'Competitor' ? 'text-warn' : ''}`}>{r.branding}</td>
                    <td className="max-w-72 px-3 py-1.5">
                      <div className="mb-0.5 text-[10px] uppercase tracking-wide text-muted">{r.targetTypes.join(' · ')}</div>
                      <List items={r.targets} total={r.targetCount} />
                    </td>
                    <td className="max-w-80 px-3 py-1.5">
                      <List items={r.campaignNames} total={r.campaigns} />
                    </td>
                    <AdCells m={r} prev={prevBy.get(r.searchTerm)} comparing={comparing} />
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
