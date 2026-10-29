'use client';

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';

import { Icon } from './icons';

/* "Ad performance overview": metric cards with a tick box each; the ticked
   metrics (up to two — left and right axis) are drawn in the Trends chart.
   Marketplace-agnostic: Amazon and Blinkit pass their own metrics. */

export type AxisKind = 'inr' | 'num' | 'pct' | 'x';

export interface OverviewMetric {
  key: string;
  label: string;
  hint: string;
  /** Total / ratio for the whole period (null = no data). */
  value: number | null;
  /** Same metric for the comparison period. */
  prev?: number | null | undefined;
  /** One value per date (null = no data that day). */
  series: Array<number | null>;
  fmt: (v: number | null) => string;
  axis: AxisKind;
  higherIsBetter: boolean;
  /** Change isn't good or bad by itself (e.g. spend) — delta shown without colour. */
  neutral?: boolean;
}

export const TREND_COLORS = ['var(--color-trend-1)', 'var(--color-trend-2)'];
const MAX_LINES = 2;

export function PerformanceOverview({
  title,
  subtitle,
  dates,
  metrics,
  defaultSelected,
  prevLabel,
  loading,
  csvName,
  children,
}: {
  title: string;
  subtitle: ReactNode;
  dates: string[];
  metrics: OverviewMetric[];
  defaultSelected: string[];
  /** e.g. "prev. 7 days" */
  prevLabel?: string | undefined;
  loading?: boolean;
  csvName: string;
  /** Rendered under the chart (e.g. split by ad type). */
  children?: ReactNode;
}) {
  const [selected, setSelected] = useState<string[]>(defaultSelected);
  const toggle = (k: string) =>
    setSelected((s) => (s.includes(k) ? (s.length > 1 ? s.filter((x) => x !== k) : s) : [...s, k].slice(-MAX_LINES)));
  const lines = selected
    .map((k) => metrics.find((m) => m.key === k))
    .filter((m): m is OverviewMetric => !!m);

  return (
    <section className="space-y-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="mr-auto">
          <h3 className="text-[21px] font-semibold tracking-tight">{title}</h3>
          <p className="mt-0.5 text-[15px] text-muted">{subtitle}</p>
        </div>
        {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
        <button onClick={() => downloadCsv(csvName, dates, metrics)} className="btn-quiet" disabled={!dates.length}>
          <Icon name="download" className="size-4" /> Download
        </button>
      </div>

      <CardStrip>
        {metrics.map((m) => {
          const on = selected.includes(m.key);
          const color = on ? TREND_COLORS[selected.indexOf(m.key)] : undefined;
          return (
            <button
              key={m.key}
              role="checkbox"
              aria-checked={on}
              onClick={() => toggle(m.key)}
              title={m.hint}
              className={`group relative flex min-h-[100px] w-[214px] shrink-0 snap-start flex-col rounded-xl border bg-surface px-5 py-4 text-left transition-colors ${
                on ? 'border-ink shadow-[0_0_0_1px_var(--color-ink)]' : 'border-line hover:border-ink/30'
              }`}
            >
              <span className="flex items-center gap-1.5 pr-7 text-[15px] text-ink/85">
                {color && <span className="h-[3px] w-3 rounded-full" style={{ background: color }} aria-hidden />}
                {m.label}
                <span className="text-muted" aria-hidden>
                  <Icon name="info" className="size-3.5" />
                </span>
              </span>
              <span
                className={`absolute right-4 top-4 grid size-[20px] place-items-center rounded-[5px] border ${
                  on ? 'border-ink bg-ink text-white' : 'border-[#c7cbd2] bg-surface'
                }`}
                aria-hidden
              >
                {on && (
                  <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth={2.4}>
                    <path d="M3.5 8.5 6.5 11.5 12.5 5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                )}
              </span>
              <span className="num mt-1.5 text-[22px] font-semibold leading-tight tracking-tight">{m.fmt(m.value)}</span>
              <DeltaLine m={m} prevLabel={prevLabel} />
            </button>
          );
        })}
      </CardStrip>

      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
          <h3 className="mr-auto text-[21px] font-semibold tracking-tight">Trends</h3>
          {lines.map((l, i) => (
            <span key={l.key} className="flex items-center gap-1.5 text-sm">
              <span className="h-[3px] w-4 rounded-full" style={{ background: TREND_COLORS[i] }} aria-hidden />
              {l.label}
              {lines.length > 1 && <span className="text-xs text-muted">({i === 0 ? 'left' : 'right'} axis)</span>}
            </span>
          ))}
        </div>
        <div className="rounded-xl border border-line bg-surface px-3 pb-2 pt-4">
          {dates.length ? (
            <TrendChart dates={dates} lines={lines} />
          ) : (
            <div className="grid h-[300px] place-items-center text-sm text-muted">{loading ? 'Loading…' : 'No data in this period'}</div>
          )}
        </div>
        <p className="text-xs text-muted">Tick up to two cards to compare them on the chart.</p>
      </div>

      {children}
    </section>
  );
}

function DeltaLine({ m, prevLabel }: { m: OverviewMetric; prevLabel?: string | undefined }) {
  if (m.prev === undefined) return null;
  if (m.value == null || m.prev == null) return <span className="mt-1 text-xs text-muted">— vs {prevLabel}</span>;
  if (m.prev === 0) return <span className="mt-1 text-xs text-muted">{m.value === 0 ? '±0%' : 'new'} vs {prevLabel}</span>;
  const d = ((m.value - m.prev) / Math.abs(m.prev)) * 100;
  const good = m.higherIsBetter ? d > 0 : d < 0;
  const cls = Math.abs(d) < 0.05 || m.neutral ? 'text-ink/70' : good ? 'text-good' : 'text-bad';
  return (
    <span className="mt-1 text-xs text-muted" title={`${prevLabel}: ${m.fmt(m.prev)}`}>
      <span className={`num font-medium ${cls}`}>
        {d > 0 ? '▲' : d < 0 ? '▼' : '±'} {Math.abs(d).toFixed(1)}%
      </span>{' '}
      vs {prevLabel}
    </span>
  );
}

/** Horizontally scrolling row of cards with arrow buttons when it overflows. */
function CardStrip({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });
  const update = () => {
    const el = ref.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 4, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 4 });
  };
  useEffect(() => {
    update();
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const by = (dx: number) => ref.current?.scrollBy({ left: dx, behavior: 'smooth' });
  return (
    <div className="relative">
      <div ref={ref} onScroll={update} className="no-scrollbar flex snap-x gap-3 overflow-x-auto pb-1">
        {children}
      </div>
      {edges.left && (
        <button onClick={() => by(-460)} className="strip-arrow left-0 -translate-x-1/2" aria-label="Scroll cards left">
          <Icon name="chevronL" className="size-4" />
        </button>
      )}
      {edges.right && (
        <button onClick={() => by(460)} className="strip-arrow right-0 translate-x-1/2" aria-label="Scroll cards right">
          <Icon name="chevronR" className="size-4" />
        </button>
      )}
    </div>
  );
}

// ── Trend chart ─────────────────────────────────────────────────────────────

const H = 300;

/** Axis range with exactly 4 "nice" intervals, so a left and a right axis share gridlines. */
function niceScale(values: Array<number | null>) {
  const v = values.filter((x): x is number => x != null && Number.isFinite(x));
  let lo = Math.min(0, ...v);
  let hi = Math.max(0, ...v);
  if (hi === lo) hi = lo + 1;
  const raw = (hi - lo) / 4;
  const mag = 10 ** Math.floor(Math.log10(raw));
  for (const f of [1, 2, 2.5, 5, 10, 20]) {
    const step = f * mag;
    const bottom = Math.floor(lo / step) * step;
    if (bottom + 4 * step >= hi - 1e-9) {
      lo = bottom;
      return { lo, hi: bottom + 4 * step, ticks: [0, 1, 2, 3, 4].map((i) => bottom + i * step) };
    }
  }
  return { lo, hi, ticks: [lo, hi] };
}

/** ₹20K · 1.5L · 2.3Cr · 12% · 3.4× */
export function compact(v: number, kind: AxisKind): string {
  const a = Math.abs(v);
  const trim = (x: number) => (x >= 100 ? x.toFixed(0) : x.toFixed(1).replace(/\.0$/, ''));
  let s: string;
  if (kind === 'pct') s = `${trim(v)}%`;
  else if (kind === 'x') s = `${trim(v)}×`;
  else {
    s = a >= 1e7 ? `${trim(a / 1e7)}Cr` : a >= 1e5 ? `${trim(a / 1e5)}L` : a >= 1e3 ? `${trim(a / 1e3)}K` : trim(a);
    s = `${v < 0 ? '-' : ''}${kind === 'inr' ? '₹' : ''}${s}`;
  }
  return s;
}

export const dayLabel = (iso: string) =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', timeZone: 'UTC' });

function TrendChart({ dates, lines }: { dates: string[]; lines: OverviewMetric[] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  const [hover, setHover] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = wrap.current;
    if (!el) return;
    setW(el.clientWidth || 900);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => setW(el.clientWidth || 900));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const n = dates.length;
  const M = { l: 58, r: lines.length > 1 ? 58 : 18, t: 10, b: 30 };
  const iw = Math.max(10, w - M.l - M.r);
  const ih = H - M.t - M.b;
  const x = (i: number) => M.l + (n === 1 ? iw / 2 : (i * iw) / (n - 1));
  const scales = lines.map((l) => niceScale(l.series));
  const y = (s: { lo: number; hi: number }, v: number) => M.t + ih - ((v - s.lo) / (s.hi - s.lo)) * ih;
  const grid = scales[0] ?? niceScale([0]);

  const every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 76))));
  const xTicks = dates.map((d, i) => ({ d, i })).filter(({ i }) => i % every === 0 || (i === n - 1 && n > 1 && (n - 1) % every > every / 2));

  const path = (l: OverviewMetric, s: { lo: number; hi: number }) => {
    let d = '';
    let pen = false;
    l.series.forEach((v, i) => {
      if (v == null || !Number.isFinite(v)) return void (pen = false);
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)},${y(s, v).toFixed(1)}`;
      pen = true;
    });
    return d;
  };

  const onMove = (e: MouseEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * w;
    const i = n === 1 ? 0 : Math.round(((px - M.l) / iw) * (n - 1));
    setHover(Math.min(n - 1, Math.max(0, i)));
  };

  return (
    <div ref={wrap} className="relative">
      <svg
        width="100%"
        height={H}
        viewBox={`0 0 ${w} ${H}`}
        role="img"
        aria-label={`Trend of ${lines.map((l) => l.label).join(' and ')} from ${dates[0]} to ${dates[n - 1]}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        className="block select-none"
      >
        {grid.ticks.map((t, k) => (
          <g key={k}>
            <line x1={M.l} x2={M.l + iw} y1={y(grid, t)} y2={y(grid, t)} stroke="var(--color-line)" strokeWidth={1} />
            {lines[0] && (
              <text x={M.l - 10} y={y(grid, t) + 4} textAnchor="end" className="fill-muted text-[12px]">
                {compact(t, lines[0].axis)}
              </text>
            )}
            {lines[1] && scales[1] && (
              <text x={M.l + iw + 10} y={y(grid, t) + 4} textAnchor="start" className="fill-muted text-[12px]">
                {compact(scales[1].ticks[k] ?? 0, lines[1].axis)}
              </text>
            )}
          </g>
        ))}
        {xTicks.map(({ d, i }) => (
          <text key={d} x={x(i)} y={H - 8} textAnchor={n === 1 ? 'middle' : i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'} className="fill-muted text-[12px]">
            {dayLabel(d)}
          </text>
        ))}
        {hover != null && <line x1={x(hover)} x2={x(hover)} y1={M.t} y2={M.t + ih} stroke="var(--color-ink)" strokeOpacity={0.25} strokeDasharray="3 3" />}
        {lines.map((l, k) => (
          <g key={l.key}>
            <path d={path(l, scales[k]!)} fill="none" stroke={TREND_COLORS[k]} strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />
            {(n <= 14 || hover != null) &&
              l.series.map((v, i) =>
                v == null || !Number.isFinite(v) || (n > 14 && i !== hover) ? null : (
                  <circle key={i} cx={x(i)} cy={y(scales[k]!, v)} r={i === hover ? 4.5 : n <= 14 ? 2.5 : 0} fill={i === hover ? 'var(--color-surface)' : TREND_COLORS[k]} stroke={TREND_COLORS[k]} strokeWidth={i === hover ? 2.25 : 0} />
                )
              )}
          </g>
        ))}
      </svg>
      {hover != null && dates[hover] && (
        <div
          className="pointer-events-none absolute top-2 z-20 min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-lg"
          style={x(hover) > w * 0.6 ? { right: w - x(hover) + 12 } : { left: x(hover) + 12 }}
        >
          <div className="mb-1 font-medium">
            {new Date(`${dates[hover]}T00:00:00Z`).toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })}
          </div>
          {lines.map((l, k) => (
            <div key={l.key} className="flex items-center gap-2">
              <span className="h-[3px] w-3 rounded-full" style={{ background: TREND_COLORS[k] }} aria-hidden />
              <span className="text-muted">{l.label}</span>
              <span className="num ml-auto font-medium">{l.fmt(l.series[hover] ?? null)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function downloadCsv(name: string, dates: string[], metrics: OverviewMetric[]) {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const rows = [
    ['Date', ...metrics.map((m) => m.label)],
    ...dates.map((d, i) => [d, ...metrics.map((m) => {
      const v = m.series[i];
      return v == null || !Number.isFinite(v) ? '' : String(Math.round(v * 100) / 100);
    })]),
    ['Total', ...metrics.map((m) => (m.value == null ? '' : String(Math.round(m.value * 100) / 100)))],
  ];
  const blob = new Blob([rows.map((r) => r.map(esc).join(',')).join('\n')], { type: 'text/csv' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${name}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** Simple breakdown table under the chart (ad type / channel split). */
export function BreakdownTable({ title, head, rows }: {
  title: string;
  head: string[];
  rows: Array<{ key: string; cells: ReactNode[] }>;
}) {
  return (
    <div className="space-y-3">
      <h3 className="text-[17px] font-semibold tracking-tight">{title}</h3>
      <div className="overflow-x-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-line bg-side text-muted">
              {head.map((h, i) => (
                <th key={h} className={`whitespace-nowrap px-4 py-2.5 font-medium ${i === 0 ? 'text-left' : 'text-right'}`}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line/70 last:border-0">
                {r.cells.map((c, i) => (
                  <td key={i} className={`num whitespace-nowrap px-4 py-2.5 ${i === 0 ? 'text-left font-medium' : 'text-right'}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
