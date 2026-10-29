'use client';

import { METRICS, type BkKeywordsResponse, type BkMetaResponse, type MetricKey } from '@dash/shared/blinkit';
import { useState } from 'react';

import { ErrorBox, Notes } from '@/components/notes';
import { Select } from '@/components/views/shared';
import { bkKeywords } from '@/lib/blinkit-api';

import { BkCell, bkShow, days, ROW, TD_LEFT, TH, TH_LEFT, type BkViewProps } from './cells';
import { useLoad } from './dsr-dur';

const ALL: MetricKey[] = ['impr', 'spend', 'cpm', 'atc', 'atcr', 'aunits', 'cvr', 'asales', 'dsales', 'acos', 'roas', 'mvp', 'nu'];
const SORTABLE = new Set<MetricKey>(['spend', 'impr', 'atc', 'aunits', 'asales', 'dsales', 'nu']);

/** Product Listing / Banner keywords and Recommendation placements; city filter = campaigns that target exactly that city. */
export function KeywordsView(p: BkViewProps & { meta: BkMetaResponse }) {
  const [shown, setShown] = useState<MetricKey[]>(['impr', 'spend', 'mvp', 'acos', 'roas']);
  const [q, setQ] = useState('');
  const [geo, setGeo] = useState('');
  const [campaignId, setCampaignId] = useState('');
  const [adType, setAdType] = useState('');
  const [grain, setGrain] = useState<'kw' | 'kwc'>('kw');
  const [minImpr, setMinImpr] = useState('0');
  const [sort, setSort] = useState<MetricKey>('spend');
  const cmp = p.compare;
  const f = { q, geo, campaignId, adType, grain, minImpr, sort, limit: 600 };
  const { data, error, loading } = useLoad(
    () =>
      Promise.all([
        bkKeywords(p.profileId, p, f),
        cmp ? bkKeywords(p.profileId, { ...cmp, category: p.category }, { ...f, limit: 5000 }) : Promise.resolve(null),
      ]) as Promise<[BkKeywordsResponse, BkKeywordsResponse | null]>,
    [p.profileId, p.from, p.to, p.category, cmp?.from, cmp?.to, q, geo, campaignId, adType, grain, minImpr, sort]
  );
  const [cur, prev] = data ?? [null, null];
  const comparing = !!cmp;
  const key = (r: { keyword: string; campaign: string | null }) => `${r.keyword}\u0001${r.campaign ?? ''}`;
  const prevBy = new Map(prev?.rows.map((r) => [key(r), r.sums]) ?? []);
  const cityUnits = p.meta.geoUnits.filter((u) => u.kind === 'city');
  const camps = p.meta.campaigns.filter((c) => !p.category || c.category === p.category);
  const dA = days(p), dB = cmp ? days(cmp) : 1;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search keyword…" className="input input-sm w-48" />
        <Select
          label="City"
          value={geo}
          onChange={setGeo}
          allLabel={cityUnits.length ? 'All' : 'All (no city-targeted campaigns)'}
          options={cityUnits.map((u) => ({ value: u.key, label: u.label }))}
        />
        <Select label="Campaign" value={campaignId} onChange={setCampaignId} options={camps.map((c) => ({ value: c.id, label: c.name }))} />
        <Select
          label="Ad type"
          value={adType}
          onChange={setAdType}
          options={[
            { value: 'PL', label: 'Product Listing' },
            { value: 'PR', label: 'Product Recommendation' },
            { value: 'BL', label: 'Banner Listing' },
          ]}
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
        <Select label="Min impressions" value={minImpr} onChange={setMinImpr} allLabel={null} options={['0', '100', '500', '1000', '5000']} />
        {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
      </div>
      <div className="flex flex-wrap gap-1">
        {ALL.map((k) => (
          <button
            key={k}
            onClick={() => setShown(shown.includes(k) ? shown.filter((x) => x !== k) : [...shown, k])}
            className={`btn btn-xs ${shown.includes(k) ? 'btn-primary' : 'btn-outline border-line font-normal'}`}
          >
            {METRICS[k].label}
          </button>
        ))}
      </div>
      {error && <ErrorBox message={error} />}
      {cur && (
        <>
          <div className="stats stats-vertical w-full border border-line bg-base-100 shadow-sm sm:stats-horizontal">
            {(['spend', 'impr', 'cpm', 'atcr', 'cvr', 'asales', 'acos', 'roas'] as MetricKey[]).map((k) => (
              <div key={k} className="stat px-4 py-3">
                <div className="stat-title text-xs">{METRICS[k].label}</div>
                <div className="stat-value num text-lg">{bkShow(k, cur.total)}</div>
                {prev && <div className="stat-desc num">vs {bkShow(k, prev.total)}</div>}
              </div>
            ))}
          </div>
          <div className="max-h-[70vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
            <table className="table table-sm">
              <thead className="sticky top-0 z-20 bg-base-200 shadow-[0_1px_0_var(--color-line)]">
                <tr className="text-xs text-muted">
                  <th className={TH_LEFT}>Keyword</th>
                  <th className="px-3 py-2 text-left font-medium">Campaign</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  {shown.map((k) => (
                    <th
                      key={k}
                      className={`${TH} ${SORTABLE.has(k) ? 'cursor-pointer' : ''}`}
                      onClick={() => SORTABLE.has(k) && setSort(k)}
                      title={SORTABLE.has(k) ? 'Sort by this column' : ''}
                    >
                      {METRICS[k].label}
                      {sort === k ? ' ▾' : ''}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {cur.rows.map((r) => (
                  <tr key={key(r)} className={ROW}>
                    <td className={TD_LEFT}>{r.keyword}</td>
                    <td className="max-w-64 truncate px-3 py-1.5 text-xs text-muted" title={r.campaigns.join('\n')}>
                      {r.campaign ?? (r.campaigns.length === 1 ? r.campaigns[0] : `${r.campaigns.length} campaigns`)}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted" title={r.categories.join(', ')}>
                      {r.categories.length > 1 ? `${r.categories[0]} +${r.categories.length - 1}` : r.categories[0]}
                    </td>
                    {shown.map((k) => (
                      <BkCell key={k} k={k} s={r.sums} prev={prevBy.get(key(r))} comparing={comparing} daysA={dA} daysB={dB} />
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Notes
            notes={[
              ...(cur.truncated ? [`Showing the top ${cur.rows.length} rows by ${METRICS[sort].label}; the totals above cover every row. Narrow with search, city, campaign or impressions.`] : []),
              'Blinkit gives no clicks for listing ads, so there is no CTR / CPC. ATC, units and sales are direct + indirect. Recommendation ads have no keyword and appear as "[Reco] <placement>".',
              'The City filter keeps only campaigns that target exactly that city / metro; multi-city, Top City, ROC and Pan-India campaigns are excluded, never split.',
            ]}
          />
        </>
      )}
    </div>
  );
}
