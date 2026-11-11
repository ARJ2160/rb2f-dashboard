'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  gcsDetect,
  gcsIngestBulk,
  getGcsBrands,
  getGcsReportTypes,
  type BulkIngestResponse,
  type FileAssignment,
  type Marketplace,
  type ReportType,
} from '@/lib/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

const today = () => isoDaysAgo(0);
const toYYYYMMDD = (iso: string) => iso.replace(/-/g, '');

/** Mirrors the server-side buildFilename logic. */
function previewFilename(brand: string, reportTypeId: string, startDate: string, endDate: string, originalName: string, suffix = ''): string {
  if (!brand || !reportTypeId || !startDate || !endDate) return '';
  const ext = originalName.includes('.') ? '.' + originalName.split('.').pop()!.toLowerCase() : '.csv';
  return `${brand}_${reportTypeId}_${toYYYYMMDD(startDate)}_${toYYYYMMDD(endDate)}${suffix}${ext}`;
}

interface FileRow {
  file: File;
  marketplace: Marketplace;
  reportType: string;               // coarse id, '' if unassigned
  detectedBy: 'headers' | 'filename' | null;
  fineType: string | null;
  note?: string;
  detecting: boolean;
}

// ── Page ─────────────────────────────────────────────────────────────────────

export default function IngestPage() {
  const [brands, setBrands]           = useState<string[]>([]);
  const [brand, setBrand]             = useState('');
  const [allTypes, setAllTypes]       = useState<ReportType[]>([]);
  const [startDate, setStartDate]     = useState(isoDaysAgo(14));
  const [endDate, setEndDate]         = useState(today());
  const [rows, setRows]               = useState<FileRow[]>([]);
  const [busy, setBusy]               = useState(false);
  const [error, setError]             = useState<string | null>(null);
  const [result, setResult]           = useState<BulkIngestResponse | null>(null);
  const [dragging, setDragging]       = useState(false);
  const inputRef                      = useRef<HTMLInputElement>(null);

  // Load brands + the full report-type catalogue once.
  useEffect(() => {
    getGcsBrands()
      .then((res) => setBrands((res.brands ?? []).map((b: { brand: string }) => b.brand)))
      .catch(() => setBrands([]));
    getGcsReportTypes()
      .then(setAllTypes)
      .catch(() => setAllTypes([]));
  }, []);

  const typesFor = useCallback(
    (m: Marketplace) => allTypes.filter((t) => t.marketplace === m),
    [allTypes]
  );

  // Add files → create rows immediately, then run auto-detect to fill them in.
  const addFiles = useCallback(async (list: FileList | null) => {
    if (!list) return;
    const picked = [...list].filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
    if (!picked.length) return;

    // Skip names already queued.
    const existing = new Set(rows.map((r) => r.file.name));
    const fresh = picked.filter((f) => !existing.has(f.name));
    if (!fresh.length) return;

    const newRows: FileRow[] = fresh.map((file) => ({
      file,
      marketplace: 'amazon',
      reportType: '',
      detectedBy: null,
      fineType: null,
      detecting: true,
    }));
    setRows((prev) => [...prev, ...newRows]);

    try {
      const { detections } = await gcsDetect(fresh);
      const byName = new Map(detections.map((d) => [d.filename, d]));
      setRows((prev) =>
        prev.map((r) => {
          if (!fresh.includes(r.file)) return r;
          const d = byName.get(r.file.name);
          if (!d) return { ...r, detecting: false };
          return {
            ...r,
            marketplace: 'amazon', // column detection is Amazon-based
            reportType: d.reportType ?? '',
            detectedBy: d.detectedBy,
            fineType: d.fineType,
            note: d.note,
            detecting: false,
          };
        })
      );
    } catch {
      setRows((prev) => prev.map((r) => (fresh.includes(r.file) ? { ...r, detecting: false } : r)));
    }
  }, [rows]);

  const updateRow = (name: string, patch: Partial<FileRow>) =>
    setRows((prev) => prev.map((r) => (r.file.name === name ? { ...r, ...patch } : r)));

  const removeRow = (name: string) => setRows((prev) => prev.filter((r) => r.file.name !== name));

  // Per-report-type suffixing for the live preview (mirrors the server).
  const previews = useMemo(() => {
    const counts = new Map<string, number>();
    for (const r of rows) if (r.reportType) counts.set(r.reportType, (counts.get(r.reportType) ?? 0) + 1);
    const seen = new Map<string, number>();
    return rows.map((r) => {
      if (!r.reportType) return '';
      const n = (seen.get(r.reportType) ?? 0) + 1;
      seen.set(r.reportType, n);
      const suffix = (counts.get(r.reportType) ?? 1) > 1 ? `_${n}` : '';
      return previewFilename(brand, r.reportType, startDate, endDate, r.file.name, suffix);
    });
  }, [rows, brand, startDate, endDate]);

  const unassigned = rows.filter((r) => !r.reportType).length;

  const submit = useCallback(async () => {
    if (!brand.trim())       { setError('Pick or enter a brand name.'); return; }
    if (!startDate)          { setError('Enter a start date.'); return; }
    if (!endDate)            { setError('Enter an end date.'); return; }
    if (endDate < startDate) { setError('End date must be on or after start date.'); return; }
    if (!rows.length)        { setError('Add at least one file.'); return; }
    if (unassigned > 0)      { setError(`${unassigned} file(s) have no report type — pick one for each.`); return; }

    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const assignments: FileAssignment[] = rows.map((r) => ({
        filename: r.file.name,
        marketplace: r.marketplace,
        reportType: r.reportType,
      }));
      const res = await gcsIngestBulk(brand.trim(), startDate, endDate, assignments, rows.map((r) => r.file));
      setResult(res);
      setRows([]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [brand, startDate, endDate, rows, unassigned]);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="text-lg font-semibold tracking-tight">Ingest to warehouse</h1>
        <p className="mt-1 text-sm text-muted">
          Drop all your report files at once — each one&apos;s type is detected from its columns. Files are renamed to the
          standard format and routed to the right folder before upload.
        </p>
      </div>

      {/* ── Brand ── */}
      <section className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wide text-muted">Account / brand</label>
        {brands.length > 0 ? (
          <select className="select select-bordered w-full" value={brand} onChange={(e) => setBrand(e.target.value)}>
            <option value="">— select brand —</option>
            {brands.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        ) : (
          <input
            type="text"
            className="input w-full"
            placeholder="e.g. eatopia"
            value={brand}
            onChange={(e) => setBrand(e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-'))}
          />
        )}
      </section>

      {/* ── Date range ── */}
      <section className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wide text-muted">Date range covered by these files</label>
        <div className="flex items-center gap-3">
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs text-muted">Start date</label>
            <input type="date" className="input w-full" value={startDate} max={endDate || today()} onChange={(e) => setStartDate(e.target.value)} />
          </div>
          <span className="mt-5 text-muted">→</span>
          <div className="flex flex-1 flex-col gap-1">
            <label className="text-xs text-muted">End date</label>
            <input type="date" className="input w-full" value={endDate} min={startDate} max={today()} onChange={(e) => setEndDate(e.target.value)} />
          </div>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted">
          <button type="button" className="underline hover:text-base-content" onClick={() => { setStartDate(isoDaysAgo(14)); setEndDate(today()); }}>
            Last 14 days
          </button>
          <button type="button" className="underline hover:text-base-content" onClick={() => { setStartDate(today()); setEndDate(today()); }}>
            Today only
          </button>
          <span>Default is the last 14 days (the Amazon attribution window).</span>
        </div>
      </section>

      {/* ── Dropzone ── */}
      <section className="space-y-2">
        <label className="text-xs font-medium uppercase tracking-wide text-muted">Files</label>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); addFiles(e.dataTransfer.files); }}
          onClick={() => inputRef.current?.click()}
          className={`flex min-h-[90px] cursor-pointer items-center justify-center rounded-lg border-2 border-dashed transition-colors ${
            dragging ? 'border-primary bg-primary/5' : 'border-line hover:border-primary/50'
          }`}
        >
          <span className="text-sm text-muted">
            Drop all your <span className="font-medium">.xlsx / .xls / .csv</span> reports here, or click to browse
          </span>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          multiple
          className="hidden"
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }}
        />
      </section>

      {/* ── Per-file assignment table ── */}
      {rows.length > 0 && (
        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium uppercase tracking-wide text-muted">
              {rows.length} file{rows.length > 1 ? 's' : ''}
              {unassigned > 0 && <span className="ml-2 text-warning">· {unassigned} need a type</span>}
            </label>
            <button type="button" className="text-xs text-muted underline hover:text-error" onClick={() => setRows([])}>
              Clear all
            </button>
          </div>

          <div className="space-y-2 rounded-lg border border-line p-2">
            {rows.map((r, i) => (
              <div
                key={r.file.name}
                className={`rounded-md border p-2.5 ${
                  r.reportType ? 'border-transparent bg-surface/50' : 'border-warning/40 bg-warning/5'
                }`}
              >
                {/* Line 1 â filename gets the full width */}
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-xs" title={r.file.name}>
                    {r.file.name}
                  </span>

                  {/* Detection badge */}
                  {r.detecting ? (
                    <span className="shrink-0 text-[10px] text-muted">detectingâ¦</span>
                  ) : r.detectedBy ? (
                    <span
                      className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                        r.detectedBy === 'headers' ? 'bg-success/15 text-success' : 'bg-primary/15 text-primary'
                      }`}
                      title={r.fineType ? `Detected as ${r.fineType} by ${r.detectedBy}` : undefined}
                    >
                      {r.detectedBy === 'headers' ? 'auto ✓' : 'by name'}
                    </span>
                  ) : (
                    <span className="shrink-0 rounded bg-warning/15 px-1.5 py-0.5 text-[10px] font-medium text-warning">
                      needs type
                    </span>
                  )}

                  <button
                    type="button"
                    onClick={() => removeRow(r.file.name)}
                    className="shrink-0 text-base leading-none text-muted hover:text-error"
                    aria-label="Remove file"
                  >
                    ×
                  </button>
                </div>

                {/* Line 2 â controls */}
                <div className="mt-2 flex items-center gap-2">
                  <select
                    className="select select-sm select-bordered shrink-0"
                    value={r.marketplace}
                    onChange={(e) => updateRow(r.file.name, { marketplace: e.target.value as Marketplace, reportType: '' })}
                  >
                    <option value="amazon">Amazon</option>
                    <option value="blinkit">Blinkit</option>
                  </select>

                  <select
                    className={`select select-sm select-bordered min-w-0 flex-1 ${!r.reportType ? 'border-warning text-warning' : ''}`}
                    value={r.reportType}
                    onChange={(e) => updateRow(r.file.name, { reportType: e.target.value, detectedBy: null })}
                  >
                    <option value="">{r.detecting ? 'detecting…' : '— pick report type —'}</option>
                    {typesFor(r.marketplace).map((t) => (
                      <option key={t.id} value={t.id}>{t.label}</option>
                    ))}
                  </select>
                </div>

                {/* Line 3 â preview / note */}
                {previews[i] ? (
                  <div className="mt-1.5 flex items-center gap-1.5">
                    <span className="text-xs text-muted">→</span>
                    <span className="truncate font-mono text-xs text-success">{previews[i]}</span>
                  </div>
                ) : r.note ? (
                  <p className="mt-1.5 text-xs text-warning">{r.note}</p>
                ) : !r.detecting ? (
                  <p className="mt-1.5 text-xs text-muted">Couldn&apos;t detect this report — pick its type above.</p>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Error ── */}
      {error && (
        <div className="rounded-lg border border-error/30 bg-error/10 px-4 py-3 text-sm text-error">{error}</div>
      )}

      {/* ── Submit ── */}
      <button
        type="button"
        onClick={submit}
        disabled={busy || !rows.length || !brand || unassigned > 0}
        className="btn btn-primary w-full"
      >
        {busy ? 'Uploading…' : `Upload ${rows.length ? `${rows.length} file${rows.length > 1 ? 's' : ''} ` : ''}to GCS`}
      </button>

      {/* ── Results ── */}
      {result && (
        <section className="space-y-3 rounded-lg border border-line p-4">
          <h2 className="text-sm font-semibold">Results</h2>
          <ul className="space-y-1">
            {result.files.map((f) => (
              <li key={f.objectName} className="flex items-start gap-2 text-sm">
                <span className={`mt-0.5 shrink-0 ${f.status === 'uploaded' ? 'text-success' : 'text-error'}`}>
                  {f.status === 'uploaded' ? '✓' : '✗'}
                </span>
                <span className="flex-1">
                  <span className="font-mono text-xs">{f.objectName}</span>
                  {f.message && <span className="ml-2 text-xs text-error">{f.message}</span>}
                </span>
              </li>
            ))}
          </ul>
          {result.sync.length > 0 ? (
            <p className="text-sm text-muted">
              Sync started ({result.sync.length} marketplace{result.sync.length > 1 ? 's' : ''}).{' '}
              <a href="/gcs" className="text-primary underline">View on GCS page →</a>
            </p>
          ) : result.files.some((f) => f.status === 'uploaded') ? (
            <p className="text-sm text-muted">
              Files uploaded.{' '}
              <a href="/gcs" className="text-primary underline">Go to GCS → Sync now</a>
            </p>
          ) : null}
        </section>
      )}
    </div>
  );
}
