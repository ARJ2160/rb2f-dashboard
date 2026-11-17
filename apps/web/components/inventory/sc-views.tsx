'use client';

import type {
  HealthCell,
  ScAllResponse,
  ScHealth,
  ScShipmentRow,
  ScSkuRow,
  ScSkuWarehouseRow,
  ScWarehouseRow,
} from '@dash/shared';
import { useEffect, useMemo, useState } from 'react';

import { ErrorBox } from '@/components/notes';
import { DASH, fmtDateLong, fmtInt } from '@/lib/format';
import { getScAll } from '@/lib/ops-sc-api';
import { AsinCell, ProfileProvider } from '@/components/product-hover';

export type InventorySub = 'overview' | 'shipments' | 'skus' | 'warehouses' | 'skuFc' | 'trend';

const pct = (v: number | null | undefined) => (v == null ? DASH : `${Math.round(v * 10) / 10}%`);
const num = (v: number | null | undefined) => (v == null ? DASH : fmtInt(Math.round(v)));
const dec1 = (v: number | null | undefined) => (v == null ? DASH : (Math.round(v * 10) / 10).toString());

const HEALTH_LABEL: Record<ScHealth, string> = { not_working: 'Not working', needs_attention: 'Needs attention', working: 'Working' };
const healthPill = (h: ScHealth) =>
  h === 'not_working' ? 'badge-error' : h === 'needs_attention' ? 'badge-warning' : 'badge-success';
function HealthPill({ h }: { h: HealthCell }) {
  return <span className={`badge badge-sm badge-soft ${healthPill(h.status)}`}>{HEALTH_LABEL[h.status]}</span>;
}

/** Fetch every Seller Central view once for a profile. */
export function useScData(profileId: string) {
  const [data, setData] = useState<ScAllResponse | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    if (!profileId) {
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    getScAll(profileId)
      .then((d) => alive && (setData(d), setError('')))
      .catch((e: Error) => alive && setError(e.message))
      .finally(() => alive && setLoading(false));
    return () => {
      alive = false;
    };
  }, [profileId]);
  return { data, error, loading };
}

/** The inventory (Seller Central) reports for one brand/profile, one sub-view at a time. */
export function InventorySection({ profileId, sub }: { profileId: string; sub: InventorySub }) {
  const { data, error, loading } = useScData(profileId);
  if (loading) return <p className="text-sm text-muted">Loading inventory…</p>;
  if (error) return <ErrorBox message={error} />;
  if (!data || data.summary.numLedgerDates === 0)
    return (
      <div className="rounded-xl border border-line bg-side px-5 py-6 text-sm text-muted">
        No Seller Central inventory data for this brand yet. Upload an Inventory Ledger (Summary), FBA Inventory or Shipments file — it’s detected automatically and appears here.
      </div>
    );
  const view =
    sub === 'overview' ? <Overview data={data} /> :
    sub === 'trend' ? <Trend data={data} /> :
    sub === 'shipments' ? <ShipmentTable rows={data.shipments} /> :
    sub === 'skus' ? <SkuTable rows={data.skus} /> :
    sub === 'warehouses' ? <WarehouseTable rows={data.warehouses} /> :
    <SkuFcTable rows={data.skuWarehouse} />;
  return <ProfileProvider profileId={profileId}>{view}</ProfileProvider>;
}

// ── Health chips + table frame ──────────────────────────────────────────────

function useHealthFilter<T extends { health: HealthCell }>(rows: T[]) {
  const [chip, setChip] = useState<'all' | ScHealth>('all');
  const counts = useMemo(() => {
    const c = { all: rows.length, not_working: 0, needs_attention: 0, working: 0 };
    for (const r of rows) c[r.health.status] += 1;
    return c;
  }, [rows]);
  const shown = chip === 'all' ? rows : rows.filter((r) => r.health.status === chip);
  return { chip, setChip, counts, shown };
}

