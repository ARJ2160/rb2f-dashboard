'use client';

import { blank, type MetricKey, type Sums, type ZpChannel } from '@dash/shared/zepto';
import type { StateRow } from '@dash/shared';
import { useState } from 'react';

import { bkShow, ROW, TD_LEFT, TH, TH_LEFT } from '../blinkit/cells';
import { Donut } from '../charts';
import { IndiaMap, type MapMetric } from '../india-map';
import { ErrorBox, Notes } from '../notes';
import { Card, MultiSelect, Select } from '../views/shared';
import { useLoad } from '../shell/use-load';
import { fmtInt, fmtMoney, fmtPct } from '@/lib/format';
import { zeptoApi } from '@/lib/zepto-api';

import { MetricTable, StatCards, zLabel } from './common';

export interface ViewProps {
  profileId: string;
  from: string;
  to: string;
  category: string; // csv
  channel: string; // csv
}
const rangeOf = (p: ViewProps) => ({ from: p.from, to: p.to, category: p.category, channel: p.channel });
const deps = (p: ViewProps) => [p.profileId, p.from, p.to, p.category, p.channel];

const CHANNEL_LABEL: Record<ZpChannel, string> = { sp: 'SP', sb: 'SB', sd: 'SD' };

// ── Main (overview) ──────────────────────────────────────────────────

const CARD_METRICS: MetricKey[] = ['rev', 'spend', 'asales', 'organic', 'acos', 'roas', 'tacos'];

export function MainView(p: ViewProps) {
  const [groupBy, setGroupBy] = useState<'category' | 'sku'>('category');
  const { data, error, loading } = useLoad(
    () => zeptoApi.summary(p.profileId, rangeOf(p), groupBy),
    [...deps(p), groupBy]
  );
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
        {loading && <span className="loading loading-spinner loading-sm text-muted" />}
      </div>
      {error && <ErrorBox message={error} />}
      {data && (
        <>
          <StatCards items={CARD_METRICS} sums={data.total} />
          <MetricTable
            rows={data.groups.map((g) => ({ key: g.key, sums: g.sums }))}
            nameHeader={groupBy === 'category' ? 'Category' : 'SKU'}
            defaultShown={['rev', 'units', 'spend', 'asales', 'acos', 'roas', 'tacos']}
            defaultSort="rev"
          />
        </>
      )}
    </div>
  );
}

// ── Category ─────────────────────────────────────────────────────────

export function CategoryView(p: ViewProps) {
  const { data, error, loading } = useLoad(() => zeptoApi.summary(p.profileId, rangeOf(p), 'category'), deps(p));
  return (
    <Loaded error={error} loading={loading}>
      {data && (
        <>
          <StatCards items={CARD_METRICS} sums={data.total} />
          <MetricTable
            rows={data.groups.map((g) => ({ key: g.key, sums: g.sums }))}
            nameHeader="Category"
            defaultShown={['rev', 'units', 'spend', 'asales', 'organic', 'acos', 'roas', 'tacos']}
            defaultSort="rev"
          />
        </>
      )}
    </Loaded>
  );
}

// ── ASIN / SKU-level ─────────────────────────────────────────────────

export function AsinView(p: ViewProps) {
  const [q, setQ] = useState('');
  const { data, error, loading } = useLoad(() => zeptoApi.asin(p.profileId, rangeOf(p), {}), deps(p));
  const rows = (data?.rows ?? []).filter(
    (r) => !q || r.name.toLowerCase().includes(q.toLowerCase()) || r.skuId.includes(q)
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search SKU…"
          className="input input-sm w-56"
        />
        {loading && <span className="loading loading-spinner loading-sm text-muted" />}
      </div>
      {error && <ErrorBox message={error} />}
      {data && (
        <>
          <StatCards items={CARD_METRICS} sums={data.total} />
          <MetricTable
            rows={rows.map((r) => ({
              key: r.skuId,
              sums: r.sums,
              title: r.skuId,
              sub: `${r.category}${r.channels.length ? ` · ${r.channels.map((c) => CHANNEL_LABEL[c]).join('/')}` : ''}`,
            }))}
            nameHeader="SKU"
            defaultShown={['rev', 'units', 'spend', 'asales', 'acos', 'roas', 'tacos']}
            defaultSort="rev"
            renderName={(r) => (
              <>
                <div className="max-w-80 truncate font-medium" title={r.title}>
                  {rows.find((x) => x.skuId === r.key)?.name ?? r.key}
                </div>
                {r.sub && <div className="text-[11px] text-muted">{r.sub}</div>}
              </>
            )}
            note={
              data.truncated ? (
                <Notes notes={[`Showing the top ${data.rows.length} SKUs; narrow with the search or filters.`]} />
              ) : undefined
            }
          />
        </>
      )}
    </div>
  );
}

