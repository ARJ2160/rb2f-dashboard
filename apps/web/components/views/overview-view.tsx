'use client';

import { ratio, type DsrMetrics, type DsrResponse } from '@dash/shared';
import { useEffect } from 'react';

import { ErrorBox, Notes } from '@/components/notes';
import { BreakdownTable, PerformanceOverview, type AxisKind, type OverviewMetric } from '@/components/shell/performance-overview';
import { periodSentence, previousRange, spanDays, useLoad } from '@/components/shell/use-load';
import { getDsr } from '@/lib/api';
import { fmtInt, fmtPct, fmtRupee, fmtRupee2 } from '@/lib/format';

/* Amazon "Ad performance overview" — same layout as Blinkit's, from the DSR endpoint. */

type Get = (m: DsrMetrics) => number | null;
interface Card {
  key: string;
  label: string;
  hint: string;
  get: Get;
  fmt: (v: number | null) => string;
  axis: AxisKind;
  higherIsBetter: boolean;
  /** comes from Seller / Vendor Central (not ads) — a day without sales rows is a gap */
  sales?: boolean;
}

const x2 = (v: number | null) => (v == null ? '—' : v.toFixed(2));

const CARDS: Card[] = [
  { key: 'spend', label: 'Ad Spend', hint: 'SP + SB + SD spend', get: (m) => m.spends, fmt: fmtRupee, axis: 'inr', higherIsBetter: false },
  { key: 'impr', label: 'Impressions', hint: 'Ad impressions', get: (m) => m.impressions, fmt: fmtInt, axis: 'num', higherIsBetter: true },
  { key: 'clicks', label: 'Clicks', hint: 'Ad clicks', get: (m) => m.clicks, fmt: fmtInt, axis: 'num', higherIsBetter: true },
  { key: 'adUnits', label: 'Quantity Sold', hint: 'Units attributed to ads', get: (m) => m.adUnits, fmt: fmtInt, axis: 'num', higherIsBetter: true },
  { key: 'adSales', label: 'Sales', hint: 'Ad-attributed sales', get: (m) => m.adSales, fmt: fmtRupee, axis: 'inr', higherIsBetter: true },
  { key: 'roas', label: 'ROAS', hint: 'Ad sales ÷ ad spend', get: (m) => ratio(m.adSales, m.spends), fmt: x2, axis: 'x', higherIsBetter: true },
  { key: 'acos', label: 'ACoS', hint: 'Ad spend ÷ ad sales', get: (m) => m.acosPct, fmt: fmtPct, axis: 'pct', higherIsBetter: false },
  { key: 'ctr', label: 'CTR', hint: 'Clicks ÷ impressions', get: (m) => m.ctrPct, fmt: fmtPct, axis: 'pct', higherIsBetter: true },
  { key: 'cpc', label: 'CPC', hint: 'Spend ÷ clicks', get: (m) => m.cpc, fmt: fmtRupee2, axis: 'inr', higherIsBetter: false },
  { key: 'sales', label: 'Total Sales', hint: 'Ordered product sales (Seller / Vendor Central)', get: (m) => m.sales, fmt: fmtRupee, axis: 'inr', higherIsBetter: true, sales: true },
  { key: 'units', label: 'Total Units', hint: 'Units ordered (Seller / Vendor Central)', get: (m) => m.unitsSold, fmt: fmtInt, axis: 'num', higherIsBetter: true, sales: true },
  { key: 'tacos', label: 'TACoS', hint: 'Ad spend ÷ total sales', get: (m) => m.tacosPct, fmt: fmtPct, axis: 'pct', higherIsBetter: false, sales: true },
  { key: 'organic', label: 'Organic Sales', hint: 'Total sales − ad sales', get: (m) => m.organicSales, fmt: fmtRupee, axis: 'inr', higherIsBetter: true, sales: true },
];

const CHANNEL: Record<string, string> = { sp: 'Sponsored Products', sb: 'Sponsored Brands', sd: 'Sponsored Display' };

function enumerate(from: string, to: string) {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 86_400_000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

export function AmazonOverview({ profileId, from, to, category, latest, onCategories }: {
  profileId: string;
  from: string;
  to: string;
  category: string;
  latest: string | null;
  onCategories?: (c: string[]) => void;
}) {
  const prev = previousRange({ from, to });
  const { data, error, loading } = useLoad(
    () =>
      Promise.all([getDsr(profileId, from, to, category), getDsr(profileId, prev.from, prev.to, category).catch(() => null)]) as Promise<
        [DsrResponse, DsrResponse | null]
      >,
    [profileId, from, to, category]
  );
  const [cur, before] = data ?? [null, null];
  useEffect(() => {
    if (cur && onCategories) onCategories(cur.categories);
  }, [cur, onCategories]);

  const dates = cur ? enumerate(cur.from, cur.to) : [];
  const byDate = new Map(cur?.rows.map((r) => [r.date, r]) ?? []);
  const n = spanDays({ from, to });

  const metrics: OverviewMetric[] = CARDS.map((c) => ({
    key: c.key,
    label: c.label,
    hint: c.hint,
    value: cur ? c.get(cur.total) : null,
    prev: before ? c.get(before.total) : undefined,
    series: dates.map((d) => {
      const r = byDate.get(d);
      if (!r || (c.sales && r.sales === 0 && r.unitsSold === 0)) return null;
      return c.get(r);
    }),
    fmt: c.fmt,
    axis: c.axis,
    higherIsBetter: c.higherIsBetter,
    neutral: c.key === 'spend',
  }));
  const spendAll = cur?.byChannel.reduce((a, r) => a + r.spend, 0) ?? 0;

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}
      <PerformanceOverview
        title="Ad performance overview"
        subtitle={
          <>
            {periodSentence({ from, to }, latest)}
            {category && <> · {category}</>}
          </>
        }
        dates={dates}
        metrics={metrics}
        defaultSelected={['spend']}
        prevLabel={`prev. ${n} day${n === 1 ? '' : 's'}`}
        loading={loading}
        csvName={`amazon-overview_${from}_${to}`}
      >
        {cur && (
          <BreakdownTable
            title="By ad type"
            head={['Ad type', 'Ad Spend', 'Share', 'Impressions', 'Clicks', 'CTR', 'Quantity Sold', 'Sales', 'ROAS']}
            rows={cur.byChannel
              .filter((r) => r.spend > 0 || r.impressions > 0)
              .map((r) => ({
                key: r.channel,
                cells: [
                  CHANNEL[r.channel] ?? r.channel.toUpperCase(),
                  fmtRupee(r.spend),
                  spendAll ? fmtPct((r.spend / spendAll) * 100) : '—',
                  fmtInt(r.impressions),
                  fmtInt(r.clicks),
                  r.impressions ? fmtPct((r.clicks / r.impressions) * 100) : '—',
                  fmtInt(r.adUnits),
                  fmtRupee(r.adSales),
                  r.spend ? (r.adSales / r.spend).toFixed(2) : '—',
                ],
              }))}
          />
        )}
      </PerformanceOverview>
      {cur && <Notes notes={cur.notes} />}
    </div>
  );
}