function Chips({ counts, chip, setChip }: { counts: Record<string, number>; chip: string; setChip: (c: 'all' | ScHealth) => void }) {
  const items: Array<{ k: 'all' | ScHealth; label: string }> = [
    { k: 'all', label: 'All' },
    { k: 'not_working', label: 'Not working' },
    { k: 'needs_attention', label: 'Needs attention' },
    { k: 'working', label: 'Working' },
  ];
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((it) => (
        <button key={it.k} onClick={() => setChip(it.k)} className={`rounded-full px-3 py-1 text-xs transition-colors ${chip === it.k ? 'bg-brand text-white' : 'border border-line text-muted hover:border-brand hover:text-brand'}`}>
          {it.label} · {counts[it.k] ?? 0}
        </button>
      ))}
    </div>
  );
}

interface Col<T> {
  label: string;
  right?: boolean;
  render: (r: T) => React.ReactNode;
}
function DataTable<T extends { health: HealthCell }>({
  rows,
  cols,
  subtitle,
  asinOf,
}: {
  rows: T[];
  cols: Col<T>[];
  subtitle: string;
  /** When set, shows an ASIN search box that filters rows by this accessor. */
  asinOf?: (r: T) => string | null | undefined;
}) {
  const { chip, setChip, counts, shown } = useHealthFilter(rows);
  const [asinQuery, setAsinQuery] = useState('');
  const q = asinQuery.trim().toUpperCase();
  const filtered = asinOf && q ? shown.filter((r) => (asinOf(r) ?? '').toUpperCase().includes(q)) : shown;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Chips counts={counts} chip={chip} setChip={setChip} />
        {asinOf && (
          <input
            type="search"
            value={asinQuery}
            onChange={(e) => setAsinQuery(e.target.value)}
            placeholder="Filter by ASIN…"
            className="input input-sm input-bordered w-44 font-mono text-xs"
            aria-label="Filter by ASIN"
          />
        )}
      </div>
      <p className="text-xs text-muted">Showing {filtered.length} rows · worst first · {subtitle}</p>
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="table table-xs">
          <thead>
            <tr className="bg-side text-[11px] uppercase text-muted shadow-[0_1px_0_var(--color-line)]">
              <th>Health</th>
              {cols.map((c) => (
                <th key={c.label} className={c.right ? 'text-right' : ''}>{c.label}</th>
              ))}
              <th>Reasons</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={i} className="align-top border-b border-line/60 odd:bg-surface even:bg-stripe">
                <td><HealthPill h={r.health} /></td>
                {cols.map((c) => (
                  <td key={c.label} className={`${c.right ? 'num text-right' : ''} text-[13px]`}>{c.render(r)}</td>
                ))}
                <td className="text-[12px] text-muted">{r.health.reasons.join('; ') || DASH}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const SkuTable = ({ rows }: { rows: ScSkuRow[] }) => (
  <DataTable rows={rows} subtitle="days on hand = sellable ÷ in-stock demand rate" asinOf={(r) => r.asin} cols={[
    { label: 'ASIN', render: (r) => <AsinCell asin={r.asin} /> },
    { label: 'Product', render: (r) => <span className="line-clamp-1 max-w-56">{r.product}</span> },
    { label: 'Category', render: (r) => (r.category ? <span className={r.category === 'Unmapped' ? 'text-warn' : ''}>{r.category}</span> : DASH) },
    { label: 'Sellable', right: true, render: (r) => num(r.sellable) },
    { label: 'Unsellable', right: true, render: (r) => num(r.unsellable) },
    { label: 'Sold 30d', right: true, render: (r) => num(r.sold30) },
    { label: 'DRR', right: true, render: (r) => dec1(r.drrInStock) },
    { label: 'Days OH', right: true, render: (r) => num(r.daysOnHand) },
    { label: 'Cover +in', right: true, render: (r) => num(r.daysOfCoverInclInbound) },
    { label: 'Inbound', right: true, render: (r) => num(r.inbound) },
    { label: 'Return %', right: true, render: (r) => pct(r.returnRatePct) },
    { label: 'Flag', render: (r) => r.stockFlag },
  ]} />
);

const WarehouseTable = ({ rows }: { rows: ScWarehouseRow[] }) => (
  <DataTable rows={rows} subtitle="fill rate = units located ÷ units expected (closed shipments)" cols={[
    { label: 'FC', render: (r) => <span className="font-mono">{r.fc}</span> },
    { label: 'City', render: (r) => r.city ?? DASH },
    { label: 'Sellable', right: true, render: (r) => num(r.sellable) },
    { label: 'SKUs in', right: true, render: (r) => num(r.skusInStock) },
    { label: 'SKUs out', right: true, render: (r) => num(r.skusStockedOut) },
    { label: 'Sold 30d', right: true, render: (r) => num(r.sold30) },
    { label: 'Share', right: true, render: (r) => pct(r.shareOfNationalPct) },
    { label: 'Days OH', right: true, render: (r) => num(r.daysOnHand) },
    { label: 'Expected', right: true, render: (r) => num(r.unitsExpected) },
    { label: 'Located', right: true, render: (r) => num(r.unitsLocated) },
    { label: 'Short', right: true, render: (r) => num(r.unitsShort) },
    { label: 'Inbound', right: true, render: (r) => num(r.inbound) },
    { label: 'Fill %', right: true, render: (r) => pct(r.fillRateClosedPct) },
  ]} />
);

const ShipmentTable = ({ rows }: { rows: ScShipmentRow[] }) => (
  <DataTable rows={rows} subtitle="fill rate = units located ÷ units expected" cols={[
    { label: 'Shipment', render: (r) => <span className="font-mono">{r.shipmentId}</span> },
    { label: 'Status', render: (r) => r.status },
    { label: 'Created', render: (r) => (r.created ? fmtDateLong(r.created) : DASH) },
    { label: 'Dest', render: (r) => <span className="font-mono">{r.destFc}</span> },
    { label: 'Expected', right: true, render: (r) => num(r.unitsExpected) },
    { label: 'Located', right: true, render: (r) => num(r.unitsLocated) },
    { label: 'Short', right: true, render: (r) => num(r.shortfall) },
    { label: 'Fill %', right: true, render: (r) => pct(r.fillRatePct) },
    { label: 'Age (d)', right: true, render: (r) => num(r.daysSinceCreated) },
    { label: 'Flag', render: (r) => r.shipmentFlag },
  ]} />
);

const SkuFcTable = ({ rows }: { rows: ScSkuWarehouseRow[] }) => (
  <DataTable rows={rows} subtitle="one row per SKU × fulfilment centre" asinOf={(r) => r.asin} cols={[
    { label: 'ASIN', render: (r) => <AsinCell asin={r.asin} /> },
    { label: 'Category', render: (r) => (r.category ? <span className={r.category === 'Unmapped' ? 'text-warn' : ''}>{r.category}</span> : DASH) },
    { label: 'FC', render: (r) => <span className="font-mono">{r.fc}</span> },
    { label: 'Sellable', right: true, render: (r) => num(r.sellable) },
    { label: 'Sold 30d', right: true, render: (r) => num(r.sold30) },
    { label: 'In-stock d', right: true, render: (r) => num(r.inStockDays) },
    { label: 'DRR', right: true, render: (r) => dec1(r.drrInStock) },
    { label: 'Days OH', right: true, render: (r) => num(r.daysOnHand) },
    { label: 'Share', right: true, render: (r) => pct(r.shareOfSkuNationalPct) },
    { label: 'Flag', render: (r) => r.flag },
  ]} />
);

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl border border-line bg-surface p-3">
      <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
      <p className="num text-xl font-semibold">{value}</p>
      {sub && <p className="text-[11px] text-muted">{sub}</p>}
    </div>
  );
}

