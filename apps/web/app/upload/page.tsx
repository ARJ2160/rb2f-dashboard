'use client';

import type { FileUploadResult, UploadLogEntry } from '@dash/shared';
import { REPORT_TYPES } from '@dash/shared';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ErrorBox } from '@/components/notes';
import { getUploads, uploadFiles } from '@/lib/api';
import { fmtDateLong } from '@/lib/format';
import { useProfile } from '@/lib/profile';

const ACCEPT = '.xlsx,.xls,.csv';
const IN_SCOPE = Object.values(REPORT_TYPES)
  .filter((t) => t.inScope)
  .map((t) => t.label);

const STATUS_STYLE: Record<string, string> = {
  stored: 'badge-success',
  skipped: 'badge-ghost',
  error: 'badge-error',
};

export default function UploadPage() {
  const { profileId } = useProfile();
  const [files, setFiles] = useState<File[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<FileUploadResult[] | null>(null);
  const [dimsError, setDimsError] = useState<string | null>(null);
  const [history, setHistory] = useState<UploadLogEntry[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refreshHistory = useCallback(() => {
    getUploads(profileId).then(setHistory).catch(() => setHistory([]));
  }, [profileId]);
  useEffect(refreshHistory, [refreshHistory]);

  const addFiles = (list: FileList | null) => {
    if (!list) return;
    const picked = [...list].filter((f) => /\.(xlsx|xls|csv)$/i.test(f.name));
    setFiles((prev) => {
      const names = new Set(prev.map((f) => f.name));
      return [...prev, ...picked.filter((f) => !names.has(f.name))];
    });
  };

  const submit = async () => {
    if (!files.length) return;
    setBusy(true);
    setError(null);
    setResults(null);
    try {
      const res = await uploadFiles(profileId, files);
      setResults(res.files);
      setDimsError(res.dimsError ?? null);
      setFiles([]);
      refreshHistory();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="space-y-4">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Upload raw reports</h1>
          <p className="mt-1 text-sm text-muted">
            Drop Amazon exports as-is (one report per file, or a workbook with one report per tab). Each sheet&apos;s report type
            is detected from its columns; dates come from the rows, or from the file name for single-day exports
            (e.g. <code className="font-mono text-xs">Business_Report_10_April.xlsx</code>). Re-uploading a date replaces it.
          </p>
          <p className="mt-2 text-xs text-muted">Ingested now: {IN_SCOPE.join(' · ')}</p>
        </div>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragging(false);
            addFiles(e.dataTransfer.files);
          }}
          onClick={() => inputRef.current?.click()}
          className={`cursor-pointer rounded-box border-2 border-dashed px-6 py-12 text-center transition-colors ${
            dragging ? 'border-accent bg-accent-soft' : 'border-line bg-surface hover:border-accent/50'
          }`}
        >
          <p className="text-sm font-medium">Drop .xlsx / .csv files here, or click to choose</p>
          <p className="mt-1 text-xs text-muted">Uploading to profile “{profileId}”</p>
          <input
            ref={inputRef}
            type="file"
            accept={ACCEPT}
            multiple
            hidden
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = '';
            }}
          />
        </div>

        {files.length > 0 && (
          <div className="rounded-box border border-line bg-surface shadow-sm">
            <ul className="divide-y divide-line text-sm">
              {files.map((f) => (
                <li key={f.name} className="flex items-center justify-between px-4 py-2">
                  <span className="truncate">{f.name}</span>
                  <span className="ml-4 flex items-center gap-3 text-xs text-muted">
                    {(f.size / 1024).toFixed(0)} KB
                    <button onClick={() => setFiles(files.filter((x) => x !== f))} className="btn btn-ghost btn-xs text-bad">
                      remove
                    </button>
                  </span>
                </li>
              ))}
            </ul>
            <div className="flex justify-end border-t border-line px-4 py-3">
              <button
                onClick={submit}
                disabled={busy}
                className="btn btn-neutral"
              >
                {busy ? 'Processing…' : `Upload ${files.length} file${files.length > 1 ? 's' : ''}`}
              </button>
            </div>
          </div>
        )}

        {error && <ErrorBox message={error} />}
        {dimsError && (
          <div role="alert" className="alert alert-error alert-soft block text-sm">
            Data was stored, but rebuilding the campaign filters / Branded-Competitor-Generic classes failed: {dimsError}. The reports will retry automatically; if this keeps happening, send me the API log.
          </div>
        )}
        {results && <ResultsTable results={results} />}
      </section>

      <aside className="space-y-2">
        <h2 className="text-sm font-semibold">Recent uploads</h2>
        {history.length === 0 ? (
          <p className="text-xs text-muted">Nothing uploaded for this profile yet.</p>
        ) : (
          <ul className="divide-y divide-line rounded-box border border-line bg-surface shadow-sm text-xs">
            {history.map((h) => (
              <li key={h.id} className="space-y-0.5 px-3 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium" title={h.filename}>
                    {h.filename}
                  </span>
                  <span className={`badge badge-sm badge-soft shrink-0 ${STATUS_STYLE[h.status] ?? ''}`}>{h.status}</span>
                </div>
                <div className="text-muted">
                  {h.reportType ? (REPORT_TYPES[h.reportType as keyof typeof REPORT_TYPES]?.label ?? h.reportType) : 'unknown'}
                  {h.dateFrom && ` · ${fmtDateLong(h.dateFrom)}${h.dateTo && h.dateTo !== h.dateFrom ? ` – ${fmtDateLong(h.dateTo)}` : ''}`}
                  {h.rowsStored > 0 && ` · ${h.rowsStored} rows`}
                </div>
              </li>
            ))}
          </ul>
        )}
      </aside>
    </div>
  );
}

function ResultsTable({ results }: { results: FileUploadResult[] }) {
  return (
    <div className="overflow-x-auto rounded-box border border-line bg-surface shadow-sm">
      <table className="table table-sm">
        <thead className="bg-base-200 text-left text-xs text-muted">
          <tr>
            <th className="px-3 py-2 font-medium">File / sheet</th>
            <th className="px-3 py-2 font-medium">Detected as</th>
            <th className="px-3 py-2 font-medium">Dates stored</th>
            <th className="px-3 py-2 text-right font-medium">Rows</th>
            <th className="px-3 py-2 font-medium">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {results.map((r, i) => (
            <tr key={`${r.filename}-${i}`} className="align-top hover:bg-base-200">
              <td className="px-3 py-2">
                <div className="font-medium">{r.filename}</div>
                {r.message && <div className="mt-0.5 text-xs text-muted">{r.message}</div>}
                {r.warnings?.map((w) => (
                  <div key={w} className="mt-0.5 text-xs text-warn">
                    ⚠ {w}
                  </div>
                ))}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                {r.reportType ? REPORT_TYPES[r.reportType].label : '—'}
                {r.detectedBy && <div className="text-muted">by {r.detectedBy}</div>}
              </td>
              <td className="whitespace-nowrap px-3 py-2 text-xs">
                {r.from ? `${fmtDateLong(r.from)}${r.to && r.to !== r.from ? ` – ${fmtDateLong(r.to)}` : ''}` : '—'}
              </td>
              <td className="num px-3 py-2 text-right text-xs">
                {r.status === 'stored' ? `${r.rowsStored ?? 0}/${r.rowsRead ?? 0}` : '—'}
              </td>
              <td className="px-3 py-2">
                <span className={`badge badge-sm badge-soft ${STATUS_STYLE[r.status] ?? ''}`}>{r.status}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
