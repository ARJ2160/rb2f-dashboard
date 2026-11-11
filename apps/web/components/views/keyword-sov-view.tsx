'use client';

import type { KeywordMetricDef, KeywordSovResponse } from '@dash/shared';
import { useEffect, useMemo, useState } from 'react';

import { getKeywordSov } from '@/lib/api';
import { fmtDateLong, fmtInt, fmtMoney, fmtPct } from '@/lib/format';

import { MultiSelect, Select, TABLE_WRAP, THEAD, ViewShell } from './shared';

const MAX_METRICS = 7;
const durationLabel = (d: string) => d.replace('days', ' days');
const typeLabel = (t: string) => (t === 'ALL' ? 'All' : t.charAt(0) + t.slice(1).toLowerCase());

function fmtMetric(def: KeywordMetricDef, v: number | string | null): string {
  if (v == null || v === '') return '—';
  if (def.format === 'asin') return String(v);
  const n = Number(v);
  if (!Number.isFinite(n)) return String(v);
  return def.format === 'money' ? fmtMoney(n) : def.format === 'num' ? fmtInt(n) : fmtPct(n);
}

/** Amazon Pi keyword SOV — duration window, Branded/Competitor/Generic tabs, and a metric picker (≤ 7 on screen). */
export function KeywordSovView({ profileId }: { profileId: string }) {
  const [duration, setDuration] = useState('');
  const [date, setDate] = useState('');
  const [type, setType] = useState('ALL');
  const [metricCsv, setMetricCsv] = useState('');
  const [seeded, setSeeded] = useState(false);
  const [data, setData] = useState<KeywordSovResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getKeywordSov(profileId, { duration: duration || undefined, date: date || undefined, keywordType: type })
      .then((d) => {
        if (!alive) return;
        setData(d);
        if (!duration) setDuration(d.duration);
        if (d.date && d.date !== date) setDate(d.date);
        if (!seeded && d.metricDefs.length) {
          setMetricCsv(d.metricDefs.filter((m) => m.default).slice(0, MAX_METRICS).map((m) => m.key).join(','));
          setSeeded(true);
        }
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId, duration, date, type, seeded]);

  const defs = data?.metricDefs ?? [];
  const selectedKeys = useMemo(() => metricCsv.split(',').filter(Boolean), [metricCsv]);
  const selectedDefs = selectedKeys.map((k) => defs.find((d) => d.key === k)).filter((d): d is KeywordMetricDef => !!d);
  const metricOptions = defs.map((d) => ({ value: d.key, label: `${d.label}${d.group === 'sb' ? ' · SB' : d.group === 'organic' ? ' · Org' : ''}` }));

  const onMetrics = (csv: string) => {
    const keys = csv.split(',').filter(Boolean);
    if (keys.length <= MAX_METRICS) setMetricCsv(csv);
    // over the cap → ignore the add, keep the current selection
  };

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={
        <>
          {(data?.durations.length ?? 0) > 0 && (
            <div className="join">
              {data!.durations.map((d) => (
                <button
                  key={d}
                  onClick={() => {
                    setDuration(d);
                    setDate(''); // let the new duration pick its latest snapshot
                  }}
                  className={`btn btn-sm join-item ${duration === d ? 'btn-primary' : 'font-normal'}`}
                >
                  {durationLabel(d)}
                </button>
              ))}
            </div>
          )}
          {(data?.dates.length ?? 0) > 0 && (
            <Select
              label="Date"
              value={date || (data?.date ?? '')}
              onChange={setDate}
              options={(data?.dates ?? []).map((d) => ({ value: d, label: fmtDateLong(d) }))}
              allLabel={null}
            />
          )}
          <MultiSelect label={`Metrics (max ${MAX_METRICS})`} value={metricCsv} onChange={onMetrics} options={metricOptions} allLabel="None" />
        </>
      }
    >
      {data && (
        <>
          <div role="tablist" className="flex flex-wrap gap-1">
            {['ALL', ...data.types].map((t) => (
              <button
                key={t}
                role="tab"
                aria-selected={type === t}
                onClick={() => setType(t)}
                className={`rounded-lg px-3 py-1.5 text-sm ${type === t ? 'bg-ink font-medium text-white' : 'text-ink/75 hover:bg-black/5'}`}
              >
                {typeLabel(t)}
              </button>
            ))}
          </div>

          <div className={TABLE_WRAP}>
            <table className="table table-sm">
              <thead className={THEAD}>
                <tr className="text-xs text-muted">
                  <th className="sticky left-0 z-30 min-w-56 bg-side px-3 py-2 text-left font-medium">Keyword</th>
                  <th className="px-3 py-2 text-right font-medium"># Searches</th>
                  <th className="px-3 py-2 text-right font-medium">Rank</th>
                  <th className="px-3 py-2 text-left font-medium">Most Clicked Organic</th>
                  <th className="px-3 py-2 text-left font-medium">Most Clicked SP</th>
                  {selectedDefs.map((d) => (
                    <th key={d.key} className="whitespace-nowrap px-3 py-2 text-right font-medium">{d.label}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.keyword} className="border-b border-line/60 odd:bg-surface even:bg-stripe hover:bg-accent-soft">
                    <td className="sticky left-0 z-10 max-w-72 truncate bg-inherit px-3 py-1.5 font-medium" title={r.keyword}>{r.keyword}</td>
                    <td className="num whitespace-nowrap px-3 py-1.5 text-right">{r.searches ?? '—'}</td>
                    <td className="num px-3 py-1.5 text-right">{r.rank ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{r.mostClickedOrganicAsin ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{r.mostClickedSpAsin ?? '—'}</td>
                    {selectedDefs.map((d) => (
                      <td key={d.key} className={`num whitespace-nowrap px-3 py-1.5 text-right ${d.format === 'asin' ? 'font-mono text-xs' : ''}`}>
                        {fmtMetric(d, r.metrics[d.key] ?? null)}
                      </td>
                    ))}
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan={5 + selectedDefs.length} className="px-3 py-6 text-center text-sm text-muted">No keywords for this duration / tab.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ViewShell>
  );
}
