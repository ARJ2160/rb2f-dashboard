'use client';

import {
  DOC_STATUS_LABEL,
  daysOfCover,
  type BkInventoryResponse,
  type BkInventoryRow,
  type BkInventoryTrendResponse,
  type DocBands,
  type DocStatus,
} from '@dash/shared/blinkit';
import { useMemo, useState } from 'react';

import { Columns } from '@/components/charts';
import { ErrorBox, Notes } from '@/components/notes';
import { Card, Select } from '@/components/views/shared';
import { bkInventory, bkInventoryTrend } from '@/lib/blinkit-api';
import { fmtDateLong, fmtInt } from '@/lib/format';

import { ROW, TD_LEFT, TH, TH_LEFT } from './cells';
import { useLoad } from './dsr-dur';

type Cell = 'doc' | 'docInc' | 'stock' | 'drr';
type View = 'matrix' | 'sku' | 'detail';
/** DOC sales window — run rate from the last 7 or last 15 days. */
type Win = '7d' | '15d';
/** Stock the DOC is measured against. */
type Basis = 'sellable' | 'warehouse' | 'darkstore';
const ORDER: DocStatus[] = ['stock-out', 'critical', 'low', 'healthy', 'excess', 'no-sales', 'inactive'];
const WIN_DAYS: Record<Win, number> = { '7d': 7, '15d': 15 };
const BASIS_LABEL: Record<Basis, string> = {
  sellable: 'Sellable',
  warehouse: 'Warehouse',
  darkstore: 'Darkstore',
};

/** Cell / badge colours per status (light tints so the numbers stay readable). */
const TINT: Record<string, string> = {
  'stock-out': 'bg-error/25',
  critical: 'bg-[#f6c3a8]',
  low: 'bg-warning/20',
  healthy: 'bg-success/15',
  excess: 'bg-info/15',
  'no-sales': 'bg-base-200',
  inactive: 'bg-base-200 text-muted',
};
const BADGE: Record<string, string> = {
  'stock-out': 'badge-error',
  critical: 'badge-warning',
  low: 'badge-warning',
  healthy: 'badge-success',
  excess: 'badge-info',
  'no-sales': 'badge-ghost',
  inactive: 'badge-ghost',
};
const doc = (v: number | null) => (v == null ? '—' : v >= 999 ? '999+' : v.toFixed(1));

const stockOf = (r: { sellable: number; warehouse: number; darkstore: number }, basis: Basis) =>
  basis === 'warehouse' ? r.warehouse : basis === 'darkstore' ? r.darkstore : r.sellable;
const soldOf = (r: { sold7d: number; sold15d: number }, win: Win) => (win === '15d' ? r.sold15d : r.sold7d);
const drrOf = (r: { sold7d: number; sold15d: number }, win: Win) =>
  Math.max(0, soldOf(r, win)) / WIN_DAYS[win];

/** DOC status for any stock base / run-rate window (generalises the shared docStatus, which is fixed to sellable × L7D). */
function docStatusFrom(
  stock: number,
  drr: number,
  soldWindow: number,
  sold30d: number,
  bands: DocBands
): DocStatus {
  if (stock <= 0) return sold30d > 0 || soldWindow > 0 ? 'stock-out' : 'inactive';
  if (drr <= 0) return 'no-sales';
  const d = stock / drr;
  if (d < bands.critical) return 'critical';
  if (d < bands.low) return 'low';
  if (d > bands.excess) return 'excess';
  return 'healthy';
}

interface Derived {
  stock: number;
  drr: number;
  doc: number | null;
  docInc: number | null;
  status: DocStatus;
}
/** Per row DOC on the selected stock base and sales window. */
function derive(r: BkInventoryRow, win: Win, basis: Basis, bands: DocBands): Derived {
  const stock = stockOf(r, basis);
  const drr = drrOf(r, win);
  return {
    stock,
    drr,
    doc: daysOfCover(stock, drr),
    docInc: daysOfCover(stock + r.incoming, drr),
    status: docStatusFrom(stock, drr, soldOf(r, win), r.sold30d, bands),
  };
}