function Overview({ data }: { data: ScAllResponse }) {
  const s = data.summary;
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label="Sellable" value={num(s.sellable)} sub={`${s.skusInStock} SKUs · ${s.fcsHoldingStock} FCs`} />
        <Tile label="Unsellable" value={num(s.unsellable)} />
        <Tile label="Units sold 7d / 30d" value={`${num(s.sold7)} / ${num(s.sold30)}`} />
        <Tile label="National DRR" value={dec1(s.nationalDrr)} sub={`days on hand ${num(s.daysOnHand)}`} />
        <Tile label="Inbound units" value={num(s.inboundUnits)} />
        <Tile label="Units short (closed)" value={num(s.unitsShortClosed)} />
        <Tile label="Flagged shipments" value={num(s.flaggedShipments)} />
        <Tile label="Receipts / Returns 30d" value={`${num(s.receipts30)} / ${num(s.returns30)}`} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border border-line bg-surface p-4">
          <h3 className="mb-2 text-sm font-semibold">SKU health</h3>
          <div className="flex gap-4 text-sm">
            <span><b>{s.health.not_working}</b> <span className="text-muted">not working</span></span>
            <span><b>{s.health.needs_attention}</b> <span className="text-muted">needs attention</span></span>
            <span><b>{s.health.working}</b> <span className="text-muted">working</span></span>
          </div>
          <h4 className="mb-1 mt-3 text-[11px] uppercase tracking-wide text-muted">SKUs by stock flag</h4>
          <div className="flex flex-wrap gap-2 text-xs">
            {Object.entries(s.skusByFlag).map(([f, n]) => (
              <span key={f} className="rounded border border-line bg-base-200 px-2 py-0.5">{f}: {n}</span>
            ))}
          </div>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4">
          <h3 className="mb-2 text-sm font-semibold">Shipments by status</h3>
          <table className="table table-xs">
            <thead><tr className="text-[11px] uppercase text-muted"><th>Status</th><th className="text-right">Count</th><th className="text-right">Expected</th><th className="text-right">Located</th></tr></thead>
            <tbody>
              {s.shipmentsByStatus.map((a) => (
                <tr key={a.status}><td>{a.status}</td><td className="num text-right">{a.count}</td><td className="num text-right">{num(a.unitsExpected)}</td><td className="num text-right">{num(a.unitsLocated)}</td></tr>
              ))}
              {s.shipmentsByStatus.length === 0 && <tr><td colSpan={4} className="text-muted">No shipments uploaded.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
      <div className="rounded-xl border border-line bg-surface p-4">
        <h3 className="mb-2 text-sm font-semibold">Unsellable by disposition</h3>
        <div className="flex flex-wrap gap-2 text-xs">
          {s.unsellableByType.map((u) => (
            <span key={u.disposition} className="rounded border border-line bg-base-200 px-2 py-0.5">{u.disposition}: {num(u.units)}</span>
          ))}
          {s.unsellableByType.length === 0 && <span className="text-muted">None.</span>}
        </div>
      </div>
    </div>
  );
}

