'use client';

import type { SqpPeriod, SqpResponse, SqpRow, SqpSort, SqpStrength, SqpView as View } from '@dash/shared';
import { Fragment, useEffect, useState, type ReactNode } from 'react';

import { getSqp } from '@/lib/api';
import { DASH, fmtDateLong, fmtInt, fmtMoney } from '@/lib/format';

import { Select, TABLE_WRAP, THEAD, ViewShell } from './shared';

const OPP_SORTS: Array<{ value: SqpSort; label: string }> = [
  { value: 'strength', label: 'Strength' },
  { value: 'volume', label: 'Search volume' },
  { value: 'acos', label: 'ACoS' },
  { value: 'spend', label: 'Spend' },
];
const REPORT_SORTS: Array<{ value: SqpSort; label: string }> = [
  { value: 'volume', label: 'Search volume' },
  { value: 'impressionShare', label: 'Impression share' },
  { value: 'clickShare', label: 'Click share' },
  { value: 'cartAddShare', label: 'Cart add share' },
  { value: 'purchaseShare', label: 'Purchase share' },
  { value: 'purchasesBrand', label: 'Brand purchases' },
];
const STRENGTHS: SqpStrength[] = ['Strong', 'Medium', 'Low'];
const CHANNELS = ['SP', 'SB', 'SP & SB'];
const TARGETED = ['Not Targeted', 'SP', 'SB', 'SP & SB'];

const rate = (v: number | null) => (v == null ? DASH : `${v.toFixed(1)}%`);
const periodKey = (p: Pick<SqpPeriod, 'from' | 'to'>) => `${p.from}|${p.to}`;

function periodLabel(p: SqpPeriod) {
  const days = Math.round((Date.parse(p.to) - Date.parse(p.from)) / 86_400_000) + 1;
  const kind = days === 7 ? 'Week' : days >= 28 && days <= 31 ? 'Month' : days >= 89 && days <= 92 ? 'Quarter' : `${days} days`;
  return `${kind} · ${fmtDateLong(p.from)} – ${fmtDateLong(p.to)}`;
}

function StrengthBadge({ s }: { s: SqpStrength | null }) {
  if (!s) return <>{DASH}</>;
  const tone = s === 'Strong' ? 'badge-success' : s === 'Medium' ? 'badge-warning' : 'badge-ghost';
  return <span className={`badge badge-sm whitespace-nowrap ${s === 'Low' ? 'badge-soft' : ''} ${tone}`}>{s}</span>;
}

/** Total / Brand / Share cells for one funnel stage. */
function Stage({ total, brand, share }: { total: number; brand: number; share: number | null }) {
  return (
    <>
      <td className="num whitespace-nowrap border-l border-line/60 px-3 py-1.5 text-right">{fmtInt(total)}</td>
      <td className="num whitespace-nowrap px-3 py-1.5 text-right">{fmtInt(brand)}</td>
      <td className="num whitespace-nowrap px-3 py-1.5 text-right font-medium">{rate(share)}</td>
    </>
  );
}

function ChannelBadge({ label }: { label: string }) {
  const tone =
    label === 'SP' ? 'badge-info' : label === 'SB' ? 'badge-secondary' : label === 'SP & SB' ? 'badge-primary' : 'badge-ghost';
  return <span className={`badge badge-sm badge-soft whitespace-nowrap ${tone}`}>{label}</span>;
}

/** Basis sentence with its percentages in bold. */
function Basis({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\d+(?:\.\d+)?%|n\/a)/g).map((part, i) =>
        /^(\d+(?:\.\d+)?%|n\/a)$/.test(part) ? (
          <strong key={i} className="font-semibold text-ink">
            {part}
          </strong>
        ) : (
          <Fragment key={i}>{part}</Fragment>
        )
      )}
    </>
  );
}

function AdCells({ r }: { r: SqpRow }) {
  const tone = r.acosVsAccount === 'worse' ? 'text-bad' : r.acosVsAccount === 'better' ? 'text-good' : '';
  return (
    <>
      <td className={`num whitespace-nowrap px-3 py-1.5 text-right ${r.acosPct == null ? 'text-muted' : `font-semibold ${tone}`}`}>
        {rate(r.acosPct)}
      </td>
      <td className={`num whitespace-nowrap px-3 py-1.5 text-right ${r.spend == null ? 'text-muted' : ''}`}>{fmtMoney(r.spend)}</td>
    </>
  );
}