// ── Category advertised ──────────────────────────────────────────────

export function CategoryAdvertisedView(p: ViewProps) {
  const { data, error, loading } = useLoad(() => zeptoApi.categoryAdvertised(p.profileId, rangeOf(p)), deps(p));
  return (
    <Loaded error={error} loading={loading}>
      {data && (
        <>
          <StatCards items={['spend', 'asales', 'acos', 'roas', 'impr', 'clicks']} sums={data.total} />
          <MetricTable
            rows={data.rows.map((r) => ({ key: r.category, sums: r.sums }))}
            nameHeader="Advertised category"
            defaultShown={['spend', 'asales', 'acos', 'roas', 'impr', 'clicks', 'ctr', 'atc']}
            defaultSort="spend"
            note={<Notes notes={['Ad metrics of advertised SKUs, grouped by their canonical category. Filter by channel in the top bar.']} />}
          />
        </>
      )}
    </Loaded>
  );
}

// ── Ads analysis (campaigns) ─────────────────────────────────────────

export function AdsView(p: ViewProps) {
  const { data, error, loading } = useLoad(() => zeptoApi.campaigns(p.profileId, rangeOf(p)), deps(p));
  return (
    <Loaded error={error} loading={loading}>
      {data && (
        <>
          <StatCards items={['spend', 'asales', 'acos', 'roas', 'impr', 'clicks', 'atc']} sums={data.total} />
          <MetricTable
            rows={data.rows.map((r) => ({
              key: r.name,
              sums: r.sums,
              sub: `${CHANNEL_LABEL[r.channel]} · ${r.category}${r.status ? ` · ${r.status}` : ''}`,
              title: r.name,
            }))}
            nameHeader="Campaign"
            defaultShown={['spend', 'asales', 'acos', 'roas', 'impr', 'clicks', 'ctr', 'cpc', 'atc']}
            defaultSort="spend"
          />
        </>
      )}
    </Loaded>
  );
}

// ── Search terms (keywords) ──────────────────────────────────────────

export function SearchTermsView(p: ViewProps) {
  const [q, setQ] = useState('');
  const [grain, setGrain] = useState<'kw' | 'kwc'>('kw');
  const { data, error, loading } = useLoad(
    () => zeptoApi.keywords(p.profileId, rangeOf(p), { grain, q, limit: 1000 }),
    [...deps(p), grain, q]
  );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search keyword…"
          className="input input-sm w-56"
        />
        <Select
          label="Rows"
          value={grain}
          onChange={(v) => setGrain(v as 'kw' | 'kwc')}
          allLabel={null}
          options={[
            { value: 'kw', label: 'One per keyword' },
            { value: 'kwc', label: 'Keyword × campaign' },
          ]}
        />
        {loading && <span className="loading loading-spinner loading-sm text-muted" />}
      </div>
      {error && <ErrorBox message={error} />}
      {data && (
        <>
          <StatCards items={['spend', 'asales', 'acos', 'roas', 'impr', 'clicks']} sums={data.total} />
          <MetricTable
            rows={data.rows.map((r, i) => ({
              key: `${r.keyword}\u0001${r.campaign ?? ''}\u0001${i}`,
              sums: r.sums,
              sub: `${CHANNEL_LABEL[r.channel]} · ${r.matchType || '—'} · ${r.category}`,
              title: r.campaigns.join('\n'),
            }))}
            nameHeader="Keyword"
            defaultShown={['spend', 'asales', 'acos', 'roas', 'impr', 'clicks', 'ctr', 'cpc', 'atc']}
            defaultSort="spend"
            renderName={(r) => {
              const idx = Number(r.key.split('\u0001')[2]);
              const row = data.rows[idx];
              return (
                <>
                  <div className="font-medium">{row?.keyword}</div>
                  <div className="text-[11px] text-muted">{r.sub}</div>
                </>
              );
            }}
            note={data.truncated ? <Notes notes={[`Showing the top ${data.rows.length} keywords.`]} /> : undefined}
          />
        </>
      )}
    </div>
  );
}

// ── DSR ──────────────────────────────────────────────────────────────

const DSR_COLS: MetricKey[] = ['rev', 'units', 'asp'];

