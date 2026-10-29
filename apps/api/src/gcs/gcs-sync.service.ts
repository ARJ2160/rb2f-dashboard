import type {
  FileUploadResult,
  GcsBrand,
  GcsBrandsResponse,
  GcsFileEntry,
  GcsFileResult,
  GcsSyncJob,
} from '@dash/shared';
import { and, eq, sql } from 'drizzle-orm';

import { env } from '../config/env';
import { db } from '../db/client';
import { gcsObjects } from '../db/schema';
import { markDimsStale, rebuildCampaignDims } from '../reports/dims';
import { ingestBlinkitFile } from '../blinkit/ingestion/ingest';
import { GcsClient, GcsError, type GcsObject } from './gcs-client';
import { ingestWarehouseFile } from './warehouse-ingest';
import {
  brandFoldersFromPrefixes,
  ingestableObjects,
  blinkitSyncOrder,
  marketplacePrefix,
  relativeName,
  syncOrder,
  type BrandFolder,
  type Marketplace,
} from './paths';

/**
 * GCS warehouse → dashboard sync.
 *
 * For a brand, every .csv/.xlsx under `<brand>/<marketplace>/` is downloaded
 * and run through the SAME pipeline as a manual upload (detect → parse →
 * replace-by-date store) into the brand's own profile `gcs_<brand>`. Objects
 * whose GCS generation hasn't changed since the last sync are skipped.
 *
 * Two marketplaces share this flow:
 *   amazon  → `<brand>/amazon/`  (GCS_MARKETPLACE_FOLDER) → Amazon tables / reports
 *   blinkit → `<brand>/blinkit/` (GCS_BLINKIT_FOLDER)     → bk_* tables / Blinkit reports
 * Both keep their ledger rows in gcs_objects (object names include the folder).
 *
 * The bucket is only ever read.
 */

let client: GcsClient | null = null;

/** Bucket folder (under each brand) for a marketplace. */
export const marketplaceFolder = (m: Marketplace) => (m === 'blinkit' ? env.GCS_BLINKIT_FOLDER : env.GCS_MARKETPLACE_FOLDER);

export function gcsConfigError(): string | null {
  if (!env.gcsCredentialsFile) {
    return 'GCS is not configured: set GCS_CREDENTIALS_FILE in apps/api/.env to the path of a service-account JSON key, then restart the API.';
  }
  return null;
}

function gcs(): GcsClient {
  const err = gcsConfigError();
  if (err) throw new GcsError(err);
  client ??= GcsClient.fromKeyFile(env.GCS_BUCKET, env.gcsCredentialsFile!);
  return client;
}

// ── Brand folders (cached briefly — the UI polls while a sync runs) ──

let brandCache: { at: number; brands: BrandFolder[] } | null = null;

export async function listBrandFolders(refresh = false): Promise<BrandFolder[]> {
  if (!refresh && brandCache && Date.now() - brandCache.at < 60_000) return brandCache.brands;
  const brands = brandFoldersFromPrefixes(await gcs().listPrefixes(''));
  brandCache = { at: Date.now(), brands };
  return brands;
}

async function findBrand(brand: string): Promise<BrandFolder> {
  const hit =
    (await listBrandFolders()).find((b) => b.brand === brand) ??
    (await listBrandFolders(true)).find((b) => b.brand === brand);
  if (!hit) throw new GcsError(`No brand folder "${brand}" in gs://${env.GCS_BUCKET}.`, 404);
  return hit;
}

// ── Jobs (in memory; the ledger table is the durable record) ──

const jobs = new Map<string, GcsSyncJob>();
const jobKey = (m: Marketplace, brand: string) => `${m}:${brand}`;

export async function getBrands(refresh = false, marketplace: Marketplace = 'amazon'): Promise<GcsBrandsResponse> {
  const mFolder = marketplaceFolder(marketplace);
  const base = { bucket: env.GCS_BUCKET, marketplace: mFolder };
  const cfgErr = gcsConfigError();
  if (cfgErr) return { ...base, configured: false, brands: [], error: cfgErr };

  let folders: BrandFolder[];
  try {
    folders = await listBrandFolders(refresh);
  } catch (err) {
    return { ...base, configured: true, brands: [], error: (err as Error).message };
  }

  const stats = await db
    .select({
      profileId: gcsObjects.profileId,
      lastSyncedAt: sql<string | null>`max(${gcsObjects.syncedAt})`,
      files: sql<number>`count(*)::int`,
    })
    .from(gcsObjects)
    // object names are `<brand folder>/<marketplace folder>/…` — count only this marketplace
    .where(sql`split_part(${gcsObjects.objectName}, '/', 2) = ${mFolder}`)
    .groupBy(gcsObjects.profileId);
  const byProfile = new Map(stats.map((s) => [s.profileId, s]));

  const brands: GcsBrand[] = folders.map((f) => {
    const s = byProfile.get(f.profileId);
    return {
      ...f,
      lastSyncedAt: s?.lastSyncedAt ? new Date(s.lastSyncedAt).toISOString() : null,
      filesSynced: s?.files ?? 0,
      job: jobs.get(jobKey(marketplace, f.brand)) ?? null,
    };
  });
  return { ...base, configured: true, brands };
}

