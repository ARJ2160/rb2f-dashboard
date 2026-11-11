'use client';

import type { GlanceViewsResponse } from '@dash/shared';
import { useEffect, useState } from 'react';

import { Columns } from '@/components/charts';
import { getGlanceViews } from '@/lib/api';
import { fmtInt, fmtPct } from '@/lib/format';

import { Card, Select, TABLE_WRAP, THEAD, ViewShell } from './shared';

const MONTHS = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDay = (iso: string) => {
  const [, m, d] = iso.split('-');
  return `${Number(d)} ${MONTHS[Number(m)]}`;
};

/** Amazon Pi ASIN-level Glance Views — account trend + per-ASIN breakdown (your ASINs only). */
export function GlanceViewsView({ profileId }: { profileId: string }) {
  const [category, setCategory] = useState('');
  const [data, setData] = useState<GlanceViewsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    getGlanceViews(profileId, { category })
      .then((d) => alive && setData(d))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId, category]);

  return (
    <ViewShell
      error={error}
      loading={loading}
      notes={data?.notes}
      toolbar={<Select label="Category" value={category} onChange={setCategory} options={data?.categories ?? (category ? [category] : [])} />}
    >
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-6 text-sm">
            <span className="text-muted">Total glance views: <span className="font-semibold text-ink">{fmtInt(data.total)}</span></span>
            {data.from && <span className="text-muted">{fmtDay(data.from)} – {data.to && fmtDay(data.to)}</span>}
          </div>

          <Card title="Glance views by day (account)">
            <Columns items={data.trend.map((t) => ({ label: fmtDay(t.date), value: t.glanceViews }))} fmt={fmtInt} />
          </Card>

          <div className={TABLE_WRAP}>
            <table className="table table-sm">
              <thead className={THEAD}>
                <tr className="text-xs text-muted">
                  <th className="px-3 py-2 text-left font-medium">ASIN</th>
                  <th className="px-3 py-2 text-left font-medium">Product</th>
                  <th className="px-3 py-2 text-left font-medium">Category</th>
                  <th className="px-3 py-2 text-right font-medium">Glance views</th>
                  <th className="px-3 py-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {data.rows.map((r) => (
                  <tr key={r.asin} className="border-b border-line/60 odd:bg-surface even:bg-stripe hover:bg-accent-soft">
                    <td className="whitespace-nowrap px-3 py-1.5 font-mono text-xs">{r.asin}</td>
                    <td className="max-w-80 truncate px-3 py-1.5" title={r.title ?? ''}>{r.title ?? '—'}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">{r.category ?? 'Unmapped'}</td>
                    <td className="num px-3 py-1.5 text-right font-semibold">{fmtInt(r.glanceViews)}</td>
                    <td className="num px-3 py-1.5 text-right">{fmtPct(r.sharePct)}</td>
                  </tr>
                ))}
                {data.rows.length === 0 && (
                  <tr><td colSpan={5} className="px-3 py-6 text-center text-sm text-muted">No glance-view data for this filter.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </ViewShell>
  );
}
