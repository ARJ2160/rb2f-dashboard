'use client';

import type { AdGroupRow, AdMetrics } from '@dash/shared';
import { useEffect, useState, type ReactNode } from 'react';

import { Donut } from '@/components/charts';
import { getAds, getBrandTerms, saveBrandTerms } from '@/lib/api';
import { fmtInt, fmtMoney, fmtPct } from '@/lib/format';

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
  useCompareReport,
  ViewShell,
  type AdFilterState,
  type RangeProps,
} from './shared';

const AD_TYPE_ORDER = ['SP', 'SB', 'SBV', 'SD', 'SDV'];
const TARGET_ORDER = ['Keyword', 'Product', 'Category', 'Auto', 'Audience', 'Other'];
const BRAND_ORDER = ['Branded', 'Competitor', 'Generic'];

/**
 * Ads Analysis: ad types (campaign level), targeting types and
 * Branded / Competitor / Generic (search-term level), each as a donut + table.
 */
export function AdsView(props: RangeProps) {
  const [filters, setFilters] = useState<AdFilterState>(EMPTY_AD_FILTERS);
  const [metric, setMetric] = useState<keyof AdMetrics>('spend');
  const [termsVersion, setTermsVersion] = useState(0);
  const comparing = !!props.compare;
  const { data, prev, error, loading } = useCompareReport(
    (p) => getAds(props.profileId, p.from, p.to, { ...filters }),
    [filters.category, filters.adType, filters.targeting, filters.branding, termsVersion],
    props
  );

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={
        <>
          <AdFilterBar value={filters} onChange={setFilters} options={data?.filterOptions} />
          <Select label="Chart metric" value={metric} onChange={(v) => setMetric(v as keyof AdMetrics)} options={CHART_METRICS} allLabel={null} />
        </>
      }
    >
      {data && (
        <>
          <Section
            title="Ad types"
            keyLabel="Ad type"
            countLabel="Campaigns"
            order={AD_TYPE_ORDER}
            group={data.adTypes}
            prev={prev?.adTypes}
            metric={metric}
            comparing={comparing}
          />
          <Section
            title="Targeting"
            keyLabel="Targeting"
            countLabel="Search terms"
            order={TARGET_ORDER}
            group={data.targeting}
            prev={prev?.targeting}
            metric={metric}
            comparing={comparing}
          />
          <Section
            title="Branded · Competitor · Generic"
            keyLabel="Class"
            countLabel="Search terms"
            order={BRAND_ORDER}
            group={data.branding}
            prev={prev?.branding}
            metric={metric}
            comparing={comparing}
            extra={<BrandTerms profileId={props.profileId} onSaved={() => setTermsVersion((v) => v + 1)} />}
          />
        </>
      )}
    </ViewShell>
  );
}

function Section({ title, keyLabel, countLabel, order, group, prev, metric, comparing, extra }: {
  title: string;
  keyLabel: string;
  countLabel: string;
  order: string[];
  group: { total: AdMetrics; rows: AdGroupRow[] };
  prev: { total: AdMetrics; rows: AdGroupRow[] } | undefined;
  metric: keyof AdMetrics;
  comparing: boolean;
  extra?: ReactNode;
}) {
  const prevBy = new Map(prev?.rows.map((r) => [r.key, r]) ?? []);
  const rank = (k: string) => (order.indexOf(k) < 0 ? 99 : order.indexOf(k));
  const rows = [...group.rows].sort((a, b) => rank(a.key) - rank(b.key) || b.spend - a.spend);
  const colorKeys = [...order, ...rows.map((r) => r.key).filter((k) => !order.includes(k))];
  const label = CHART_METRICS.find((m) => m.value === metric)?.label ?? metric;
  // Donuts show part-to-whole, so only additive metrics make sense there.
  const additive = ['impressions', 'clicks', 'spend', 'adSales', 'adUnits'].includes(metric);
  const m = additive ? metric : 'spend';

  return (
    <Card title={title} right={extra}>
      <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
        <div>
          <div className="mb-2 text-xs text-muted">{additive ? label : 'Spend'} share</div>
          <Donut
            items={rows.map((r) => ({ label: r.key, value: (r[m] as number | null) ?? 0, prev: prevBy.get(r.key)?.[m] as number | null | undefined }))}
            fmt={fmtFor(m)}
            colorKeys={colorKeys}
            comparing={comparing}
            size={150}
          />
        </div>
        <div className="overflow-auto">
          <table className="table table-sm">
            <thead className={THEAD}>
              <tr className="text-xs text-muted">
                <th className="px-3 py-2 text-left font-medium">{keyLabel}</th>
                <th className="px-3 py-2 text-right font-medium">{countLabel}</th>
                <th className="px-3 py-2 text-right font-medium">Spend share</th>
                <AdHeader />
              </tr>
              <tr className="border-b border-line bg-accent-soft font-semibold">
                <td className="px-3 py-1.5 align-top" colSpan={2}>
                  TOTAL
                </td>
                <td className="num px-3 py-1.5 text-right align-top">100%</td>
                <AdCells m={group.total} prev={prev?.total} comparing={comparing} />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const p = prevBy.get(r.key);
                return (
                  <tr key={r.key} className="border-b border-line/60 odd:bg-surface even:bg-stripe hover:bg-accent-soft">
                    <td className="whitespace-nowrap px-3 py-1.5 align-top font-medium">{r.key}</td>
                    <MCell v={r.count} prev={p?.count} fmt={fmtInt} comparing={comparing} />
                    <MCell v={r.spendSharePct} prev={p?.spendSharePct} fmt={fmtPct} comparing={comparing} />
                    <AdCells m={r} prev={p} comparing={comparing} />
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={13} className="px-3 py-4 text-center text-xs text-muted">
                    No data for this period / filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

/** Edit the words that make a search term "Branded" (competitor = foreign ASIN codes, everything else generic). */
function BrandTerms({ profileId, onSaved }: { profileId: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    getBrandTerms(profileId)
      .then((r) => setText(r.terms.join(', ')))
      .catch(() => undefined);
  }, [profileId]);
  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="btn btn-link btn-xs px-0">
        Brand terms: {text || '—'}
      </button>
    );
  }
  const save = () => {
    setBusy(true);
    setMsg(null);
    saveBrandTerms(
      profileId,
      text.split(/[,\n]/).map((t) => t.trim()).filter(Boolean)
    )
      .then((r) => {
        setText(r.terms.join(', '));
        setOpen(false);
        onSaved();
      })
      .catch((e: Error) => setMsg(e.message))
      .finally(() => setBusy(false));
  };
  return (
    <div className="flex items-center gap-2 text-xs">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="cult, avant"
        className="input input-sm w-56"
      />
      <button disabled={busy} onClick={save} className="btn btn-sm btn-neutral">
        {busy ? 'Reclassifying…' : 'Save'}
      </button>
      <button onClick={() => setOpen(false)} className="btn btn-ghost btn-sm">
        Cancel
      </button>
      {msg && <span className="text-bad">{msg}</span>}
    </div>
  );
}
