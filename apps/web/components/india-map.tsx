'use client';

import india from '@svg-maps/india';
import type { StateRow } from '@dash/shared';
import { useMemo, useState } from 'react';

import { fmtInt, fmtMoney, fmtPct } from '@/lib/format';

/** Map shapes (CC BY 4.0, svg-maps by Victor Cazanave) use pre-2020 names; map them to ours. */
const SHAPE_TO_STATE: Record<string, string> = {
  'Dadra and Nagar Haveli': 'Dadra and Nagar Haveli and Daman and Diu',
  'Daman and Diu': 'Dadra and Nagar Haveli and Daman and Diu',
};

/** Sequential single-hue ramp (light → dark blue) for magnitude. */
const RAMP = ['#dbe8f8', '#a9c9ef', '#6fa4e3', '#2a78d6', '#1b4f91'];
const NO_DATA = '#eceef1';

export type MapMetric = 'sales' | 'units' | 'orders';

const METRIC_FMT: Record<MapMetric, (v: number | null) => string> = { sales: fmtMoney, units: fmtInt, orders: fmtInt };

function delta(v: number | null | undefined, p: number | null | undefined) {
  if (v == null || p == null) return '';
  if (p === 0) return v ? ' (new)' : '';
  const d = ((v - p) / Math.abs(p)) * 100;
  return ` (${d > 0 ? '▲' : '▼'} ${Math.abs(d).toFixed(1)}%)`;
}

/**
 * India heat map (State Wise Data). Colour = selected metric in 5 quantile-ish
 * bins of a single-hue ramp; hover shows orders, units and sales (and the
 * comparison period when on). Ladakh's data is shown on the J&K shape, which
 * this map draws as one region.
 */
export function IndiaMap({ rows, prev, metric }: { rows: StateRow[]; prev: StateRow[] | null; metric: MapMetric }) {
  const [hover, setHover] = useState<{ id: string; x: number; y: number } | null>(null);
  const byState = useMemo(() => {
    const m = new Map(rows.map((r) => [r.state, r]));
    const lad = m.get('Ladakh');
    const jk = m.get('Jammu and Kashmir');
    if (lad) {
      m.set('Jammu and Kashmir', {
        ...(jk ?? lad),
        state: 'Jammu and Kashmir',
        units: (jk?.units ?? 0) + lad.units,
        sales: (jk?.sales ?? 0) + lad.sales,
        orders: jk?.orders == null && lad.orders == null ? null : (jk?.orders ?? 0) + (lad.orders ?? 0),
        asins: Math.max(jk?.asins ?? 0, lad.asins),
      });
    }
    return m;
  }, [rows]);
  const prevBy = useMemo(() => new Map((prev ?? []).map((r) => [r.state, r])), [prev]);
  const val = (r: StateRow | undefined) => (r ? (metric === 'orders' ? (r.orders ?? 0) : r[metric]) : 0);
  const max = Math.max(0, ...[...byState.values()].map(val));
  const color = (v: number) => (v <= 0 || max <= 0 ? NO_DATA : RAMP[Math.min(RAMP.length - 1, Math.floor((v / max) * RAMP.length))]!);

  const hoverLoc = hover ? india.locations.find((l) => l.id === hover.id) : undefined;
  const hoverName = hoverLoc ? (SHAPE_TO_STATE[hoverLoc.name] ?? hoverLoc.name) : '';
  const hr = hoverName ? byState.get(hoverName) : undefined;
  const hp = hoverName ? prevBy.get(hoverName) : undefined;

  return (
    <div className="relative" onMouseLeave={() => setHover(null)}>
      <svg viewBox={india.viewBox} className="h-auto w-full max-w-[560px]" role="img" aria-label="India map">
        {india.locations.map((l) => {
          const name = SHAPE_TO_STATE[l.name] ?? l.name;
          const r = byState.get(name);
          return (
            <path
              key={l.id}
              d={l.path}
              fill={color(val(r))}
              stroke={hover?.id === l.id ? 'var(--color-ink)' : '#ffffff'}
              strokeWidth={hover?.id === l.id ? 1.2 : 0.6}
              onMouseMove={(e) => {
                const box = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect();
                setHover({ id: l.id, x: e.clientX - box.left, y: e.clientY - box.top });
              }}
            />
          );
        })}
      </svg>
      {hover && (
        <div
          className="pointer-events-none absolute z-40 min-w-44 rounded-md border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={{ left: hover.x + 14, top: hover.y + 14 }}
        >
          <div className="mb-1 font-semibold">{hoverName}</div>
          {hr ? (
            <dl className="num grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
              <dt className="text-muted">Orders</dt>
              <dd className="text-right">
                {fmtInt(hr.orders)}
                {prev && delta(hr.orders, hp?.orders)}
              </dd>
              <dt className="text-muted">Units</dt>
              <dd className="text-right">
                {fmtInt(hr.units)}
                {prev && delta(hr.units, hp?.units)}
              </dd>
              <dt className="text-muted">Sales</dt>
              <dd className="text-right">
                {fmtMoney(hr.sales)}
                {prev && delta(hr.sales, hp?.sales)}
              </dd>
              <dt className="text-muted">Sales share</dt>
              <dd className="text-right">{fmtPct(hr.salesSharePct)}</dd>
            </dl>
          ) : (
            <div className="text-muted">No sales in this period</div>
          )}
        </div>
      )}
      <div className="mt-2 flex items-center gap-2 text-[11px] text-muted">
        <span>{metric === 'sales' ? 'Sales' : metric === 'units' ? 'Units' : 'Orders'}:</span>
        <span className="h-2.5 w-4 rounded-sm" style={{ background: NO_DATA }} /> none
        {RAMP.map((c, i) => (
          <span key={c} className="flex items-center gap-1">
            <span className="h-2.5 w-4 rounded-sm" style={{ background: c }} />
            {i === RAMP.length - 1 ? `up to ${METRIC_FMT[metric](max)}` : ''}
          </span>
        ))}
      </div>
      <p className="mt-1 text-[10px] text-muted">Map: svg-maps (CC BY 4.0). Ladakh is shown within Jammu and Kashmir.</p>
    </div>
  );
}
