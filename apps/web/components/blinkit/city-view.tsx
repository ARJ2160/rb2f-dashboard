'use client';

import { blank, type BkCityAdsResponse, type BkCityAdsRow, type BkGeoResponse, type MetricKey, type Sums } from '@dash/shared/blinkit';
import type { StateRow } from '@dash/shared';
import { useState } from 'react';

import { Donut } from '@/components/charts';
import { IndiaMap, type MapMetric } from '@/components/india-map';
import { ErrorBox, Notes } from '@/components/notes';
import { Card, Select } from '@/components/views/shared';
import { bkCityAds, bkGeo } from '@/lib/blinkit-api';
import { fmtInt, fmtMoney, fmtPct } from '@/lib/format';

import { BkCell, days, ROW, TD_LEFT, TH, TH_LEFT, type BkViewProps } from './cells';
import { useLoad } from './dsr-dur';

const MAP_METRICS: Array<{ value: MapMetric; label: string }> = [
  { value: 'sales', label: 'Sales' },
  { value: 'units', label: 'Units' },
  { value: 'orders', label: 'Orders' },
];
const AD_COLS: MetricKey[] = ['spend', 'impr', 'cpm', 'asales', 'roas', 'rev', 'tacos', 'acos'];

/** BkGeoRow[] → the Amazon StateRow shape the India map reads. */
function toStateRows(rows: { key: string; sums: Sums }[]): StateRow[] {
  const tu = rows.reduce((a, r) => a + r.sums.units, 0), ts = rows.reduce((a, r) => a + r.sums.rev, 0);
  return rows.map((r) => ({
    state: r.key,
    units: r.sums.units,
    sales: r.sums.rev,
    orders: r.sums.orders,
    asins: 0,
    unitsSharePct: tu ? (r.sums.units / tu) * 100 : null,
    salesSharePct: ts ? (r.sums.rev / ts) * 100 : null,
  }));
}

/**
 * City Wise Data: sales by customer state / city (map + table), then ad spend
 * ONLY for campaigns that target an exact city (or cities inside one metro).
 * Multi-metro, Top City, ROC and Pan-India spend is never split onto cities.
 */