/** Aggregate a set of item × feeder rows, then DOC on the selected base / window from the summed stock and run rate. */
function rollup(rows: BkInventoryRow[], bands: DocBands, win: Win, basis: Basis) {
  const s = rows.reduce(
    (a, r) => ({
      sellable: a.sellable + r.sellable,
      warehouse: a.warehouse + r.warehouse,
      darkstore: a.darkstore + r.darkstore,
      inBetween: a.inBetween + r.inBetween,
      incoming: a.incoming + r.incoming,
      s7: a.s7 + r.sold7d,
      s15: a.s15 + r.sold15d,
      s30: a.s30 + r.sold30d,
    }),
    { sellable: 0, warehouse: 0, darkstore: 0, inBetween: 0, incoming: 0, s7: 0, s15: 0, s30: 0 }
  );
  const soldWin = win === '15d' ? s.s15 : s.s7;
  const drr = Math.max(0, soldWin) / WIN_DAYS[win];
  const stock = basis === 'warehouse' ? s.warehouse : basis === 'darkstore' ? s.darkstore : s.sellable;
  return {
    ...s,
    soldWin,
    drr,
    stock,
    doc: daysOfCover(stock, drr),
    docInc: daysOfCover(stock + s.incoming, drr),
    status: docStatusFrom(stock, drr, soldWin, s.s30, bands),
  };
}

/**
 * Inventory · Days of Cover per item × feeder warehouse, from the daily
 * Blinkit Inventory export (one snapshot per day).
 *   Run rate = Last-7-day (or Last-15-day) units ÷ window, per feeder, from the report itself
 *   DOC      = Stock (Sellable / Warehouse / Darkstore) ÷ run rate  (+ incoming in the second variant)
 * The snapshot, DOC window and stock base are all selectable, so status is
 * read for the chosen date and basis.
 */