/** Start a sync in the background; returns the running job (an already-running one is returned as-is). */
export async function startSync(brand: string, force = false, marketplace: Marketplace = 'amazon'): Promise<GcsSyncJob> {
  const running = jobs.get(jobKey(marketplace, brand));
  if (running?.state === 'running') return running;
  const folder = await findBrand(brand);
  const job = newJob(folder, force, marketplace);
  jobs.set(jobKey(marketplace, brand), job);
  void runSync(job, folder, marketplace).catch((err) => finishWithError(job, err));
  return job;
}

/** Sync every brand and marketplace, one after another (used by the optional interval). */
export async function syncAllBrands(): Promise<void> {
  for (const marketplace of ['amazon', 'blinkit'] as const) {
    for (const folder of await listBrandFolders(true)) {
      if (jobs.get(jobKey(marketplace, folder.brand))?.state === 'running') continue;
      const job = newJob(folder, false, marketplace);
      jobs.set(jobKey(marketplace, folder.brand), job);
      await runSync(job, folder, marketplace).catch((err) => finishWithError(job, err));
    }
  }
}

function newJob(folder: BrandFolder, force: boolean, marketplace: Marketplace): GcsSyncJob {
  return {
    brand: folder.brand,
    marketplace,
    profileId: folder.profileId,
    state: 'running',
    force,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    filesTotal: 0,
    filesDone: 0,
    current: null,
    stored: 0,
    skipped: 0,
    unchanged: 0,
    failed: 0,
    message: null,
    results: [],
  };
}

function finishWithError(job: GcsSyncJob, err: unknown) {
  console.error(`[gcs] ${job.marketplace ?? 'amazon'} sync of ${job.brand} failed`, err);
  job.state = 'error';
  job.message = err instanceof Error ? err.message : String(err);
  job.current = null;
  job.finishedAt = new Date().toISOString();
}

async function runSync(job: GcsSyncJob, folder: BrandFolder, marketplace: Marketplace = 'amazon'): Promise<void> {
  const prefix = marketplacePrefix(folder.folder, marketplaceFolder(marketplace));
  const listed = ingestableObjects(await gcs().listObjects(prefix), prefix);
  const objects = marketplace === 'blinkit' ? blinkitSyncOrder(listed, prefix) : syncOrder(listed, prefix);
  job.filesTotal = objects.length;
  if (objects.length === 0) {
    job.message = `No .csv / .xlsx files under gs://${env.GCS_BUCKET}/${prefix}`;
  }

  const ledger = new Map(
    (await db.select().from(gcsObjects).where(eq(gcsObjects.profileId, folder.profileId))).map((r) => [
      r.objectName,
      r,
    ])
  );
  const maxBytes = env.GCS_MAX_FILE_MB * 1024 * 1024;
  let anyStored = false;

  for (const obj of objects) {
    const file = relativeName(obj.name, prefix);
    job.current = file;
    const prev = ledger.get(obj.name);
    let result: GcsFileResult;

    // Only files that were stored are skipped when unchanged — skipped / failed ones are retried, so a
    // parser improvement picks them up on the next normal sync.
    if (!job.force && prev && prev.generation === obj.generation && prev.status === 'stored') {
      result = {
        file,
        status: 'unchanged',
        reportTypes: prev.reportTypes?.split(',').filter(Boolean) ?? [],
        rowsStored: prev.rowsStored,
      };
    } else if (obj.size > maxBytes) {
      result = {
        file,
        status: 'skipped',
        reportTypes: [],
        rowsStored: 0,
        message: `Larger than GCS_MAX_FILE_MB (${env.GCS_MAX_FILE_MB} MB).`,
      };
      await record(folder.profileId, obj, result);
    } else {
      result = await ingestObject(folder.profileId, obj, file, marketplace);
      await record(folder.profileId, obj, result);
      if (result.status === 'stored') anyStored = true;
    }

    job.results.push(result);
    job.filesDone++;
    if (result.status === 'stored') job.stored++;
    else if (result.status === 'unchanged') job.unchanged++;
    else if (result.status === 'error') job.failed++;
    else job.skipped++;
  }

  job.current = null;
  // Campaign filters / Branded-Competitor-Generic classes — rebuilt once per sync, like an upload batch.
  // (Blinkit's mapper-derived dimensions are refreshed by its own ingest.)
  if (anyStored && marketplace === 'amazon') {
    markDimsStale(folder.profileId);
    try {
      await rebuildCampaignDims(folder.profileId);
    } catch (err) {
      console.error('[gcs] campaign dims rebuild failed', err);
      job.message = `Data stored, but rebuilding campaign filters failed: ${(err as Error).message}. Reports will retry automatically.`;
    }
  }
  job.state = 'done';
  job.finishedAt = new Date().toISOString();
}

