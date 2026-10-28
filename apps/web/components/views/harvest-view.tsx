'use client';

import type { HarvestResponse, HarvestRow, HarvestSort } from '@dash/shared';
import { useEffect, useState, type ReactNode } from 'react';

import { getHarvest } from '@/lib/api';
import { DASH, fmtDateLong, fmtInt, fmtMoney } from '@/lib/format';

import { Select, TABLE_WRAP, THEAD, ViewShell } from './shared';

const WINDOWS = [7, 30, 60] as const;
const MIN_ORDERS = ['2', '3', '5', '10'];
const CHANNELS = ['SP', 'SB', 'SP & SB'];
const SORTS: Array<{ value: HarvestSort; label: string }> = [
  { value: 'orders', label: 'Orders' },
  { value: 'adSales', label: 'Ad Sales' },
  { value: 'spend', label: 'Spend' },
  { value: 'acos', label: 'ACoS (lowest first)' },
  { value: 'cvr', label: 'Conversion %' },
];

const pct = (v: number | null) => (v == null ? DASH : `${v.toFixed(1)}%`);

function ChannelBadge({ label }: { label: string }) {
  const tone = label === 'SP' ? 'badge-info' : label === 'SB' ? 'badge-secondary' : 'badge-primary';
  return <span className={`badge badge-sm badge-soft whitespace-nowrap ${tone}`}>{label}</span>;
}

/** ✓ already a manual target in this channel / ✗ missing — the gap to harvest into. */
function Manual({ on }: { on: boolean }) {
  return on ? (
    <span className="badge badge-sm badge-soft badge-ghost">Targeted</span>
  ) : (
    <span className="badge badge-sm badge-soft badge-warning">Not targeted</span>
  );
}

const Th = ({ children, right = false, className = '' }: { children: ReactNode; right?: boolean; className?: string }) => (
  <th className={`whitespace-nowrap px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'} ${className}`}>{children}</th>
);
const Num = ({ children, className = '' }: { children: ReactNode; className?: string }) => (
  <td className={`num whitespace-nowrap px-3 py-1.5 text-right ${className}`}>{children}</td>
);

/**
 * Keyword harvesting: SP + SB customer search terms with multiple orders in the
 * last 7 / 30 / 60 days that aren't manual targets in SP, SB or both — which
 * channel the orders came from, and which channel(s) to add the term to.
 */