export function DsrView(p: ViewProps) {
  const { data, error, loading } = useLoad(() => zeptoApi.dsr(p.profileId, rangeOf(p)), deps(p));
  return (
    <Loaded error={error} loading={loading}>
      {data && (
        <>
          <StatCards items={['rev', 'units', 'spend', 'asales', 'acos', 'roas', 'tacos']} sums={data.total} />
          {data.byChannel.length > 0 && (
            <div className="flex flex-wrap gap-2 text-xs text-muted">
              {data.byChannel.map((c) => (
                <span key={c.channel} className="rounded border border-line bg-base-100 px-2 py-1">
                  <b className="text-ink">{CHANNEL_LABEL[c.channel]}</b> spend {fmtMoney(c.spend)} · ad sales{' '}
                  {fmtMoney(c.asales)}
                </span>
              ))}
            </div>
          )}
          <div className="max-h-[70vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
            <table className="table table-sm">
              <thead className="sticky top-0 z-20 bg-base-200">
                <tr className="text-xs text-muted">
                  <th className={TH_LEFT}>Date</th>
                  {DSR_COLS.map((k) => (
                    <th key={k} className={TH}>
                      {zLabel(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.dates.map((d, i) => (
                  <tr key={d} className={ROW}>
                    <td className={TD_LEFT}>{d}</td>
                    {DSR_COLS.map((k) => (
                      <td key={k} className="num whitespace-nowrap px-3 py-1.5 text-right">
                        {bkShow(k, data.series[i] ?? blank())}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr className="border-t-2 border-line font-semibold">
                  <td className={TD_LEFT}>TOTAL</td>
                  {DSR_COLS.map((k) => (
                    <td key={k} className="num whitespace-nowrap px-3 py-1.5 text-right">
                      {bkShow(k, data.total)}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <Notes notes={data.notes} />
        </>
      )}
    </Loaded>
  );
}

// ── DUR ──────────────────────────────────────────────────────────────

export function DurView(p: ViewProps) {
  const [metric, setMetric] = useState<'units' | 'rev'>('units');
  const { data, error, loading } = useLoad(
    () => zeptoApi.dur(p.profileId, rangeOf(p), metric),
    [...deps(p), metric]
  );
  const fmt = metric === 'rev' ? fmtMoney : fmtInt;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          label="Metric"
          value={metric}
          onChange={(v) => setMetric(v as 'units' | 'rev')}
          allLabel={null}
          options={[
            { value: 'units', label: 'Units' },
            { value: 'rev', label: 'Revenue' },
          ]}
        />
        {loading && <span className="loading loading-spinner loading-sm text-muted" />}
      </div>
      {error && <ErrorBox message={error} />}
      {data && (
        <div className="max-h-[72vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
          <table className="table table-sm">
            <thead className="sticky top-0 z-20 bg-base-200">
              <tr className="text-xs text-muted">
                <th className={TH_LEFT}>SKU</th>
                <th className={TH}>Total</th>
                {data.dates.map((d) => (
                  <th key={d} className={TH}>
                    {d.slice(5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.skuId} className={ROW}>
                  <td className={TD_LEFT}>
                    <div className="max-w-72 truncate font-medium" title={r.skuId}>
                      {r.name}
                    </div>
                    <div className="text-[11px] text-muted">{r.category}</div>
                  </td>
                  <td className="num whitespace-nowrap px-3 py-1.5 text-right font-semibold">{fmt(r.total)}</td>
                  {r.values.map((v, i) => (
                    <td key={i} className="num whitespace-nowrap px-3 py-1.5 text-right">
                      {v ? fmt(v) : '·'}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ── City wise data ───────────────────────────────────────────────────

const MAP_METRICS: Array<{ value: MapMetric; label: string }> = [
  { value: 'sales', label: 'Sales' },
  { value: 'units', label: 'Units' },
];

function toStateRows(rows: { key: string; sums: Sums }[]): StateRow[] {
  const tu = rows.reduce((a, r) => a + r.sums.units, 0),
    ts = rows.reduce((a, r) => a + r.sums.rev, 0);
  return rows.map((r) => ({
    state: r.key,
    units: r.sums.units,
    sales: r.sums.rev,
    orders: 0,
    asins: 0,
    unitsSharePct: tu ? (r.sums.units / tu) * 100 : null,
    salesSharePct: ts ? (r.sums.rev / ts) * 100 : null,
  }));
}

export function CityView(p: ViewProps) {
  const [metric, setMetric] = useState<MapMetric>('sales');
  const [state, setState] = useState('');
  const { data, error, loading } = useLoad(() => zeptoApi.geo(p.profileId, rangeOf(p)), deps(p));
  const val = (s: Sums) => (metric === 'sales' ? s.rev : s.units);
  const fmt = metric === 'sales' ? fmtMoney : fmtInt;
  const stateOfCity = new Map((data?.cities ?? []).map((c) => [c.key, c.state]));
  const cityRows = (data?.cities ?? []).filter((c) => !state || stateOfCity.get(c.key) === state);
  const rows = state ? cityRows : (data?.states ?? []);
  const totShare = rows.reduce((a, r) => a + r.sums.rev, 0);
  const sorted = [...rows].sort((a, b) => val(b.sums) - val(a.sums));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          label="Map metric"
          value={metric}
          onChange={(v) => setMetric(v as MapMetric)}
          allLabel={null}
          options={MAP_METRICS}
        />
        <MultiSelect
          label="State (city table)"
          value={state}
          onChange={setState}
          allLabel="All states"
          options={(data?.states ?? []).map((s) => s.key).sort()}
        />
        {loading && <span className="loading loading-spinner loading-sm text-muted" />}
      </div>
      {error && <ErrorBox message={error} />}
      {data && (
        <>
          <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
            <Card title={`${MAP_METRICS.find((m) => m.value === metric)!.label} by state`}>
              <IndiaMap rows={toStateRows(data.states)} prev={null} metric={metric} />
            </Card>
            <Card title={`${state || 'All states'} · top ${state ? 'cities' : 'states'}`}>
              <Donut
                items={sorted.map((r) => ({ label: r.key, value: val(r.sums), prev: null }))}
                fmt={fmt}
                comparing={false}
              />
            </Card>
          </div>
          <div className="max-h-[60vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
            <table className="table table-sm">
              <thead className="sticky top-0 z-20 bg-base-200">
                <tr className="text-xs text-muted">
                  <th className={TH_LEFT}>{state ? 'City' : 'State'}</th>
                  <th className={TH}>% Sales</th>
                  <th className={TH}>Sales</th>
                  <th className={TH}>Units</th>
                  <th className={TH}>ASP</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr
                    key={r.key}
                    className={`${ROW} ${state ? '' : 'cursor-pointer'}`}
                    onClick={() => !state && setState(r.key)}
                    title={state ? '' : 'Click to see its cities'}
                  >
                    <td className={TD_LEFT}>{r.key}</td>
                    <td className="num px-3 py-1.5 text-right">
                      {totShare ? fmtPct((r.sums.rev / totShare) * 100) : '—'}
                    </td>
                    <td className="num px-3 py-1.5 text-right">{fmtMoney(r.sums.rev)}</td>
                    <td className="num px-3 py-1.5 text-right">{fmtInt(r.sums.units)}</td>
                    <td className="num px-3 py-1.5 text-right">
                      {r.sums.units ? fmtMoney(r.sums.rev / r.sums.units) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Notes notes={['Geography is the customer city in the Zepto Total Sales report; states are derived from the city.']} />
        </>
      )}
    </div>
  );
}

// ── Inventory ────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  'Stock-out': 'text-bad',
  Critical: 'text-bad',
  Low: 'text-warn',
  Healthy: 'text-good',
  Excess: 'text-muted',
  'No sales L7D': 'text-muted',
};

export function InventoryView(p: { profileId: string; category: string }) {
  const { data, error, loading } = useLoad(
    () => zeptoApi.inventory(p.profileId, { category: p.category || undefined }),
    [p.profileId, p.category]
  );
  return (
    <div className="space-y-3">
      {loading && <span className="loading loading-spinner loading-sm text-muted" />}
      {error && <ErrorBox message={error} />}
      {data && (
        <>
          <div className="text-xs text-muted">
            Snapshot {data.snapshot ?? '—'} · {data.rows.length} SKUs · {data.cities.length} cities · days of
            cover from the last 7 days of sales.
          </div>
          <div className="max-h-[72vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
            <table className="table table-sm">
              <thead className="sticky top-0 z-20 bg-base-200">
                <tr className="text-xs text-muted">
                  <th className={TH_LEFT}>SKU</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className={TH}>Units in stock</th>
                  <th className={TH}>DRR (7d)</th>
                  <th className={TH}>Days of cover</th>
                  <th className="px-3 py-2 text-left font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.skuCode} className={ROW}>
                    <td className={TD_LEFT}>
                      <div className="max-w-80 truncate font-medium" title={r.skuCode}>
                        {r.skuName}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted">{r.category}</td>
                    <td className="num px-3 py-1.5 text-right">{fmtInt(r.units)}</td>
                    <td className="num px-3 py-1.5 text-right">{r.drr == null ? '—' : r.drr.toFixed(1)}</td>
                    <td className="num px-3 py-1.5 text-right">{r.doc == null ? '—' : r.doc.toFixed(1)}</td>
                    <td className={`whitespace-nowrap px-3 py-1.5 text-xs font-medium ${STATUS_STYLE[r.status] ?? ''}`}>
                      {r.status}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ── small helper ─────────────────────────────────────────────────────

function Loaded({
  error,
  loading,
  children,
}: {
  error: string | null;
  loading: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-3">
      {loading && <span className="loading loading-spinner loading-sm text-muted" />}
      {error && <ErrorBox message={error} />}
      {children}
    </div>
  );
}