async function ingestObject(profileId: string, obj: GcsObject, file: string, marketplace: Marketplace): Promise<GcsFileResult> {
  let buffer: Buffer;
  try {
    buffer = await gcs().download(obj.name, obj.generation);
  } catch (err) {
    return {
      file,
      status: 'error',
      reportTypes: [],
      rowsStored: 0,
      message: `Download failed: ${(err as Error).message}`,
    };
  }
  const sheets = marketplace === 'blinkit' ? await ingestBlinkitFile(profileId, file, buffer) : await ingestWarehouseFile(profileId, file, buffer);
  return summarize(file, sheets);
}

/** Per-sheet results (Amazon FileUploadResult or the Blinkit equivalent) → one result per object. */
type SheetResult = Omit<FileUploadResult, 'reportType'> & { reportType?: string | undefined };
export function summarize(file: string, sheets: SheetResult[]): GcsFileResult {
  const stored = sheets.filter((s) => s.status === 'stored');
  const status = sheets.some((s) => s.status === 'error') ? 'error' : stored.length ? 'stored' : 'skipped';
  const froms = stored
    .map((s) => s.from)
    .filter((d): d is string => !!d)
    .sort();
  const tos = stored
    .map((s) => s.to)
    .filter((d): d is string => !!d)
    .sort();
  const messages = sheets.flatMap((s) => [s.message, ...(s.warnings ?? [])]).filter((m): m is string => !!m);
  return {
    file,
    status,
    reportTypes: [...new Set(sheets.map((s) => s.reportType).filter((t): t is NonNullable<typeof t> => !!t))],
    rowsStored: stored.reduce((n, s) => n + (s.rowsStored ?? 0), 0),
    ...(froms.length ? { from: froms[0]! } : {}),
    ...(tos.length ? { to: tos[tos.length - 1]! } : {}),
    ...(messages.length ? { message: [...new Set(messages)].join(' | ') } : {}),
  };
}

async function record(profileId: string, obj: GcsObject, r: GcsFileResult): Promise<void> {
  const values = {
    generation: obj.generation,
    size: obj.size,
    objectUpdated: obj.updated ? new Date(obj.updated) : null,
    status: r.status,
    reportTypes: r.reportTypes.join(',') || null,
    rowsStored: r.rowsStored,
    dateFrom: r.from ?? null,
    dateTo: r.to ?? null,
    message: r.message ?? null,
    syncedAt: new Date(),
  };
  try {
    await db
      .insert(gcsObjects)
      .values({ profileId, objectName: obj.name, ...values })
      .onConflictDoUpdate({ target: [gcsObjects.profileId, gcsObjects.objectName], set: values });
  } catch (err) {
    console.error('[gcs] failed to record object', obj.name, err);
  }
}

/** Ledger rows for a brand (what was synced, when, and how it went). */
export async function listSyncedFiles(brand: string, marketplace: Marketplace = 'amazon'): Promise<GcsFileEntry[]> {
  const folder = await findBrand(brand);
  const prefix = marketplacePrefix(folder.folder, marketplaceFolder(marketplace));
  const rows = await db
    .select()
    .from(gcsObjects)
    .where(and(eq(gcsObjects.profileId, folder.profileId), sql`starts_with(${gcsObjects.objectName}, ${prefix})`))
    .orderBy(gcsObjects.objectName);
  return rows.map((r) => ({
    file: r.objectName.startsWith(prefix) ? relativeName(r.objectName, prefix) : r.objectName,
    objectName: r.objectName,
    generation: r.generation,
    size: r.size,
    updated: r.objectUpdated?.toISOString() ?? null,
    status: r.status,
    reportTypes: r.reportTypes?.split(',').filter(Boolean) ?? [],
    rowsStored: r.rowsStored,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    message: r.message,
    syncedAt: r.syncedAt.toISOString(),
  }));
}

/** Optional background re-sync (GCS_SYNC_INTERVAL_MIN > 0). */
export function startAutoSync(): (() => void) | null {
  const minutes = env.GCS_SYNC_INTERVAL_MIN;
  if (!minutes || gcsConfigError()) return null;
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      await syncAllBrands();
    } catch (err) {
      console.error('[gcs] scheduled sync failed', err);
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(tick, minutes * 60_000);
  timer.unref();
  console.log(`[gcs] auto-sync every ${minutes} min from gs://${env.GCS_BUCKET}`);
  void tick();
  return () => clearInterval(timer);
}
