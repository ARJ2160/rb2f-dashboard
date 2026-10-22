'use client';

import { useState, type ReactNode } from 'react';

import { fmtPct } from '@/lib/format';

/** Categorical slots in fixed order (dataviz reference palette) — colour follows the entity, never its rank. */
export const SERIES = ['var(--color-s1)', 'var(--color-s2)', 'var(--color-s3)', 'var(--color-s4)', 'var(--color-s5)', 'var(--color-s6)', 'var(--color-s7)'];
const OTHER = '#9aa1ac';

export interface ChartItem {
  label: string;
  value: number;
  prev?: number | null | undefined;
}

function Tip({ tip }: { tip: { x: number; y: number; body: ReactNode } | null }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-40 rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs shadow-lg"
      style={{ left: tip.x + 12, top: tip.y + 12 }}
    >
      {tip.body}
    </div>
  );
}

function deltaText(v: number, p: number | null | undefined) {
  if (p == null) return null;
  if (p === 0) return v === 0 ? '±0%' : 'new';
  const d = ((v - p) / Math.abs(p)) * 100;
  return `${d > 0 ? '▲' : d < 0 ? '▼' : '±'} ${Math.abs(d).toFixed(1)}%`;
}

/**
 * Donut for part-to-whole (≤ 7 slices; the rest fold into "Other").
 * Legend always present with value + share (identity never by colour alone).
 * `colorKeys` keeps a slice's colour stable when filters change the set.
 */
export function Donut({ items, fmt, colorKeys, comparing = false, size = 168 }: {
  items: ChartItem[];
  fmt: (v: number | null) => string;
  colorKeys?: string[];
  comparing?: boolean;
  size?: number;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const positive = items.filter((i) => i.value > 0).sort((a, b) => b.value - a.value);
  let slices = positive;
  if (positive.length > 7) {
    const rest = positive.slice(6);
    slices = [
      ...positive.slice(0, 6),
      { label: 'Other', value: rest.reduce((a, r) => a + r.value, 0), prev: rest.reduce((a, r) => a + (r.prev ?? 0), 0) },
    ];
  }
  const total = slices.reduce((a, s) => a + s.value, 0);
  const color = (label: string, i: number) => {
    if (label === 'Other') return OTHER;
    const k = colorKeys ? colorKeys.indexOf(label) : i;
    return SERIES[(k >= 0 ? k : i) % SERIES.length]!;
  };
  const r = size / 2;
  const inner = r * 0.62;
  let acc = 0;
  const arcs = slices.map((s, i) => {
    const a0 = (acc / total) * Math.PI * 2;
    acc += s.value;
    const a1 = (acc / total) * Math.PI * 2;
    const gap = slices.length > 1 ? 0.012 : 0;
    const p = (ang: number, rad: number) => [r + rad * Math.sin(ang), r - rad * Math.cos(ang)];
    const large = a1 - a0 - 2 * gap > Math.PI ? 1 : 0;
    const [x0, y0] = p(a0 + gap, r);
    const [x1, y1] = p(a1 - gap, r);
    const [x2, y2] = p(a1 - gap, inner);
    const [x3, y3] = p(a0 + gap, inner);
    const d =
      slices.length === 1
        ? `M ${r} 0 A ${r} ${r} 0 1 1 ${r - 0.01} 0 L ${r - 0.01} ${r - inner} A ${inner} ${inner} 0 1 0 ${r} ${r - inner} Z`
        : `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${x2} ${y2} A ${inner} ${inner} 0 ${large} 0 ${x3} ${y3} Z`;
    return { d, s, i };
  });
  if (!total) return <p className="py-8 text-center text-xs text-muted">No data</p>;
  return (
    <div className="relative flex flex-wrap items-center gap-5" onMouseLeave={() => (setHover(null), setTip(null))}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Share chart">
        {arcs.map(({ d, s, i }) => (
          <path
            key={s.label}
            d={d}
            fill={color(s.label, i)}
            opacity={hover == null || hover === i ? 1 : 0.35}
            onMouseMove={(e) => {
              setHover(i);
              const box = (e.currentTarget.ownerSVGElement?.parentElement as HTMLElement).getBoundingClientRect();
              setTip({
                x: e.clientX - box.left,
                y: e.clientY - box.top,
                body: (
                  <>
                    <div className="font-semibold">{s.label}</div>
                    <div className="num">
                      {fmt(s.value)} · {fmtPct((s.value / total) * 100)}
                    </div>
                    {comparing && s.prev != null && (
                      <div className="num text-muted">
                        vs {fmt(s.prev)} {deltaText(s.value, s.prev)}
                      </div>
                    )}
                  </>
                ),
              });
            }}
          />
        ))}
        <text x={r} y={r - 4} textAnchor="middle" className="fill-[var(--color-muted)] text-[10px]">
          Total
        </text>
        <text x={r} y={r + 12} textAnchor="middle" className="num fill-[var(--color-ink)] text-[12px] font-semibold">
          {fmt(total)}
        </text>
      </svg>
      <ul className="min-w-44 flex-1 space-y-1 text-xs">
        {slices.map((s, i) => (
          <li
            key={s.label}
            className={`flex items-center gap-2 ${hover != null && hover !== i ? 'opacity-50' : ''}`}
            onMouseEnter={() => setHover(i)}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: color(s.label, i) }} />
            <span className="flex-1 truncate" title={s.label}>
              {s.label}
            </span>
            <span className="num">{fmt(s.value)}</span>
            <span className="num w-12 text-right text-muted">{fmtPct((s.value / total) * 100)}</span>
            {comparing && <span className="num w-14 text-right text-muted">{deltaText(s.value, s.prev) ?? '—'}</span>}
          </li>
        ))}
      </ul>
      <Tip tip={tip} />
    </div>
  );
}