export function HarvestView({ profileId }: { profileId: string }) {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);
  const [minOrders, setMinOrders] = useState('2');
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [harvestInto, setHarvestInto] = useState('');
  const [performingIn, setPerformingIn] = useState('');
  const [kind, setKind] = useState('');
  const [sort, setSort] = useState<HarvestSort>('orders');
  const [data, setData] = useState<HarvestResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(qDraft.trim()), 350);
    return () => clearTimeout(t);
  }, [qDraft]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getHarvest(profileId, { days: String(days), minOrders, q, harvestInto, performingIn, kind, sort })
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId, days, minOrders, q, harvestInto, performingIn, kind, sort]);

  const k = data?.kpis;

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={
        <>
          <div className="join">
            {WINDOWS.map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`btn btn-sm join-item ${days === d ? 'btn-primary' : 'font-normal'}`}>
                Last {d} days
              </button>
            ))}
          </div>
          <Select label="Min orders" value={minOrders} onChange={setMinOrders} allLabel={null} options={MIN_ORDERS.map((m) => ({ value: m, label: `${m}+` }))} />
          <input value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Search terms…" className="input input-sm w-52" />
          <Select label="Harvest into" value={harvestInto} onChange={setHarvestInto} options={CHANNELS} />
          <Select label="Orders from" value={performingIn} onChange={setPerformingIn} options={CHANNELS} />
          <Select label="Type" value={kind} onChange={setKind} options={['Keyword', 'ASIN']} />
          <Select label="Sort by" value={sort} onChange={(v) => setSort(v as HarvestSort)} allLabel={null} options={SORTS} />
          {data?.from && data.to && (
            <span className="text-xs text-muted">
              {fmtDateLong(data.from)} – {fmtDateLong(data.to)}
            </span>
          )}
        </>
      }
    >
      {data && k && data.to && (
        <>
          <div className="stats stats-vertical w-full border border-line bg-base-100 shadow-sm sm:stats-horizontal">
            {[
              { label: 'Terms to harvest', value: fmtInt(k.terms), desc: `${data.minOrders}+ orders, last ${data.days} days` },
              { label: 'Into SP & SB', value: fmtInt(k.intoBoth), desc: 'not a manual target anywhere' },
              { label: 'Into SP only', value: fmtInt(k.intoSp), desc: 'already manual in SB' },
              { label: 'Into SB only', value: fmtInt(k.intoSb), desc: 'already manual in SP' },
              { label: 'Their orders / ad sales', value: fmtInt(k.orders), desc: fmtMoney(k.adSales) },
            ].map((s) => (
              <div key={s.label} className="stat px-4 py-3">
                <div className="stat-title text-xs">{s.label}</div>
                <div className="stat-value num text-xl">{s.value}</div>
                <div className="stat-desc num">{s.desc}</div>
              </div>
            ))}
          </div>

          <div className={TABLE_WRAP}>
            <table className="table table-sm">
              <thead className={THEAD}>
                <tr className="text-xs text-muted">
                  <Th className="sticky left-0 z-30 min-w-56 bg-base-200">Search term</Th>
                  <Th>Orders from</Th>
                  <Th right>SP orders</Th>
                  <Th right>SB orders</Th>
                  <Th right>Total orders</Th>
                  <Th>Manual in SP</Th>
                  <Th>Manual in SB</Th>
                  <Th>Harvest into</Th>
                  <Th right>Clicks</Th>
                  <Th right>Conv. %</Th>
                  <Th right>Spend</Th>
                  <Th right>Ad Sales</Th>
                  <Th right>ACoS</Th>
                  <Th className="min-w-40">Found via</Th>
                  <Th className="min-w-56">Campaigns</Th>
                </tr>
              </thead>
              <tbody>
                {data.rows.length === 0 && (
                  <tr>
                    <td colSpan={15} className="px-3 py-8 text-center text-muted">
                      Nothing to harvest — every search term with {data.minOrders}+ orders in this window is already a manual target in both SP and SB (or the filters exclude them).
                    </td>
                  </tr>
                )}
                {data.rows.map((r: HarvestRow) => (
                  <tr key={r.searchTerm} className="border-b border-line/60 align-top odd:bg-surface even:bg-stripe hover:bg-accent-soft">
                    <td className="sticky left-0 z-10 max-w-72 bg-inherit px-3 py-1.5 font-medium">
                      {r.searchTerm}
                      {r.kind === 'ASIN' && <span className="ml-1.5 text-[10px] uppercase tracking-wide text-muted">ASIN</span>}
                    </td>
                    <td className="px-3 py-1.5">
                      <ChannelBadge label={r.performingIn} />
                    </td>
                    <Num className={r.spOrders ? '' : 'text-muted/60'}>{fmtInt(r.spOrders)}</Num>
                    <Num className={r.sbOrders ? '' : 'text-muted/60'}>{fmtInt(r.sbOrders)}</Num>
                    <Num className="font-semibold">{fmtInt(r.orders)}</Num>
                    <td className="px-3 py-1.5">
                      <Manual on={r.manualSp} />
                    </td>
                    <td className="px-3 py-1.5">
                      <Manual on={r.manualSb} />
                    </td>
                    <td className="px-3 py-1.5">
                      <ChannelBadge label={r.harvestInto} />
                    </td>
                    <Num>{fmtInt(r.clicks)}</Num>
                    <Num>{pct(r.cvrPct)}</Num>
                    <Num>{fmtMoney(r.spend)}</Num>
                    <Num>{fmtMoney(r.adSales)}</Num>
                    <Num>{pct(r.acosPct)}</Num>
                    <td className="px-3 py-1.5 text-xs">{r.foundVia.join(', ') || DASH}</td>
                    <td className="max-w-72 px-3 py-1.5 text-xs" title={r.campaigns.join('\n')}>
                      {r.campaigns.map((c) => (
                        <div key={c} className="truncate">
                          {c}
                        </div>
                      ))}
                      {r.campaignCount > r.campaigns.length && <div className="text-muted">+{r.campaignCount - r.campaigns.length} more</div>}
                    </td>
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
