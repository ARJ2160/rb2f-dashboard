'use client';

import type { GcsBrand, GcsBrandsResponse, GcsFileEntry, GcsFileResult } from '@dash/shared';
import { REPORT_TYPES } from '@dash/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ErrorBox } from '@/components/notes';
import { ReportsDashboard } from '@/components/reports-dashboard';
import { Select } from '@/components/views/shared';
import { getGcsBrands, getGcsFiles, startGcsSync } from '@/lib/api';
import { fmtDateLong } from '@/lib/format';

const BRAND_KEY = 'dash.gcsBrand';

const STATUS_STYLE: Record<string, string> = {
  stored: 'bg-good/10 text-good',
  unchanged: 'bg-accent-soft text-accent',
  skipped: 'bg-canvas text-muted',
  error: 'bg-bad/10 text-bad',
};

const reportLabel = (t: string) => REPORT_TYPES[t as keyof typeof REPORT_TYPES]?.label ?? t;

function fmtWhen(iso: string | null): string {
  if (!iso) return 'never';
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function range(from?: string | null, to?: string | null) {
  if (!from) return '—';
  return `${fmtDateLong(from)}${to && to !== from ? ` – ${fmtDateLong(to)}` : ''}`;
}

/**
 * GCS warehouse view: brands come from the bucket's top-level folders, their
 * `amazon/` files are synced into a separate `gcs_<brand>` profile, and the
 * normal report tabs are shown for that profile. Nothing here writes to GCS.
 */
export default function GcsPage() {
  const [info, setInfo] = useState<GcsBrandsResponse | null>(null);
  const [brand, setBrandState] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const [showFiles, setShowFiles] = useState(false);
  const autoStarted = useRef(new Set<string>());
  const lastFinished = useRef<string | null | undefined>(undefined);

  const load = useCallback(async (refresh = false) => {
    try {
      const r = await getGcsBrands(refresh);
      setInfo(r);
      return r;
    } catch (e) {
      setError((e as Error).message);
      return null;
    }
  }, []);

  // First load: brand list + remembered brand.
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

  const sync = useCallback(
    async (force = false) => {
      if (!brand) return;
      setError(null);
      try {
        await startGcsSync(brand, force);
        await load();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [brand, load]
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

  // A brand that has never been synced is pulled automatically on first open.
  useEffect(() => {
    if (!current || current.job || current.filesSynced > 0 || autoStarted.current.has(current.brand)) return;
    autoStarted.current.add(current.brand);
    void sync(false);
  }, [current, sync]);

  if (info && !info.configured) {
    return (
      <div className="max-w-2xl space-y-3 rounded-md border border-line bg-surface px-5 py-4 text-sm">
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
      <section className="space-y-3 rounded-md border border-line bg-surface px-4 py-3">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="mr-auto">
            <h1 className="text-base font-semibold tracking-tight">GCS warehouse</h1>
            <p className="font-mono text-xs text-muted">
              gs://{info?.bucket ?? '…'}/{current?.folder ?? '<brand>'}/{info?.marketplace ?? 'amazon'}/ ·
              read-only
            </p>
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
            className="text-xs text-muted underline hover:text-ink"
            title="Re-read the brand folders from the bucket"
          >
            Refresh brands
          </button>

          {current && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void sync(false)}
                disabled={running}
                className="h-8 rounded-md bg-ink px-3 text-sm font-medium text-white disabled:opacity-50"
                title="Pull new or changed files from GCS"
              >
                {running ? 'Syncing…' : 'Sync now'}
              </button>
              <button
                onClick={() => void sync(true)}
                disabled={running}
                className="h-8 rounded-md border border-line px-3 text-sm text-muted hover:text-ink disabled:opacity-50"
                title="Re-ingest every file, even ones that haven't changed"
              >
                Re-ingest all
              </button>
            </div>
          )}
        </div>

        {current && <SyncStatus brand={current} />}
        {info?.error && <ErrorBox message={info.error} />}
        {error && <ErrorBox message={error} />}

        {current && (current.filesSynced > 0 || job) && (
          <button onClick={() => setShowFiles(!showFiles)} className="text-xs font-medium text-accent">
            {showFiles ? 'Hide files' : `Show files (${current.filesSynced || job?.filesTotal || 0})`}
          </button>
        )}
        {current && showFiles && (
          <FilesTable
            brand={current.brand}
            version={version}
            job={job?.state === 'done' ? job.results : null}
          />
        )}
      </section>

      {info && info.brands.length === 0 && !info.error && (
        <div className="rounded-md border border-line bg-surface px-4 py-6 text-sm text-muted">
          No brand folders found in gs://{info.bucket}.
        </div>
      )}

      {current && (
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
  job,
}: {
  brand: string;
  version: number;
  job: GcsFileResult[] | null;
}) {
  const [rows, setRows] = useState<GcsFileEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    getGcsFiles(brand)
      .then((r) => alive && setRows(r))
      .catch((e: Error) => alive && setError(e.message));
    return () => {
      alive = false;
    };
  }, [brand, version]);

  if (error) return <ErrorBox message={error} />;
  if (!rows) return <p className="text-xs text-muted">Loading…</p>;
  const lastRun = new Map((job ?? []).map((r) => [r.file, r.status]));

  return (
    <div className="overflow-x-auto rounded-md border border-line">
      <table className="w-full text-sm">
        <thead className="border-b border-line text-left text-xs text-muted">
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
              <tr key={r.objectName} className="align-top">
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
                  <span className={`rounded px-1.5 py-0.5 text-xs ${STATUS_STYLE[status] ?? ''}`}>
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
