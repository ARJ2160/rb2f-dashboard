'use client';

import type { SearchRankAsin, SearchRankResponse } from '@dash/shared';
import { useEffect, useMemo, useState } from 'react';

import { getSearchRank } from '@/lib/api';

import { Card, Select, TABLE_WRAP, THEAD, ViewShell } from './shared';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtPeriod = (iso: string) => {
  const [y, m] = iso.split('-');
  return `${MONTHS[Number(m)]} '${y!.slice(2)}`;
};
const r1 = (n: number | null) => (n == null ? '—' : n.toFixed(1));

/** Rank trend line — lower rank sits higher (better). */
function RankChart({ asin }: { asin: SearchRankAsin }) {
  const pts = asin.points;
  if (pts.length < 2) return <p className="py-10 text-center text-sm text-muted">Need at least two months of data to chart a trend.</p>;
  const W = 640;
  const H = 240;
  const padX = 48;
  const padY = 28;
  const ranks = pts.map((p) => p.rank);
  const min = Math.min(...ranks);
  const max = Math.max(...ranks);
  const span = max - min || 1;
  const x = (i: number) => padX + (i / (pts.length - 1)) * (W - padX - 16);
  const y = (rank: number) => padY + ((rank - min) / span) * (H - padY * 2); // best (min) at top
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.rank).toFixed(1)}`).join(' ');

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={`Search rank trend for ${asin.asin}`}>
      <path d={line} fill="none" stroke="var(--color-s1)" strokeWidth="2" />
      {pts.map((p, i) => (
        <g key={p.period}>
          <circle cx={x(i)} cy={y(p.rank)} r="4" fill="var(--color-surface)" stroke="var(--color-s1)" strokeWidth="2" />
          <text x={x(i)} y={y(p.rank) - 10} textAnchor="middle" className="fill-ink text-[11px]">{p.rank.toFixed(1)}</text>
          <text x={x(i)} y={H - 6} textAnchor="middle" className="fill-muted text-[11px]">{fmtPeriod(p.period)}</text>
        </g>
      ))}
    </svg>
  );
}

/** Amazon Pi monthly organic search rank (lower = better). */
export function SearchRankView({ profileId }: { profileId: string }) {
  const [data, setData] = useState<SearchRankResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [asin, setAsin] = useState('');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getSearchRank(profileId)
      .then((d) => {
        if (!alive) return;
        setData(d);
        setAsin((a) => a || d.asins[0]?.asin || '');
      })
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId]);

  const selected = useMemo(() => data?.asins.find((a) => a.asin === asin) ?? data?.asins[0], [data, asin]);
  const options = (data?.asins ?? []).map((a) => ({ value: a.asin, label: a.title ? `${a.title.slice(0, 60)} — ${a.asin}` : a.asin }));

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={options.length > 0 ? <Select label="Product" value={asin} onChange={setAsin} options={options} allLabel={null} /> : undefined}
    >
      {data && selected && (
        <>
          <Card title={selected.title ?? selected.asin}>
            <div className="mb-2 flex flex-wrap gap-4 text-sm text-muted">
              <span>ASIN: <span className="font-mono text-ink">{selected.asin}</span></span>
              <span>Latest rank: <span className="font-semibold text-ink">{r1(selected.latestRank)}</span></span>
              <span>Best: <span className="font-semibold text-ink">{r1(selected.bestRank)}</span></span>
              {selected.change != null && (
                <span>Change: <span className={`font-semibold ${selected.change < 0 ? 'text-good' : selected.change > 0 ? 'text-bad' : 'text-ink'}`}>{selected.change < 0 ? '▲ improved ' : selected.change > 0 ? '▼ dropped ' : ''}{Math.abs(selected.change).toFixed(1)}</span></span>
              )}
            </div>
            <RankChart asin={selected} />
          </Card>

          <div className={TABLE_WRAP}>
            <table className="table table-sm">
              <thead className={THEAD}>
                <tr className="text-xs text-muted">
                  <th className="px-3 py-2 text-left font-medium">ASIN</th>
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Latest rank</th>
                  <th className="px-3 py-2 text-right font-medium">Best</th>
                  <th className="px-3 py-2 text-right font-medium">Change</th>
                </tr>
              </thead>
              <tbody>
                {data.asins.map((a) => (
                  <tr
                    key={a.asin}
                    onClick={() => setAsin(a.asin)}
                    className={`cursor-pointer border-b border-line/60 odd:bg-surface even:bg-stripe hover:bg-accent-soft ${a.asin === selected.asin ? 'bg-accent-soft' : ''}`}
                  >
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{a.asin}</td>
                    <td className="max-w-80 truncate px-3 py-1.5" title={a.title ?? ''}>{a.title ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">{a.category ?? 'Unmapped'}</td>
                    <td className="num px-3 py-1.5 text-right font-semibold">{r1(a.latestRank)}</td>
                    <td className="num px-3 py-1.5 text-right">{r1(a.bestRank)}</td>
                    <td className={`num px-3 py-1.5 text-right ${a.change == null ? '' : a.change < 0 ? 'text-good' : a.change > 0 ? 'text-bad' : ''}`}>
                      {a.change == null ? '—' : `${a.change < 0 ? '−' : a.change > 0 ? '+' : ''}${Math.abs(a.change).toFixed(1)}`}
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