const Th = ({ children, right = false, className = '' }: { children: ReactNode; right?: boolean; className?: string }) => (
  <th className={`whitespace-nowrap px-3 py-2 font-medium ${right ? 'text-right' : 'text-left'} ${className}`}>{children}</th>
);

/**
 * SQP — Brand Analytics Search Query Performance (Brand View), ported from
 * eigen's Search Opportunities tab. Picks a whole reporting period (the report
 * has no daily breakdown), so it ignores the dashboard's date range.
 */
export function SqpView({ profileId }: { profileId: string }) {
  const [period, setPeriod] = useState('');
  const [view, setView] = useState<View>('opportunities');
  const [qDraft, setQDraft] = useState('');
  const [q, setQ] = useState('');
  const [launchIn, setLaunchIn] = useState('');
  const [targeted, setTargeted] = useState('');
  const [strength, setStrength] = useState('');
  const [sort, setSort] = useState<SqpSort>('strength');
  const [data, setData] = useState<SqpResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setQ(qDraft.trim()), 350);
    return () => clearTimeout(t);
  }, [qDraft]);
  useEffect(() => setPeriod(''), [profileId]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    const [periodStart, periodEnd] = period ? period.split('|') : [];
    const opp = view === 'opportunities';
    getSqp(profileId, {
      periodStart,
      periodEnd,
      view,
      q,
      launchIn: opp ? launchIn : '',
      targeted: opp ? targeted : '',
      strength: opp ? strength : '',
      sort,
    })
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId, period, view, q, launchIn, targeted, strength, sort]);

  // Each view has its own sort options; reset to its default when switching.
  const switchView = (v: View) => {
    setSort(v === 'opportunities' ? 'strength' : 'volume');
    setView(v);
  };

  const k = data?.kpis;
  const hasReport = (data?.periods.length ?? 0) > 0;
  const isOpp = view === 'opportunities';

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={hasReport ? data?.notes : undefined}
      toolbar={
        hasReport && data ? (
          <>
            <Select
              label="Reporting period"
              value={data.period ? periodKey(data.period) : ''}
              onChange={setPeriod}
              allLabel={null}
              options={data.periods.map((p) => ({ value: periodKey(p), label: periodLabel(p) }))}
            />
            <div className="join">
              {(['opportunities', 'report'] as const).map((v) => (
                <button
                  key={v}
                  onClick={() => switchView(v)}
                  className={`btn btn-sm join-item ${view === v ? 'btn-primary' : 'font-normal'}`}
                >
                  {v === 'opportunities' ? 'Opportunities' : 'SQP report'}
                  {k && <span className="opacity-70">({fmtInt(v === 'opportunities' ? k.opportunities : k.queries)})</span>}
                </button>
              ))}
            </div>
            <input value={qDraft} onChange={(e) => setQDraft(e.target.value)} placeholder="Search queries…" className="input input-sm w-52" />
            {isOpp && (
              <>
                <Select label="Strength" value={strength} onChange={setStrength} options={STRENGTHS} />
                <Select label="Launch in" value={launchIn} onChange={setLaunchIn} options={CHANNELS} />
                <Select label="Targeted?" value={targeted} onChange={setTargeted} options={TARGETED} />
              </>
            )}
            <Select label="Sort by" value={sort} onChange={(v) => setSort(v as SqpSort)} allLabel={null} options={isOpp ? OPP_SORTS : REPORT_SORTS} />
          </>
        ) : undefined
      }
    >
      {data && !hasReport && (
        <div className="rounded-box border border-line bg-surface px-4 py-6 text-sm shadow-sm">
          No Search Query Performance report for this profile yet. Export the <b>Brand View</b> report from Brand Analytics and upload it
          on the Upload page. The period is read from Amazon&apos;s &ldquo;Select week / month / quarter&rdquo; line above the header, or
          from the file name if that line was removed — e.g.{' '}
          <code className="rounded bg-base-200 px-1 py-0.5 text-xs">Search_Query_Performance_1_July_-_31_July.csv</code>.
        </div>
      )}

      {data && hasReport && k && (
        <>
          <div className="stats stats-vertical w-full border border-line bg-base-100 shadow-sm sm:stats-horizontal">
            {[
              { label: 'Opportunities', value: fmtInt(k.opportunities), desc: `of ${fmtInt(k.queries)} queries` },
              { label: 'Strong', value: fmtInt(k.strong), desc: 'CTR, add-to-cart and purchase % all beat category' },
              { label: 'Medium', value: fmtInt(k.medium), desc: '2 of the 3 beat category' },
              { label: 'Low', value: fmtInt(k.low), desc: '1 of the 3 beats category' },
              { label: 'Launch in SP & SB', value: fmtInt(k.launchBoth), desc: `SP only ${fmtInt(k.launchSp)} · SB only ${fmtInt(k.launchSb)}` },
              { label: 'Account ACoS', value: rate(data.accountAcosPct), desc: 'search terms, same period' },
            ].map((s) => (
              <div key={s.label} className="stat px-4 py-3">
                <div className="stat-title text-xs">{s.label}</div>
                <div className="stat-value num text-xl">{s.value}</div>
                <div className="stat-desc">{s.desc}</div>
              </div>
            ))}
          </div>

          {isOpp ? (
            <div className={TABLE_WRAP}>
              <table className="table table-sm">
                <thead className={THEAD}>
                  <tr className="text-xs text-muted">
                    <Th className="sticky left-0 z-30 min-w-56 bg-base-200">Search query</Th>
                    <Th>Strength</Th>
                    <Th>Targeted?</Th>
                    <Th right>Search volume</Th>
                    <Th>Launch in</Th>
                    <Th className="min-w-96">Why it qualifies</Th>
                    <Th right>ACoS</Th>
                    <Th right>Spend</Th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={8} className="px-3 py-8 text-center text-muted">
                        No query in this period beats the category on any of CTR, add-to-cart or purchase % with enough clicks — or the filters exclude them.
                      </td>
                    </tr>
                  )}
                  {data.rows.map((r) => (
                    <tr key={r.query} className="border-b border-line/60 align-top odd:bg-surface even:bg-stripe hover:bg-accent-soft">
                      <td className="sticky left-0 z-10 max-w-72 bg-inherit px-3 py-1.5 font-medium">{r.query}</td>
                      <td className="px-3 py-1.5">
                        <StrengthBadge s={r.strength} />
                      </td>
                      <td className="px-3 py-1.5">
                        <ChannelBadge label={r.targeted} />
                      </td>
                      <td className="num px-3 py-1.5 text-right">{fmtInt(r.volume)}</td>
                      <td className="px-3 py-1.5">{r.launchIn ? <ChannelBadge label={r.launchIn} /> : DASH}</td>
                      <td className="max-w-md whitespace-normal px-3 py-1.5 text-xs text-muted">
                        <Basis text={r.basis} />
                      </td>
                      <AdCells r={r} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className={TABLE_WRAP}>
              <table className="table table-sm">
                <thead className={THEAD}>
                  <tr className="text-xs text-muted">
                    <th rowSpan={2} className="sticky left-0 z-30 min-w-56 bg-base-200 px-3 py-2 text-left align-bottom font-medium">
                      Search query
                    </th>
                    <th rowSpan={2} className="whitespace-nowrap px-3 py-2 text-right align-bottom font-medium">
                      Search volume
                    </th>
                    {['Impressions', 'Clicks', 'Cart adds', 'Purchases'].map((g) => (
                      <th key={g} colSpan={3} className="border-l border-line/60 px-3 pt-2 pb-0 text-center font-semibold text-ink">
                        {g}
                      </th>
                    ))}
                  </tr>
                  <tr className="text-xs text-muted">
                    {['Impressions', 'Clicks', 'Cart adds', 'Purchases'].map((g) => (
                      <Fragment key={g}>
                        <Th right className="border-l border-line/60">Total</Th>
                        <Th right>Brand</Th>
                        <Th right>Share</Th>
                      </Fragment>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.rows.length === 0 && (
                    <tr>
                      <td colSpan={14} className="px-3 py-8 text-center text-muted">
                        No queries match this search.
                      </td>
                    </tr>
                  )}
                  {data.rows.map((r) => (
                    <tr key={r.query} className="border-b border-line/60 odd:bg-surface even:bg-stripe hover:bg-accent-soft">
                      <td className="sticky left-0 z-10 max-w-72 bg-inherit px-3 py-1.5 font-medium">{r.query}</td>
                      <td className="num px-3 py-1.5 text-right">{fmtInt(r.volume)}</td>
                      <Stage total={r.impressionsTotal} brand={r.impressionsBrand} share={r.impressionShare} />
                      <Stage total={r.clicksTotal} brand={r.clicksBrand} share={r.clickShare} />
                      <Stage total={r.cartAddsTotal} brand={r.cartAddsBrand} share={r.cartAddShare} />
                      <Stage total={r.purchasesTotal} brand={r.purchasesBrand} share={r.purchaseShare} />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </ViewShell>
  );
}
