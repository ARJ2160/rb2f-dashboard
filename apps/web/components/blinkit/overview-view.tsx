'use client';

import { AD_TYPE_LABEL, METRICS, metricValue, type BkDailyResponse, type MetricKey, type Sums } from '@dash/shared/blinkit';

import { ErrorBox, Notes } from '@/components/notes';
import { BreakdownTable, PerformanceOverview, type AxisKind, type OverviewMetric } from '@/components/shell/performance-overview';
import { periodSentence, previousRange, spanDays, useLoad } from '@/components/shell/use-load';
import { bkDsr } from '@/lib/blinkit-api';
import { fmtInt, fmtPct, fmtRupee, fmtRupee2 } from '@/lib/format';

import { bkFmt } from './cells';

/* Blinkit "Ad performance overview" (Brand Central layout): ad cards first in
   Brand Central's order, then the sales side the ads report doesn't have. */

const CARDS: Array<{ k: MetricKey; label: string; hint: string }> = [
  { k: 'spend', label: 'Budget Spent', hint: 'Estimated Budget Consumed across PL, PR and BL campaigns' },
  { k: 'impr', label: 'Impressions', hint: 'Ad impressions' },
  { k: 'atc', label: 'ATC', hint: 'Add to carts from ads (direct + indirect)' },
  { k: 'aunits', label: 'Quantity Sold', hint: 'Units sold through ads (direct + indirect)' },
  { k: 'asales', label: 'Sales', hint: 'Ad sales (direct + indirect), as Blinkit reports them' },
  { k: 'roas', label: 'ROAS', hint: 'Ad sales ÷ budget spent' },
  { k: 'cpm', label: 'CPM', hint: 'Spend per 1,000 impressions' },
  { k: 'atcr', label: 'ATC %', hint: 'Add to carts ÷ impressions' },
  { k: 'nu', label: 'New Users', hint: 'New users acquired by ads' },
  { k: 'rev', label: 'Total Revenue', hint: 'All Blinkit sales (Sales report, Total Gross Bill Amount) — ads and organic' },
  { k: 'units', label: 'Total Units', hint: 'All units sold (Sales report)' },
  { k: 'orders', label: 'Orders', hint: 'Distinct orders (Sales report)' },
  { k: 'tacos', label: 'TACoS', hint: 'Budget spent ÷ total revenue' },
  { k: 'organic', label: 'Organic Sales', hint: 'Total revenue − ad sales' },
];

const AXIS: Record<string, AxisKind> = { inr: 'inr', inr1: 'inr', num: 'num', pct: 'pct', pct2: 'pct', x2: 'x', pos: 'num' };
const val = (k: MetricKey, s: Sums | null | undefined) => {
  if (!s) return null;
  const v = metricValue(k, s);
  return Number.isFinite(v) ? v : null;
};
/** A day with no sales rows means the Sales file doesn't cover it — show a gap, not a zero. */
const salesGap = (k: MetricKey, s: Sums) => METRICS[k].needs !== 'ads' && s.rev === 0 && s.orders === 0;

export function BkOverview({ profileId, from, to, category, adType, latest }: {
  profileId: string;
  from: string;
  to: string;
  category: string;
  adType: string;
  latest: string | null;
}) {
  const prev = previousRange({ from, to });
  const { data, error, loading } = useLoad(
    () =>
      Promise.all([
        bkDsr(profileId, { from, to, category, adType }),
        bkDsr(profileId, { ...prev, category, adType }).catch(() => null),
      ]) as Promise<[BkDailyResponse, BkDailyResponse | null]>,
    [profileId, from, to, category, adType]
  );
  const [cur, before] = data ?? [null, null];
  const n = spanDays({ from, to });

  const metrics: OverviewMetric[] = CARDS.map(({ k, label, hint }) => ({
    key: k,
    label,
    hint,
    value: cur ? val(k, cur.total) : null,
    prev: before ? val(k, before.total) : undefined,
    series: cur ? cur.series.map((s) => (salesGap(k, s) ? null : val(k, s))) : [],
    fmt: METRICS[k].fmt === 'inr' ? fmtRupee : METRICS[k].fmt === 'inr1' ? fmtRupee2 : (v) => bkFmt(k, v),
    axis: AXIS[METRICS[k].fmt] ?? 'num',
    higherIsBetter: METRICS[k].higherIsBetter,
    neutral: k === 'spend',
  }));

  const spendAll = cur?.byAdType.reduce((a, r) => a + r.spend, 0) ?? 0;
  const typeLabel = adType ? AD_TYPE_LABEL[adType] ?? adType : null;

  return (
    <div className="space-y-6">
      {error && <ErrorBox message={error} />}
      <PerformanceOverview
        title="Ad performance overview"
        subtitle={
          <>
            {periodSentence({ from, to }, latest)}
            {typeLabel && <> · {typeLabel} campaigns</>}
            {category && <> · {category}</>}
          </>
        }
        dates={cur?.dates ?? []}
        metrics={metrics}
        defaultSelected={['spend']}
        prevLabel={`prev. ${n} day${n === 1 ? '' : 's'}`}
        loading={loading}
        csvName={`blinkit-overview_${from}_${to}`}
      >
        {cur && (
          <BreakdownTable
            title="By campaign type"
            head={['Campaign type', 'Budget Spent', 'Share', 'Impressions', 'ATC', 'Quantity Sold', 'Sales', 'ROAS', 'CPM']}
            rows={cur.byAdType
              .filter((r) => r.spend > 0 || r.impr > 0)
              .map((r) => ({
                key: r.adType,
                cells: [
                  AD_TYPE_LABEL[r.adType] ?? r.adType,
                  fmtRupee(r.spend),
                  spendAll ? fmtPct((r.spend / spendAll) * 100) : '—',
                  fmtInt(r.impr),
                  fmtInt(r.atc),
                  fmtInt(r.aunits),
                  fmtRupee(r.asales),
                  r.spend ? (r.asales / r.spend).toFixed(2) : '—',
                  r.impr ? fmtRupee2((r.spend / r.impr) * 1000) : '—',
                ],
              }))}
          />
        )}
      </PerformanceOverview>
      {cur && <Notes notes={cur.notes} />}
    </div>
  );
}
