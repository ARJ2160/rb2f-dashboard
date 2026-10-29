'use client';

import type { GcsBrand, GcsBrandsResponse, GcsFileEntry, GcsFileResult } from '@dash/shared';
import { REPORT_TYPES } from '@dash/shared';
import { BK_REPORT_LABEL } from '@dash/shared/blinkit';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ErrorBox } from '@/components/notes';
import { BlinkitDashboard } from '@/components/blinkit/blinkit-dashboard';
import { ReportsDashboard } from '@/components/reports-dashboard';
import { Select } from '@/components/views/shared';
import { getGcsBrands, getGcsFiles, startGcsSync, type Marketplace } from '@/lib/api';
import { fmtDateLong } from '@/lib/format';

const BRAND_KEY = 'dash.gcsBrand';
const MARKETPLACE_KEY = 'dash.gcsMarketplace';

const MARKETPLACES: Array<{ id: Marketplace; label: string }> = [
  { id: 'amazon', label: 'Amazon' },
  { id: 'blinkit', label: 'Blinkit' },
];

const STATUS_STYLE: Record<string, string> = {
  stored: 'badge-success',
  unchanged: 'badge-primary',
  skipped: 'badge-ghost',
  error: 'badge-error',
};

const reportLabel = (t: string) =>
  REPORT_TYPES[t as keyof typeof REPORT_TYPES]?.label ?? BK_REPORT_LABEL[t as keyof typeof BK_REPORT_LABEL] ?? t;