export function CityView(p: BkViewProps) {
  const [metric, setMetric] = useState<MapMetric>('sales');
  const [state, setState] = useState('');
  const cmp = p.compare;
  const { data, error, loading } = useLoad(
    () =>
      Promise.all([
        bkGeo(p.profileId, p),
        cmp ? bkGeo(p.profileId, { ...cmp, category: p.category }) : Promise.resolve(null),
        bkCityAds(p.profileId, p),
        cmp ? bkCityAds(p.profileId, { ...cmp, category: p.category }) : Promise.resolve(null),
      ]) as Promise<[BkGeoResponse, BkGeoResponse | null, BkCityAdsResponse, BkCityAdsResponse | null]>,
    [p.profileId, p.from, p.to, p.category, cmp?.from, cmp?.to]
  );
  const comparing = !!cmp;
  const [geo, geoB, ads, adsB] = data ?? [null, null, null, null];
  const dA = days(p), dB = cmp ? days(cmp) : 1;
  const val = (s: Sums) => (metric === 'sales' ? s.rev : metric === 'units' ? s.units : s.orders);
  const fmt = metric === 'sales' ? fmtMoney : fmtInt;

  const rows = (state ? geo?.cities.filter((c) => c.state === state) : geo?.states) ?? [];
  const prevRows = new Map(((state ? geoB?.cities : geoB?.states) ?? []).map((r) => [r.key, r.sums]));
  const totOrders = rows.reduce((a, r) => a + r.sums.orders, 0);
  const sorted = [...rows].sort((a, b) => val(b.sums) - val(a.sums));

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select label="Map metric" value={metric} onChange={(v) => setMetric(v as MapMetric)} options={MAP_METRICS} allLabel={null} />
        <Select label="State (city table)" value={state} onChange={setState} options={(geo?.states ?? []).map((s) => s.key).sort()} allLabel="All states" />
        {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
      </div>
      {error && <ErrorBox message={error} />}
      {geo && ads && (
        <>
          <div className="grid gap-3 lg:grid-cols-[3fr_2fr]">
            <Card title={`${MAP_METRICS.find((m) => m.value === metric)!.label} by customer state`}>
              <IndiaMap rows={toStateRows(geo.states)} prev={geoB ? toStateRows(geoB.states) : null} metric={metric} />
            </Card>
            <Card title={`${state || 'All states'} · top ${state ? 'cities' : 'states'}`}>
              <Donut items={sorted.map((r) => ({ label: r.key, value: val(r.sums), prev: prevRows.has(r.key) ? val(prevRows.get(r.key)!) : null }))} fmt={fmt} comparing={comparing} />
            </Card>
          </div>

          <div className="max-h-[60vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
            <table className="table table-sm">
              <thead className="sticky top-0 z-20 bg-base-200 shadow-[0_1px_0_var(--color-line)]">
                <tr className="text-xs text-muted">
                  <th className={TH_LEFT}>{state ? 'City' : 'State'}</th>
                  <th className={TH}>% Orders</th>
                  <th className={TH}>Orders</th>
                  <th className={TH}>Sales</th>
                  <th className={TH}>Units</th>
                  <th className={TH}>AOV</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((r) => (
                  <tr key={r.key} className={`${ROW} ${state ? '' : 'cursor-pointer'}`} onClick={() => !state && setState(r.key)} title={state ? '' : 'Click to see its cities'}>
                    <td className={TD_LEFT}>{r.key}</td>
                    <td className="num px-3 py-1.5 text-right align-top">{totOrders ? fmtPct((r.sums.orders / totOrders) * 100) : '—'}</td>
                    {(['orders', 'rev', 'units', 'aov'] as MetricKey[]).map((k) => (
                      <BkCell key={k} k={k} s={r.sums} prev={prevRows.get(r.key) ?? (comparing ? blank() : null)} comparing={comparing} daysA={dA} daysB={dB} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <CityAds ads={ads} prev={adsB} comparing={comparing} dA={dA} dB={dB} state={state} geo={geo} />
          <Notes notes={['Geography is the customer city / state of the order (Blinkit Sales report), not the dark store that served it.']} />
        </>
      )}
    </div>
  );
}

function CityAds({ ads, prev, comparing, dA, dB, state, geo }: {
  ads: BkCityAdsResponse;
  prev: BkCityAdsResponse | null;
  comparing: boolean;
  dA: number;
  dB: number;
  state: string;
  geo: BkGeoResponse;
}) {
  const stateOf = new Map(geo.cities.map((c) => [c.key, c.state]));
  const inState = (u: BkCityAdsRow) => !state || u.cities.some((c) => stateOf.get(c) === state);
  const prevBy = new Map([...(prev?.rows ?? []), ...(prev?.groups ?? [])].map((u) => [u.key, u.sums]));
  const rows = ads.rows.filter(inState), groups = ads.groups.filter(inState);
  const attributed = ads.totalSpend - ads.notAttributable.spend;

  const table = (list: BkCityAdsRow[]) => (
    <div className="overflow-x-auto rounded-box border border-line bg-surface shadow-sm">
      <table className="table table-sm">
        <thead className="bg-base-200">
          <tr className="text-xs text-muted">
            <th className={TH_LEFT}>Targeted geography</th>
            {AD_COLS.map((c) => (
              <th key={c} className={TH}>
                {c === 'rev' ? 'Sales (these cities)' : c === 'tacos' ? 'TACoS' : c === 'acos' ? 'ACoS' : c === 'roas' ? 'ROAS' : c === 'cpm' ? 'CPM' : c === 'impr' ? 'Impressions' : c === 'asales' ? 'Ad Sales' : 'Spends'}
              </th>
            ))}
            <th className="px-3 py-2 text-left font-medium">Campaigns</th>
          </tr>
        </thead>
        <tbody>
          {list.map((u) => (
            <tr key={u.key} className={ROW}>
              <td className={TD_LEFT}>
                {u.label}
                {u.label !== u.key && <div className="text-[11px] text-muted">{u.cities.join(', ')}</div>}
              </td>
              {AD_COLS.map((c) => (
                <BkCell key={c} k={c} s={u.sums} prev={prevBy.get(u.key) ?? (comparing ? blank() : null)} comparing={comparing} daysA={dA} daysB={dB} />
              ))}
              <td className="max-w-72 truncate px-3 py-1.5 text-xs text-muted" title={u.campaigns.join('\n')}>
                {u.campaigns.length === 1 ? u.campaigns[0] : `${u.campaigns.length} campaigns`}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <Card title={`Ad spend by city — exact city targeting only${state ? ` · ${state}` : ''}`}>
      <div className="space-y-3">
        {rows.length === 0 ? (
          <div role="note" className="alert alert-warning alert-soft block px-4 py-3 text-xs">
            <b>No campaign in this period targets a single, known city</b>, so no ad spend is shown at city level. {fmtMoney(ads.notAttributable.spend)} of{' '}
            {fmtMoney(ads.totalSpend)} spend ({ads.notAttributable.campaigns} campaigns) is Top City / ROC / Pan-India or has no city in the campaign mapper. Add a{' '}
            <b>City</b> column to the campaign mapper (e.g. &ldquo;Pune&rdquo;, &ldquo;Delhi NCR&rdquo;, &ldquo;Gurgaon + Delhi&rdquo;) to bring a campaign in here.
          </div>
        ) : (
          table(rows)
        )}
        {groups.length > 0 && (
          <>
            <h4 className="text-xs font-semibold text-muted">Multi-city campaigns — shown as a group, never split</h4>
            {table(groups)}
          </>
        )}
        <p className="text-[11px] text-muted">
          Blinkit ad reports carry no city. A campaign counts here only when its targeting is exactly one city or cities inside one metro (Delhi NCR, Mumbai
          MMR, Chandigarh Tricity) — from the campaign mapper&apos;s City column, else an unambiguous city in the campaign name. Its real, unsplit spend is set
          against the sales of those cities; nothing is allocated by revenue share. Reconciliation: attributable {fmtMoney(attributed)} + not city-attributable{' '}
          {fmtMoney(ads.notAttributable.spend)} = total {fmtMoney(ads.totalSpend)}.
        </p>
      </div>
    </Card>
  );
}