/**
 * Horizontal bars (magnitude by category). With comparison, a thin grey bar
 * under each shows period B. Direct labels on every bar (few bars).
 */
export function HBars({ items, fmt, comparing = false }: { items: ChartItem[]; fmt: (v: number | null) => string; comparing?: boolean }) {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const max = Math.max(1e-9, ...items.map((i) => Math.max(i.value, comparing ? (i.prev ?? 0) : 0)));
  if (!items.length) return <p className="py-8 text-center text-xs text-muted">No data</p>;
  return (
    <div className="relative space-y-2" onMouseLeave={() => setTip(null)}>
      {items.map((it) => (
        <div
          key={it.label}
          className="grid grid-cols-[minmax(0,11rem)_1fr_auto] items-center gap-3 text-xs"
          onMouseMove={(e) => {
            const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
            setTip({
              x: e.clientX - box.left,
              y: e.clientY - box.top,
              body: (
                <>
                  <div className="font-semibold">{it.label}</div>
                  <div className="num">{fmt(it.value)}</div>
                  {comparing && (
                    <div className="num text-muted">
                      vs {fmt(it.prev ?? null)} {deltaText(it.value, it.prev)}
                    </div>
                  )}
                </>
              ),
            });
          }}
        >
          <span className="truncate" title={it.label}>
            {it.label}
          </span>
          <div className="space-y-0.5">
            <div className="h-3 rounded-r-[4px] bg-[var(--color-s1)]" style={{ width: `${Math.max(0.5, (Math.max(0, it.value) / max) * 100)}%` }} />
            {comparing && (
              <div className="h-1.5 rounded-r-[4px] bg-[#b7bdc7]" style={{ width: `${Math.max(0.5, (Math.max(0, it.prev ?? 0) / max) * 100)}%` }} />
            )}
          </div>
          <span className="num w-24 text-right">{fmt(it.value)}</span>
        </div>
      ))}
      {comparing && (
        <div className="flex gap-4 pt-1 text-[11px] text-muted">
          <span className="flex items-center gap-1.5">
            <span className="h-2 w-3 rounded-sm bg-[var(--color-s1)]" /> Selected period
          </span>
          <span className="flex items-center gap-1.5">
            <span className="h-1.5 w-3 rounded-sm bg-[#b7bdc7]" /> Comparison period
          </span>
        </div>
      )}
      <Tip tip={tip} />
    </div>
  );
}

/** Vertical columns (e.g. 24 hours). Comparison shown as a grey column beside each. */
export function Columns({ items, fmt, comparing = false, height = 200 }: {
  items: ChartItem[];
  fmt: (v: number | null) => string;
  comparing?: boolean;
  height?: number;
}) {
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null);
  const max = Math.max(1e-9, ...items.map((i) => Math.max(i.value, comparing ? (i.prev ?? 0) : 0)));
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <div className="flex items-end gap-1 border-b border-line" style={{ height }}>
        {items.map((it) => (
          <div
            key={it.label}
            className="flex h-full flex-1 items-end justify-center gap-[2px] hover:bg-canvas"
            onMouseMove={(e) => {
              const box = (e.currentTarget.parentElement!.parentElement as HTMLElement).getBoundingClientRect();
              setTip({
                x: e.clientX - box.left,
                y: e.clientY - box.top,
                body: (
                  <>
                    <div className="font-semibold">{it.label}</div>
                    <div className="num">{fmt(it.value)}</div>
                    {comparing && (
                      <div className="num text-muted">
                        vs {fmt(it.prev ?? null)} {deltaText(it.value, it.prev)}
                      </div>
                    )}
                  </>
                ),
              });
            }}
          >
            <div className="w-full max-w-5 rounded-t-[4px] bg-[var(--color-s1)]" style={{ height: `${(Math.max(0, it.value) / max) * 100}%` }} />
            {comparing && (
              <div className="w-full max-w-3 rounded-t-[4px] bg-[#b7bdc7]" style={{ height: `${(Math.max(0, it.prev ?? 0) / max) * 100}%` }} />
            )}
          </div>
        ))}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-muted">
        {items.map((it, i) => (
          <div key={it.label} className="flex-1 text-center">
            {i % 2 === 0 ? it.label.replace(':00', '') : ''}
          </div>
        ))}
      </div>
      <Tip tip={tip} />
    </div>
  );
}