function fmtWhen(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Milliseconds until an ISO time (0 when it has passed or is unset). */
function msUntil(iso: string | null | undefined, now: number): number {
  return iso ? Math.max(0, Date.parse(iso) - now) : 0;
}

function fmtWait(ms: number): string {
  const s = Math.ceil(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

/** Current time, re-read every second while `active` (drives the cooldown countdowns). */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

function range(from?: string | null, to?: string | null) {
  if (!from) return '—';
  return `${fmtDateLong(from)}${to && to !== from ? ` – ${fmtDateLong(to)}` : ''}`;
}

/**
 * GCS warehouse view: brands come from the bucket's top-level folders. Pick a
 * marketplace — the brand's `amazon/` or `blinkit/` files are synced into its
 * `gcs_<brand>` profile and that marketplace's report tabs are shown below.
 * Nothing here writes to GCS.
 */
export default function GcsPage() {
  const [info, setInfo] = useState<GcsBrandsResponse | null>(null);
  const [brand, setBrandState] = useState<string>('');
  const [marketplace, setMarketplaceState] = useState<Marketplace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [showFiles, setShowFiles] = useState(false);
  /** A sync request is in flight — blocks double clicks. */
  const [requesting, setRequesting] = useState(false);
  const autoStarted = useRef(new Set<string>());
  const lastFinished = useRef<string | null | undefined>(undefined);

  // Remembered marketplace (Amazon unless Blinkit was picked last time).
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(MARKETPLACE_KEY);
    } catch {
      /* storage unavailable */
    }
    setMarketplaceState(saved === 'blinkit' ? 'blinkit' : 'amazon');
  }, []);

  const load = useCallback(
    async (refresh = false) => {
      if (!marketplace) return null;
      try {
        const r = await getGcsBrands(refresh, marketplace);
        setInfo(r);
        return r;
      } catch (e) {
        setError((e as Error).message);
        return null;
      }
    },
    [marketplace]
  );

  const setMarketplace = (m: Marketplace) => {
    if (m === marketplace) return;
    setInfo(null);
    setShowFiles(false);
    setError(null);
    lastFinished.current = undefined;
    setMarketplaceState(m);
    try {
      localStorage.setItem(MARKETPLACE_KEY, m);
    } catch {
      /* ignore */
    }
  };

  // First load (and on marketplace change): brand list + remembered brand.
  useEffect(() => {
    void load().then((r) => {
      if (!r) return;
      let saved = '';
      try {
        saved = localStorage.getItem(BRAND_KEY) ?? '';
      } catch {
        /* storage unavailable */
      }
      const pick = r.brands.find((b) => b.brand === saved)?.brand ?? r.brands[0]?.brand ?? '';
      setBrandState(pick);
    });
  }, [load]);

  const setBrand = (b: string) => {
    setBrandState(b);
    setShowFiles(false);
    try {
      localStorage.setItem(BRAND_KEY, b);
    } catch {
      /* ignore */
    }
  };

  const current: GcsBrand | undefined = info?.brands.find((b) => b.brand === brand);
  const job = current?.job ?? null;
  const running = job?.state === 'running';

  // Cooldowns from the API: after a sync, "Sync now" waits a couple of minutes and "Re-ingest all" longer.
  const now = useNow(Boolean(current?.syncAvailableAt || current?.reingestAvailableAt));
  const syncWait = msUntil(current?.syncAvailableAt, now);
  const reingestWait = msUntil(current?.reingestAvailableAt, now);
  const reingestEvery = info?.limits?.reingestCooldownMin;

  const sync = useCallback(
    async (force = false) => {
      if (!brand || requesting) return;
      if (
        force &&
        !window.confirm(
          `Re-ingest every ${marketplace === 'blinkit' ? 'Blinkit' : 'Amazon'} file for ${brand}?\n\n` +
            'This re-processes the whole folder and can take several minutes' +
            (reingestEvery ? `; it can run once every ${reingestEvery} minutes per brand.` : '.')
        )
      )
        return;
      setError(null);
      setRequesting(true);
      try {
        await startGcsSync(brand, force, marketplace ?? 'amazon');
      } catch (e) {
        setError((e as Error).message);
      } finally {
        await load();
        setRequesting(false);
      }
    },
    [brand, load, marketplace, requesting, reingestEvery]
  );

  // Poll while a sync runs…
  useEffect(() => {
    if (!running) return undefined;
    const t = setInterval(() => void load(), 1500);
    return () => clearInterval(t);
  }, [running, load]);

  // …and remount the reports whenever a sync finishes, so they show the new data.
  const finishedAt = job?.finishedAt ?? null;
  useEffect(() => {
    if (lastFinished.current !== undefined && finishedAt && finishedAt !== lastFinished.current)
      setVersion((v) => v + 1);
    lastFinished.current = finishedAt;
  }, [finishedAt]);

  // A brand that has never been synced is pulled automatically on first open (per marketplace).
  useEffect(() => {
    const key = `${marketplace}:${current?.brand}`;
    if (!current || current.job || current.filesSynced > 0 || autoStarted.current.has(key)) return;
    autoStarted.current.add(key);
    void sync(false);
  }, [current, sync, marketplace]);

  if (info && !info.configured) {
    return (
      <div className="max-w-2xl space-y-3 rounded-box border border-line bg-surface shadow-sm px-5 py-4 text-sm">
        <h1 className="text-base font-semibold">Connect the GCS warehouse</h1>
        <p className="text-muted">{info.error}</p>
        <ol className="list-decimal space-y-1 pl-5 text-muted">
          <li>
            Create (or reuse) a service account with the <b className="text-ink">Storage Object Viewer</b>{' '}
            role on <code className="font-mono text-xs">gs://{info.bucket}</code>.
          </li>
          <li>
            Download a JSON key for it and save it next to the API, e.g.{' '}
            <code className="font-mono text-xs">apps/api/gcs-service-account.json</code>.
          </li>
          <li>
            Add <code className="font-mono text-xs">GCS_CREDENTIALS_FILE=./gcs-service-account.json</code> to{' '}
            <code className="font-mono text-xs">apps/api/.env</code> and restart the API.
          </li>
        </ol>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <section className="space-y-3 rounded-box border border-line bg-surface shadow-sm px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="mr-auto">
            <h1 className="text-base font-semibold tracking-tight">GCS warehouse</h1>
            <p className="font-mono text-xs text-muted">
              gs://{info?.bucket ?? '…'}/{current?.folder ?? '<brand>'}/{info?.marketplace ?? 'amazon'}/ ·
              read-only
            </p>
          </div>

          <div className="join" role="radiogroup" aria-label="Marketplace">
            {MARKETPLACES.map((m) => (
              <button
                key={m.id}
                role="radio"
                aria-checked={marketplace === m.id}
                onClick={() => setMarketplace(m.id)}
                className={`btn btn-sm join-item ${marketplace === m.id ? 'btn-primary' : 'font-normal'}`}
                title={`Sync and view each brand's ${m.id}/ folder`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {info && info.brands.length > 0 && (
            <Select
              label="Brand"
              value={brand}
              onChange={setBrand}
              allLabel={null}
              options={info.brands.map((b) => ({ value: b.brand, label: b.brand }))}
            />
          )}
          <button
            onClick={() => void load(true)}
            className="btn btn-ghost btn-xs font-normal text-muted"
            title="Re-read the brand folders from the bucket"
          >
            Refresh brands
          </button>

          {current && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void sync(false)}
                disabled={running || requesting || syncWait > 0}
                className="btn btn-sm btn-neutral"
                title={syncWait > 0 ? 'Just synced — available again shortly' : 'Pull new or changed files from GCS'}
              >
                {running ? 'Syncing…' : syncWait > 0 ? `Sync again in ${fmtWait(syncWait)}` : 'Sync now'}
              </button>
              <button
                onClick={() => void sync(true)}
                disabled={running || requesting || reingestWait > 0}
                className="btn btn-sm btn-outline border-line font-normal"
                title={
                  reingestWait > 0
                    ? `Re-ingest is available again in ${fmtWait(reingestWait)}`
                    : "Re-ingest every file, even ones that haven't changed"
                }
              >
                {reingestWait > 0 ? `Re-ingest in ${fmtWait(reingestWait)}` : 'Re-ingest all'}
              </button>
            </div>
          )}
        </div>

        {current && <SyncStatus brand={current} />}
        {info?.error && <ErrorBox message={info.error} />}
        {error && <ErrorBox message={error} />}

        {current && (current.filesSynced > 0 || job) && (
          <button onClick={() => setShowFiles(!showFiles)} className="btn btn-link btn-xs self-start px-0">
            {showFiles ? 'Hide files' : `Show files (${current.filesSynced || job?.filesTotal || 0})`}
          </button>
        )}
        {current && showFiles && (
          <FilesTable
            brand={current.brand}
            version={version}
            marketplace={marketplace ?? 'amazon'}
            job={job?.state === 'done' ? job.results : null}
          />
        )}
      </section>

      {info && info.brands.length === 0 && !info.error && (
        <div className="rounded-box border border-line bg-surface shadow-sm px-4 py-6 text-sm text-muted">
          No brand folders found in gs://{info.bucket}.
        </div>
      )}

      {current && marketplace === 'blinkit' && (
        <BlinkitDashboard
          key={`bk:${current.profileId}:${version}`}
          profileId={current.profileId}
          title={current.brand}
          subtitle={`Blinkit data from GCS · last synced ${fmtWhen(current.lastSyncedAt)}`}
          emptyState={
            running ? (
              <>Pulling {current.brand}&apos;s Blinkit files from GCS — the reports appear as soon as the sync finishes.</>
            ) : (
              <>
                No Blinkit data synced for {current.brand} yet — expected under{' '}
                <code className="font-mono text-xs">
                  gs://{info?.bucket}/{current.folder}/{info?.marketplace}/
                </code>{' '}
                (ads_sales/…, total_sales, sku_mapper, campaign_mapper, inventory).{' '}
                <button onClick={() => void sync(false)} className="font-medium text-accent underline">
                  Sync now
                </button>
              </>
            )
          }
        />
      )}

      {current && marketplace === 'amazon' && (
        <ReportsDashboard
          key={`${current.profileId}:${version}`}
          profileId={current.profileId}
          title={current.brand}
          subtitle={`Amazon data from GCS · last synced ${fmtWhen(current.lastSyncedAt)}`}
          emptyState={
            running ? (
              <>
                Pulling {current.brand}&apos;s Amazon files from GCS — the reports appear as soon as the sync
                finishes.
              </>
            ) : (
              <>
                No data synced for {current.brand} yet.{' '}
                <button onClick={() => void sync(false)} className="font-medium text-accent underline">
                  Sync now
                </button>{' '}
                to pull its Amazon files from GCS.
              </>
            )
          }
        />
      )}
    </div>
  );
}

function SyncStatus({ brand }: { brand: GcsBrand }) {
  const job = brand.job;
  if (!job) {
    return (
      <p className="text-xs text-muted">
        Last synced {fmtWhen(brand.lastSyncedAt)}
        {brand.filesSynced > 0 && ` · ${brand.filesSynced} file${brand.filesSynced === 1 ? '' : 's'}`}
      </p>
    );
  }
  if (job.state === 'running') {
    const pct = job.filesTotal ? Math.round((job.filesDone / job.filesTotal) * 100) : 0;
    return (
      <div className="space-y-1">
        <div className="h-1.5 overflow-hidden rounded bg-canvas">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${job.filesTotal ? pct : 5}%` }}
          />
        </div>
        <p className="text-xs text-muted">
          {job.filesTotal ? `${job.filesDone} / ${job.filesTotal} files` : 'Listing files…'}
          {job.current && <span className="font-mono"> · {job.current}</span>}
          {job.startedBy?.includes('@') && <> · started by {job.startedBy}</>}
        </p>
      </div>
    );
  }
  if (job.state === 'error') {
    return <ErrorBox message={`Sync failed: ${job.message ?? 'unknown error'}`} />;
  }
  return (
    <div className="space-y-1 text-xs">
      <p className="text-muted">
        Synced {fmtWhen(job.finishedAt)}
        {job.force && ' (re-ingested all)'} · {job.filesTotal} file{job.filesTotal === 1 ? '' : 's'}:{' '}
        <span className="text-good">{job.stored} stored</span> · {job.unchanged} unchanged · {job.skipped}{' '}
        skipped
        {job.failed > 0 && <span className="text-bad"> · {job.failed} failed</span>}
      </p>
      {job.message && <p className="text-warn">{job.message}</p>}
    </div>
  );
}

function FilesTable({
  brand,
  version,
  marketplace,
  job,
}: {
  brand: string;
  version: number;
  marketplace: Marketplace;
  job: GcsFileResult[] | null;
}) {
  const [rows, setRows] = useState<GcsFileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getGcsFiles(brand, marketplace)
      .then((r) => alive && setRows(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [brand, version, marketplace]);

  if (error) return <ErrorBox message={error} />;
  if (!rows) return <p className="text-xs text-muted">Loading…</p>;
  const lastRun = new Map((job ?? []).map((r) => [r.file, r.status]));

  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="table table-sm">
        <thead className="bg-base-200 text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">File</th>
            <th className="px-3 py-2 font-medium">Detected as</th>
            <th className="px-3 py-2 font-medium">Dates stored</th>
            <th className="px-3 py-2 text-right font-medium">Rows</th>
            <th className="px-3 py-2 font-medium">Updated in GCS</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r) => {
            const status = lastRun.get(r.file) === 'unchanged' ? 'unchanged' : r.status;
            return (
              <tr key={r.objectName} className="align-top hover:bg-base-200">
                <td className="px-3 py-2">
                  <div className="font-mono text-xs">{r.file}</div>
                  {r.message && <div className="mt-0.5 max-w-xl text-xs text-muted">{r.message}</div>}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">
                  {r.reportTypes.length ? r.reportTypes.map(reportLabel).join(', ') : '—'}
                </td>
                <td className="whitespace-nowrap px-3 py-2 text-xs">{range(r.dateFrom, r.dateTo)}</td>
                <td className="num px-3 py-2 text-right text-xs">{r.rowsStored || '—'}</td>
                <td className="whitespace-nowrap px-3 py-2 text-xs text-muted">{fmtWhen(r.updated)}</td>
                <td className="px-3 py-2">
                  <span className={`badge badge-sm badge-soft ${STATUS_STYLE[status] ?? ''}`}>
                    {status}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
