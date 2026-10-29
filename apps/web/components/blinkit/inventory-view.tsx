'use client';

import {
  DOC_STATUS_LABEL,
  daysOfCover,
  docStatus,
  runRate,
  type BkInventoryResponse,
  type BkInventoryRow,
  type BkInventoryTrendResponse,
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

type Cell = 'doc' | 'docInc' | 'sellable' | 'drr';
type View = 'matrix' | 'sku' | 'detail';
const ORDER: DocStatus[] = ['stock-out', 'critical', 'low', 'healthy', 'excess', 'no-sales', 'inactive'];

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

function rollup(rows: BkInventoryRow[], bands: BkInventoryResponse['bands']) {
  const s = rows.reduce(
    (a, r) => ({ sellable: a.sellable + r.sellable, incoming: a.incoming + r.incoming, s7: a.s7 + r.sold7d, s30: a.s30 + r.sold30d, darkstore: a.darkstore + r.darkstore, warehouse: a.warehouse + r.warehouse }),
    { sellable: 0, incoming: 0, s7: 0, s30: 0, darkstore: 0, warehouse: 0 }
  );
  const drr = runRate(s.s7);
  return { ...s, drr, doc: daysOfCover(s.sellable, drr), docInc: daysOfCover(s.sellable + s.incoming, drr), status: docStatus(s.sellable, s.s7, s.s30, bands) };
}

/**
 * Inventory · Days of Cover per item × feeder warehouse, from the daily
 * Blinkit Inventory export (one snapshot per day).
 *   Run rate = Last-7-days units ÷ 7 (per feeder, from the report itself)
 *   DOC      = Total sellable ÷ run rate  (+ incoming in the second variant)
 */
export function InventoryView({ profileId, category }: { profileId: string; category: string }) {
  const [snapshot, setSnapshot] = useState('');
  const [view, setView] = useState<View>('matrix');
  const [cell, setCell] = useState<Cell>('doc');
  const [city, setCity] = useState('');
  const [status, setStatus] = useState('');
  const { data, error, loading } = useLoad(
    () => Promise.all([bkInventory(profileId, { snapshot, category }), bkInventoryTrend(profileId, { category })]) as Promise<[BkInventoryResponse, BkInventoryTrendResponse]>,
    [profileId, snapshot, category]
  );
  const [inv, trend] = data ?? [null, null];
  const rows = useMemo(() => (inv?.rows ?? []).filter((r) => (!city || r.feederCity === city) && (!status || r.status === status)), [inv, city, status]);

  if (error) return <ErrorBox message={error} />;
  if (!inv) return loading ? <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" /> : null;
  if (!inv.snapshot)
    return (
      <div className="rounded-box border border-line bg-surface px-4 py-6 text-sm text-muted shadow-sm">
        No inventory snapshot yet — add the daily Blinkit Inventory export (InventoryData – &lt;date&gt;.xlsx) to the brand&apos;s blinkit/inventory/ folder and sync.
      </div>
    );

  const bands = inv.bands;
  const all = rollup(rows, bands);
  const counts = Object.fromEntries(ORDER.map((s) => [s, rows.filter((r) => r.status === s).length])) as Record<DocStatus, number>;
  const vol = new Map<string, number>();
  for (const r of rows) vol.set(r.facility, (vol.get(r.facility) ?? 0) + r.sold30d + r.sellable / 1000);
  const feeders = [...vol.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).map(([f]) => f);
  const bySku = new Map<string, BkInventoryRow[]>();
  for (const r of rows) bySku.set(r.itemId, [...(bySku.get(r.itemId) ?? []), r]);
  const skus = [...bySku.entries()]
    .map(([itemId, list]) => ({ itemId, sku: list[0]!.sku, name: list[0]!.itemName, category: list[0]!.category, list, agg: rollup(list, bands) }))
    .sort((a, b) => b.agg.s7 - a.agg.s7 || b.agg.sellable - a.agg.sellable);
  const cellText = (v: { sellable: number; drr: number; doc: number | null; docInc: number | null }) =>
    cell === 'doc' ? doc(v.doc) : cell === 'docInc' ? doc(v.docInc) : cell === 'sellable' ? fmtInt(v.sellable) : v.drr.toFixed(1);
  const short = (f: string) => f.replace(/\s*-\s*Feeder( Warehouse)?/i, '').replace(/ Feeder$/i, '');

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
          options={inv.snapshots.map((s, i) => ({ value: s, label: `${fmtDateLong(s)}${i === 0 ? ' (latest)' : ''}` }))}
        />
        <Select label="Feeder city" value={city} onChange={setCity} options={[...new Set(inv.rows.map((r) => r.feederCity))].sort()} />
        <Select label="Status" value={status} onChange={setStatus} options={ORDER.map((s) => ({ value: s, label: DOC_STATUS_LABEL[s] }))} />
        <div className="join">
          {(
            [
              ['matrix', 'SKU × Feeder'],
              ['sku', 'By SKU'],
              ['detail', 'Detail'],
            ] as const
          ).map(([k, l]) => (
            <button key={k} onClick={() => setView(k)} className={`btn btn-sm join-item ${view === k ? 'btn-primary' : 'font-normal'}`}>
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
              { value: 'sellable', label: 'Sellable units' },
              { value: 'drr', label: 'Run rate (units/day)' },
            ]}
          />
        )}
        {loading && <span className="loading loading-spinner loading-sm text-muted" aria-label="Loading" />}
      </div>

      <div className="stats stats-vertical w-full border border-line bg-base-100 shadow-sm lg:stats-horizontal">
        {stat('Sellable units', fmtInt(all.sellable), `${fmtInt(all.darkstore)} darkstore · ${fmtInt(all.warehouse)} warehouse`)}
        {stat('Incoming', fmtInt(all.incoming), 'scheduled inventory')}
        {stat('Units sold L7D', fmtInt(all.s7), `L30D ${fmtInt(all.s30)}`)}
        {stat('Run rate (L7D)', all.drr.toFixed(1), 'units / day')}
        {stat('Days of cover', doc(all.doc), `incl. incoming ${doc(all.docInc)}`)}
        {stat('Stock-out / critical', `${counts['stock-out']} / ${counts.critical}`, `${counts.low} low · ${counts.excess} excess (SKU × feeder)`)}
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
                  <td className={`num px-3 py-1.5 text-center font-semibold ${TINT[s.agg.status]}`} title={`${DOC_STATUS_LABEL[s.agg.status]} · L7D ${fmtInt(s.agg.s7)}`}>
                    {cellText(s.agg)}
                  </td>
                  {feeders.map((f) => {
                    const r = s.list.find((x) => x.facility === f);
                    if (!r) return <td key={f} className="text-center text-muted/50">·</td>;
                    return (
                      <td
                        key={f}
                        className={`num px-3 py-1.5 text-center ${TINT[r.status] ?? ''}`}
                        title={`${s.sku} @ ${f}\nSellable ${fmtInt(r.sellable)} · incoming ${fmtInt(r.incoming)}\nL7D ${fmtInt(r.sold7d)} → ${r.drr7.toFixed(2)}/day\nDOC ${doc(r.doc)} d · incl. incoming ${doc(r.docWithIncoming)} d\n${DOC_STATUS_LABEL[r.status as DocStatus]}`}
                      >
                        {cellText({ sellable: r.sellable, drr: r.drr7, doc: r.doc, docInc: r.docWithIncoming })}
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
                {['Sellable', 'Darkstore', 'Warehouse', 'Incoming', 'L7D units', 'L30D units', 'Run rate', 'DOC', 'DOC + incoming'].map((h) => (
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
                const risk = s.list.filter((r) => r.status === 'stock-out' || r.status === 'critical' || r.status === 'low');
                return (
                  <tr key={s.itemId} className={ROW}>
                    <td className={TD_LEFT} title={s.name}>
                      {s.sku}
                    </td>
                    <td className="px-3 py-1.5 text-xs text-muted">{s.category}</td>
                    {[s.agg.sellable, s.agg.darkstore, s.agg.warehouse, s.agg.incoming, s.agg.s7, s.agg.s30].map((v, i) => (
                      <td key={i} className="num px-3 py-1.5 text-right">
                        {fmtInt(v)}
                      </td>
                    ))}
                    <td className="num px-3 py-1.5 text-right">{s.agg.drr.toFixed(1)}</td>
                    <td className="num px-3 py-1.5 text-right font-semibold">{doc(s.agg.doc)}</td>
                    <td className="num px-3 py-1.5 text-right">{doc(s.agg.docInc)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`badge badge-sm badge-soft ${BADGE[s.agg.status]}`}>{DOC_STATUS_LABEL[s.agg.status]}</span>
                    </td>
                    <td className="max-w-72 truncate px-3 py-1.5 text-xs" title={risk.map((r) => `${r.facility}: ${DOC_STATUS_LABEL[r.status as DocStatus]} (${doc(r.doc)} d)`).join('\n')}>
                      {risk.length ? `${risk.length}: ${risk.map((r) => r.feederCity).join(', ')}` : '—'}
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
                {['Sellable', 'Darkstore', 'Warehouse', 'In-between', 'Incoming', 'L7D', 'L30D', 'DRR L7D', 'DRR L30D', 'DOC', 'DOC + inc', 'Near expiry'].map((h) => (
                  <th key={h} className={TH}>
                    {h}
                  </th>
                ))}
                <th className="px-3 py-2 text-left font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {[...rows]
                .sort((a, b) => ORDER.indexOf(a.status as DocStatus) - ORDER.indexOf(b.status as DocStatus) || (a.doc ?? 1e9) - (b.doc ?? 1e9))
                .map((r) => (
                  <tr key={r.itemId + r.facilityId} className={ROW}>
                    <td className={TD_LEFT} title={r.itemName}>
                      {r.sku}
                    </td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs">{r.facility}</td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-xs text-muted">{r.feederCity}</td>
                    {[r.sellable, r.darkstore, r.warehouse, r.inBetween, r.incoming, r.sold7d, r.sold30d].map((v, i) => (
                      <td key={i} className="num px-3 py-1.5 text-right">
                        {fmtInt(v)}
                      </td>
                    ))}
                    <td className="num px-3 py-1.5 text-right">{r.drr7.toFixed(2)}</td>
                    <td className="num px-3 py-1.5 text-right">{r.drr30.toFixed(2)}</td>
                    <td className="num px-3 py-1.5 text-right font-semibold">{doc(r.doc)}</td>
                    <td className="num px-3 py-1.5 text-right">{doc(r.docWithIncoming)}</td>
                    <td className="num px-3 py-1.5 text-right">{fmtInt(r.nearExpiry)}</td>
                    <td className="px-3 py-1.5">
                      <span className={`badge badge-sm badge-soft ${BADGE[r.status]}`}>{DOC_STATUS_LABEL[r.status as DocStatus]}</span>
                    </td>
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
      )}

      {trend && trend.points.length > 1 && (
        <Card title="Days of cover across snapshots">
          <Columns items={trend.points.map((p) => ({ label: p.snapshot.slice(5), value: p.doc ?? 0 }))} fmt={(v) => (v == null ? '—' : `${v.toFixed(1)} d`)} />
        </Card>
      )}

      <div className="flex flex-wrap gap-2 text-[11px]">
        {ORDER.slice(0, 6).map((s) => (
          <span key={s} className={`rounded px-2 py-0.5 ${TINT[s]}`}>
            {DOC_STATUS_LABEL[s]}
            {s === 'critical' ? ` < ${bands.critical} d` : s === 'low' ? ` < ${bands.low} d` : s === 'excess' ? ` > ${bands.excess} d` : ''}
          </span>
        ))}
      </div>
      <Notes
        notes={[
          'Run rate = units sold in the last 7 days ÷ 7, per feeder, from the Inventory report’s own “Last 7 days” column.',
          'Days of cover = Total sellable (warehouse + in-between + darkstore) ÷ run rate; “incl. incoming” adds Incoming scheduled inventory. Stock with no sales in 7 days has no DOC.',
          `Bands: critical < ${bands.critical} d, low < ${bands.low} d, excess > ${bands.excess} d (BK_DOC_BANDS). Every daily export is kept as its own snapshot.`,
        ]}
      />
    </div>
  );
}