export function InventoryView({ profileId, category }: { profileId: string; category: string }) {
  const [snapshot, setSnapshot] = useState('');
  const [view, setView] = useState<View>('matrix');
  const [cell, setCell] = useState<Cell>('doc');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState('');
  const [win, setWin] = useState<Win>('7d');
  const [basis, setBasis] = useState<Basis>('sellable');
  const { data, error, loading } = useLoad(
    () =>
      Promise.all([
        bkInventory(profileId, { snapshot, category }),
        bkInventoryTrend(profileId, { category }),
      ]) as Promise<[BkInventoryResponse, BkInventoryTrendResponse]>,
    [profileId, snapshot, category]
  );
  const [inv, trend] = data ?? [null, null];
  const bands = inv?.bands ?? { critical: 7, low: 15, excess: 45 };
  // Rows filtered by feeder city, then by the status recomputed for the selected window / base.
  const rows = useMemo(
    () =>
      (inv?.rows ?? []).filter(
        (r) => (!city || r.feederCity === city) && (!status || derive(r, win, basis, bands).status === status)
      ),
    [inv, city, status, win, basis, bands]
  );

  if (error) return <ErrorBox message={error} />;
  if (!inv)
    return loading ? (
      <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />
    ) : null;
  if (!inv.snapshot)
    return (
      <div className="rounded-box border border-line bg-surface px-4 py-6 text-sm text-muted shadow-sm">
        No inventory snapshot yet — add the daily Blinkit Inventory export (InventoryData – &lt;date&gt;.xlsx)
        to the brand&apos;s blinkit/inventory/ folder and sync.
      </div>
    );

  const all = rollup(rows, bands, win, basis);
  const counts = Object.fromEntries(
    ORDER.map((s) => [s, rows.filter((r) => derive(r, win, basis, bands).status === s).length])
  ) as Record<DocStatus, number>;
  const vol = new Map<string, number>();
  for (const r of rows) vol.set(r.facility, (vol.get(r.facility) ?? 0) + r.sold30d + r.sellable / 1000);
  const feeders = [...vol.entries()]
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([f]) => f);
  const bySku = new Map<string, BkInventoryRow[]>();
  for (const r of rows) bySku.set(r.itemId, [...(bySku.get(r.itemId) ?? []), r]);
  const skus = [...bySku.entries()]
    .map(([itemId, list]) => ({
      itemId,
      sku: list[0]!.sku,
      name: list[0]!.itemName,
      category: list[0]!.category,
      list,
      agg: rollup(list, bands, win, basis),
    }))
    .sort((a, b) => b.agg.soldWin - a.agg.soldWin || b.agg.stock - a.agg.stock);
  const cellText = (v: { stock: number; drr: number; doc: number | null; docInc: number | null }) =>
    cell === 'doc'
      ? doc(v.doc)
      : cell === 'docInc'
        ? doc(v.docInc)
        : cell === 'stock'
          ? fmtInt(v.stock)
          : v.drr.toFixed(1);
  const short = (f: string) => f.replace(/\s*-\s*Feeder( Warehouse)?/i, '').replace(/ Feeder$/i, '');
  const winLabel = win === '15d' ? 'L15D' : 'L7D';
  const basisLabel = BASIS_LABEL[basis];

  const stat = (k: string, v: string, d: string) => (
    <div className="stat px-4 py-3">
      <div className="stat-title text-xs">{k}</div>
      <div className="stat-value num text-xl">{v}</div>
      <div className="stat-desc">{d}</div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select
          label="Snapshot"
          value={snapshot || inv.snapshot}
          onChange={setSnapshot}
          allLabel={null}
          options={inv.snapshots.map((s, i) => ({
            value: s,
            label: `${fmtDateLong(s)}${i === 0 ? ' (latest)' : ''}`,
          }))}
        />
        <Select
          label="DOC window"
          value={win}
          onChange={(v) => setWin(v as Win)}
          allLabel={null}
          options={[
            { value: '7d', label: 'Last 7 days' },
            { value: '15d', label: 'Last 15 days' },
          ]}
        />
        <Select
          label="DOC basis"
          value={basis}
          onChange={(v) => setBasis(v as Basis)}
          allLabel={null}
          options={[
            { value: 'sellable', label: 'Sellable' },
            { value: 'warehouse', label: 'Warehouse' },
            { value: 'darkstore', label: 'Darkstore' },
          ]}
        />
        <Select
          label="Feeder city"
          value={city}
          onChange={setCity}
          options={[...new Set(inv.rows.map((r) => r.feederCity))].sort()}
        />
        <Select
          label="Status"
          value={status}
          onChange={setStatus}
          options={ORDER.map((s) => ({ value: s, label: DOC_STATUS_LABEL[s] }))}
        />
        <div className="join">
          {(
            [
              ['matrix', 'SKU × Feeder'],
              ['sku', 'By SKU'],
              ['detail', 'Detail'],
            ] as const
          ).map(([k, l]) => (
            <button
              key={k}
              onClick={() => setView(k)}
              className={`btn btn-sm join-item ${view === k ? 'btn-primary' : 'font-normal'}`}
            >
              {l}
            </button>
          ))}
        </div>
        {view !== 'detail' && (
          <Select
            label="Show"
            value={cell}
            onChange={(v) => setCell(v as Cell)}
            allLabel={null}
            options={[
              { value: 'doc', label: 'Days of cover' },
              { value: 'docInc', label: 'DOC incl. incoming' },
              { value: 'stock', label: `${basisLabel} units` },
              { value: 'drr', label: 'Run rate (units/day)' },
            ]}
          />
        )}
        {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
      </div>

      <div className="stats stats-vertical w-full border border-line bg-base-100 shadow-sm lg:stats-horizontal">
        {stat(
          'Sellable units',
          fmtInt(all.sellable),
          `${fmtInt(all.darkstore)} darkstore · ${fmtInt(all.warehouse)} warehouse · ${fmtInt(all.inBetween)} in-transit`
        )}
        {stat('Incoming', fmtInt(all.incoming), 'scheduled inventory')}
        {stat(
          `Units sold ${winLabel}`,
          fmtInt(all.soldWin),
          `L7D ${fmtInt(all.s7)} · L30D ${fmtInt(all.s30)}`
        )}
        {stat(`Run rate (${winLabel})`, all.drr.toFixed(1), 'units / day')}
        {stat(`DOC · ${basisLabel}`, doc(all.doc), `incl. incoming ${doc(all.docInc)}`)}
        {stat(
          'Stock-out / critical',
          `${counts['stock-out']} / ${counts.critical}`,
          `${counts.low} low · ${counts.excess} excess (SKU × feeder)`
        )}
      </div>

      {view === 'matrix' && (
        <div className="max-h-[70vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
          <table className="table table-sm">
            <thead className="sticky top-0 z-20 bg-base-200 shadow-[0_1px_0_var(--color-line)]">
              <tr className="text-xs text-muted">
                <th className={TH_LEFT}>SKU</th>
                <th className={`${TH} text-center`}>All feeders</th>
                {feeders.map((f) => (
                  <th key={f} className={`${TH} text-center`} title={f}>
                    {short(f)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => (
                <tr key={s.itemId} className="border-b border-line/60">
                  <td className={`${TD_LEFT} bg-surface`} title={`${s.name} · Item ${s.itemId}`}>
                    {s.sku}
                    <div className="text-[11px] text-muted">{s.category}</div>
                  </td>
                  <td
                    className={`num px-3 py-1.5 text-center font-semibold ${TINT[s.agg.status]}`}
                    title={`${DOC_STATUS_LABEL[s.agg.status]} · ${winLabel} ${fmtInt(s.agg.soldWin)}`}
                  >
                    {cellText(s.agg)}
                  </td>
                  {feeders.map((f) => {
                    const r = s.list.find((x) => x.facility === f);
                    if (!r)
                      return (
                        <td key={f} className="text-center text-muted/50">
                          ·
                        </td>
                      );
                    const dv = derive(r, win, basis, bands);
                    return (
                      <td
                        key={f}
                        className={`num px-3 py-1.5 text-center ${TINT[dv.status] ?? ''}`}
                        title={`${s.sku} @ ${f}\n${basisLabel} ${fmtInt(dv.stock)} · incoming ${fmtInt(r.incoming)}\n${winLabel} ${fmtInt(soldOf(r, win))} → ${dv.drr.toFixed(2)}/day\nDOC ${doc(dv.doc)} d · incl. incoming ${doc(dv.docInc)} d\n${DOC_STATUS_LABEL[dv.status]}`}
                      >
                        {cellText(dv)}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {view === 'sku' && (
        <div className="max-h-[70vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
          <table className="table table-sm">
            <thead className="sticky top-0 z-20 bg-base-200 shadow-[0_1px_0_var(--color-line)]">
              <tr className="text-xs text-muted">
                <th className={TH_LEFT}>SKU</th>
                <th className="px-3 py-2 text-left font-medium">Category</th>
                {[
                  'Sellable',
                  'Darkstore',
                  'Warehouse',
                  'In-transit',
                  'Incoming',
                  `${winLabel} units`,
                  'L30D units',
                  'Run rate',
                  `DOC · ${basisLabel}`,
                  'DOC + incoming',
                ].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
                <th className="px-3 py-2 text-left font-medium">Status</th>
                <th className="px-3 py-2 text-left font-medium">Feeders at risk</th>
              </tr>
            </thead>
            <tbody>
              {skus.map((s) => {
                const risk = s.list
                  .map((r) => ({ r, d: derive(r, win, basis, bands) }))
                  .filter(
                    (x) => x.d.status === 'stock-out' || x.d.status === 'critical' || x.d.status === 'low'
                  );
                return (
                  <tr key={s.itemId} className={ROW}>
                    <td className={TD_LEFT} title={s.name}>
                      {s.sku}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted">{s.category}</td>
                    {[
                      s.agg.sellable,
                      s.agg.darkstore,
                      s.agg.warehouse,
                      s.agg.inBetween,
                      s.agg.incoming,
                      s.agg.soldWin,
                      s.agg.s30,
                    ].map((v, i) => (
                      <td key={i} className="num px-3 py-1.5 text-right">
                        {fmtInt(v)}
                      </td>
                    ))}
                    <td className="num px-3 py-1.5 text-right">{s.agg.drr.toFixed(1)}</td>
                    <td className="num px-3 py-1.5 text-right font-semibold">{doc(s.agg.doc)}</td>
                    <td className="num px-3 py-1.5 text-right">{doc(s.agg.docInc)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`badge badge-sm badge-soft ${BADGE[s.agg.status]}`}>
                        {DOC_STATUS_LABEL[s.agg.status]}
                      </span>
                    </td>
                    <td
                      className="max-w-72 truncate px-3 py-1.5 text-xs"
                      title={risk
                        .map((x) => `${x.r.facility}: ${DOC_STATUS_LABEL[x.d.status]} (${doc(x.d.doc)} d)`)
                        .join('\n')}
                    >
                      {risk.length ? `${risk.length}: ${risk.map((x) => x.r.feederCity).join(', ')}` : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {view === 'detail' && (
        <div className="max-h-[70vh] overflow-auto rounded-box border border-line bg-surface shadow-sm">
          <table className="table table-sm">
            <thead className="sticky top-0 z-20 bg-base-200 shadow-[0_1px_0_var(--color-line)]">
              <tr className="text-xs text-muted">
                <th className={TH_LEFT}>SKU</th>
                <th className="px-3 py-2 text-left font-medium">Feeder</th>
                <th className="px-3 py-2 text-left font-medium">City</th>
                {[
                  'Sellable',
                  'Darkstore',
                  'Warehouse',
                  'In-transit',
                  'Incoming',
                  'L7D',
                  'L15D',
                  'L30D',
                  `DRR ${winLabel}`,
                  `DOC · ${basisLabel}`,
                  'DOC + inc',
                  'Near expiry',
                ].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .map((r) => ({ r, d: derive(r, win, basis, bands) }))
                .sort(
                  (a, b) =>
                    ORDER.indexOf(a.d.status) - ORDER.indexOf(b.d.status) ||
                    (a.d.doc ?? 1e9) - (b.d.doc ?? 1e9)
                )
                .map(({ r, d }) => (
                  <tr key={r.itemId + r.facilityId} className={ROW}>
                    <td className={TD_LEFT} title={r.itemName}>
                      {r.sku}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">{r.facility}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted">{r.feederCity}</td>
                    {[
                      r.sellable,
                      r.darkstore,
                      r.warehouse,
                      r.inBetween,
                      r.incoming,
                      r.sold7d,
                      r.sold15d,
                      r.sold30d,
                    ].map((v, i) => (
                      <td key={i} className="num px-3 py-1.5 text-right">
                        {fmtInt(v)}
                      </td>
                    ))}
                    <td className="num px-3 py-1.5 text-right">{d.drr.toFixed(2)}</td>
                    <td className="num px-3 py-1.5 text-right font-semibold">{doc(d.doc)}</td>
                    <td className="num px-3 py-1.5 text-right">{doc(d.docInc)}</td>
                    <td className="num px-3 py-1.5 text-right">{fmtInt(r.nearExpiry)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`badge badge-sm badge-soft ${BADGE[d.status]}`}>
                        {DOC_STATUS_LABEL[d.status]}
                      </span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {trend && trend.points.length > 1 && (
        <Card title="Days of cover across snapshots">
          <Columns
            items={trend.points.map((p) => ({ label: p.snapshot.slice(5), value: p.doc ?? 0 }))}
            fmt={(v) => (v == null ? '—' : `${v.toFixed(1)} d`)}
          />
        </Card>
      )}

      <div className="flex flex-wrap gap-2 text-[11px]">
        {ORDER.slice(0, 6).map((s) => (
          <span key={s} className={`rounded px-2 py-0.5 ${TINT[s]}`}>
            {DOC_STATUS_LABEL[s]}
            {s === 'critical'
              ? ` < ${bands.critical} d`
              : s === 'low'
                ? ` < ${bands.low} d`
                : s === 'excess'
                  ? ` > ${bands.excess} d`
                  : ''}
          </span>
        ))}
      </div>
      <Notes
        notes={[
          `Run rate = units sold in the DOC window (${winLabel}) ÷ ${WIN_DAYS[win]}, per feeder, from the Inventory report’s own “Last 7 days” / “Last 15 days” column.`,
          `Days of cover = ${basisLabel} stock ÷ run rate; “incl. incoming” adds Incoming scheduled inventory. Switch the DOC basis to Warehouse or Darkstore, or the window to L15D, to read cover on a different footing. Stock with no sales in the window has no DOC.`,
          `Bands: critical < ${bands.critical} d, low < ${bands.low} d, excess > ${bands.excess} d (BK_DOC_BANDS). Status is read for the chosen snapshot date, basis and window. Every daily export is kept as its own snapshot.`,
        ]}
      />
    </div>
  );
}
