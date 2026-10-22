import type { DsrMetrics, DsrResponse } from '@dash/shared';

import { fmtDateLong, fmtInt, fmtMoney, fmtPct } from '@/lib/format';

/** Columns in rule-book order (§10.1). */
export const COLUMNS: Array<{ key: keyof DsrMetrics; label: string; fmt: (v: number | null) => string }> = [
  { key: 'sales', label: 'Sales', fmt: fmtMoney },
  { key: 'unitsSold', label: 'Units Sold', fmt: fmtInt },
  { key: 'aov', label: 'AOV', fmt: fmtMoney },
  { key: 'impressions', label: 'Impressions', fmt: fmtInt },
  { key: 'clicks', label: 'Clicks', fmt: fmtInt },
  { key: 'spends', label: 'Spends', fmt: fmtMoney },
  { key: 'adSales', label: 'Ad Sales', fmt: fmtMoney },
  { key: 'adUnits', label: 'Ad Units', fmt: fmtInt },
  { key: 'cpc', label: 'CPC', fmt: fmtMoney },
  { key: 'ctrPct', label: 'CTR %', fmt: fmtPct },
  { key: 'adCrPct', label: 'Ad CR %', fmt: fmtPct },
  { key: 'acosPct', label: 'ACoS', fmt: fmtPct },
  { key: 'tacosPct', label: 'TACoS', fmt: fmtPct },
  { key: 'pageViews', label: 'Page Views', fmt: fmtInt },
  { key: 'organicSales', label: 'Organic Sales', fmt: fmtMoney },
];

export function Cells({ m }: { m: DsrMetrics }) {
  return (
    <>
      {COLUMNS.map((c) => (
        <td key={c.key} className="num whitespace-nowrap px-3 py-1.5 text-right">
          {c.fmt(m[c.key] as number | null)}
        </td>
      ))}
    </>
  );
}

const CHANNEL_LABEL = { sp: 'SP', sb: 'SB', sd: 'SD' } as const;

/** SP / SB / SD split of ad spend for the range — the DSR rows combine all three. */
export function ChannelSplit({ data }: { data: DsrResponse }) {
  const total = data.byChannel.reduce((a, c) => a + c.spend, 0);
  return (
    <div className="flex flex-wrap gap-2">
      {data.byChannel.map((c) => (
        <div key={c.channel} className="min-w-44 rounded-md border border-line bg-surface px-3 py-2">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs font-semibold">{CHANNEL_LABEL[c.channel]}</span>
            <span className={`text-xs ${c.days ? 'text-muted' : 'text-warn'}`}>
              {c.days ? `${c.days}/${data.days} days` : 'no data'}
            </span>
          </div>
          <div className="num mt-0.5 text-sm">
            Spend {fmtMoney(c.spend)}
            <span className="text-muted"> · {total ? fmtPct((c.spend / total) * 100) : '—'}</span>
          </div>
          <div className="num text-xs text-muted">Ad Sales {fmtMoney(c.adSales)} · ACoS {c.adSales ? fmtPct((c.spend / c.adSales) * 100) : '—'}</div>
          {c.days > 0 && (
            <div className={`text-xs ${c.campaignDays ? 'text-warn' : 'text-muted'}`}>
              {c.campaignDays === 0
                ? c.channel === 'sb'
                  ? 'Source: SB Attributed Purchases (spend prorated)'
                  : 'Source: Advertised Product'
                : `${c.campaignDays} day(s) from campaign report`}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function DsrTable({ data }: { data: DsrResponse }) {
  return (
    <div className="max-h-[70vh] overflow-auto rounded-md border border-line bg-surface">
      <table className="w-full border-collapse text-sm">
        <thead className="sticky top-0 z-20 bg-surface shadow-[0_1px_0_var(--color-line)]">
          <tr className="text-xs text-muted">
            <th className="sticky left-0 z-30 bg-surface px-3 py-2 text-left font-medium">Date</th>
            {COLUMNS.map((c) => (
              <th key={c.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">
                {c.label}
              </th>
            ))}
          </tr>
          <tr className="bg-accent-soft font-semibold">
            <td className="sticky left-0 z-30 bg-accent-soft px-3 py-1.5">TOTAL</td>
            <Cells m={data.total} />
          </tr>
          <tr className="border-b border-line bg-canvas font-medium">
            <td className="sticky left-0 z-30 bg-canvas px-3 py-1.5">AVG</td>
            <Cells m={data.avg} />
          </tr>
        </thead>
        <tbody>
          {data.rows.map((r) => (
            <tr key={r.date} className="border-b border-line/60 hover:bg-canvas">
              <td className="sticky left-0 z-10 whitespace-nowrap bg-surface px-3 py-1.5">{fmtDateLong(r.date)}</td>
              <Cells m={r} />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