function Trend({ data }: { data: ScAllResponse }) {
  const d = data.trend;
  const max = Math.max(1, ...d.daily.map((p) => p.sellable));
  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-line bg-surface p-4">
        <h3 className="mb-3 text-sm font-semibold">Sellable stock &amp; units sold — last {d.daily.length} ledger dates</h3>
        <div className="space-y-1">
          {d.daily.map((p) => (
            <div key={p.date} className="flex items-center gap-2 text-xs">
              <span className="w-20 shrink-0 text-muted">{fmtDateLong(p.date)}</span>
              <div className="h-3 flex-1 rounded-full bg-base-200"><div className="h-3 rounded-full bg-brand" style={{ width: `${(p.sellable / max) * 100}%` }} /></div>
              <span className="num w-16 text-right">{num(p.sellable)}</span>
              <span className="num w-16 text-right text-muted">-{num(p.sold)}</span>
            </div>
          ))}
        </div>
      </div>
      <div className="rounded-xl border border-line bg-surface p-4">
        <h3 className="mb-2 text-sm font-semibold">Shipments created by week</h3>
        <table className="table table-xs">
          <thead><tr className="text-[11px] uppercase text-muted"><th>Week of</th><th className="text-right">Count</th><th className="text-right">Expected</th><th className="text-right">Located</th></tr></thead>
          <tbody>
            {d.weeklyShipments.map((w) => (
              <tr key={w.weekStart}><td>{fmtDateLong(w.weekStart)}</td><td className="num text-right">{w.count}</td><td className="num text-right">{num(w.unitsExpected)}</td><td className="num text-right">{num(w.unitsLocated)}</td></tr>
            ))}
            {d.weeklyShipments.length === 0 && <tr><td colSpan={4} className="text-muted">No shipments uploaded.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
