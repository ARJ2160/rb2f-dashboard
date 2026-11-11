import { type Response, Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { env } from '../config/env';
import { HttpError } from '../middleware/error-handler';
import { requestUser } from '../middleware/rate-limit';
import { cleanFilename, looksLikeSpreadsheet } from '../lib/upload-files';
import { GcsError } from './gcs-client';
import { gcsConfigError, getBrands, listSyncedFiles, startSync, SyncRefusedError } from './gcs-sync.service';
import type { BulkIngestItem } from './gcs-ingest';
import {
  ALL_REPORT_TYPES,
  buildFilename,
  detectIngestType,
  findReportType,
  isValidDate,
  uploadBulkToGcs,
  uploadFilesToGcs,
} from './gcs-ingest';
import { MARKETPLACES } from './paths';

/**
 * Read-only GCS warehouse endpoints. Reports for a synced brand use the normal
 * /api/reports/* routes with `profileId=gcs_<brand>`.
 */
export const gcsRouter = Router();

const brandSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_-]{1,60}$/, 'brand: lower-case letters, digits, - and _ only');

/** `amazon` (default — existing behaviour) or `blinkit`. */
const marketplaceSchema = z.enum(MARKETPLACES).default('amazon');

/** Map GCS / config failures to clean HTTP errors. */
async function guard<T>(fn: () => Promise<T>, res?: Response): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SyncRefusedError) {
      res?.setHeader('Retry-After', String(Math.max(1, Math.ceil(err.retryAfterMs / 1000))));
      throw new HttpError(429, err.message);
    }
    if (err instanceof GcsError) {
      const status = err.status === 404 ? 404 : gcsConfigError() ? 503 : 502;
      throw new HttpError(status, err.message);
    }
    throw err;
  }
}

/** GET /api/gcs/brands?refresh=1&marketplace=amazon|blinkit — brand folders + last sync + running job. */
gcsRouter.get('/brands', async (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  const marketplace = marketplaceSchema.parse(req.query.marketplace || undefined);
  res.json(await getBrands(refresh, marketplace));
});

/** POST /api/gcs/sync  { brand, force?, marketplace? } — starts a background sync, returns the job. */
gcsRouter.post('/sync', async (req, res) => {
  const body = z
    .object({ brand: brandSchema, force: z.boolean().default(false), marketplace: marketplaceSchema })
    .parse(req.body ?? {});
  const job = await guard(() => startSync(body.brand, body.force, body.marketplace, requestUser(req)), res);
  res.status(202).json(job);
});

/** GET /api/gcs/files?brand=&marketplace= — every synced object and how it was ingested. */
gcsRouter.get('/files', async (req, res) => {
  const q = z.object({ brand: brandSchema, marketplace: marketplaceSchema }).parse(req.query);
  res.json(await guard(() => listSyncedFiles(q.brand, q.marketplace)));
});

// ── Multer for ingest uploads ──────────────────────────────────────────────────
const ingestUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.MAX_UPLOAD_MB * 1024 * 1024,
    files: env.MAX_UPLOAD_FILES,
    fields: 10,
    fieldSize: 4 * 1024,
    parts: env.MAX_UPLOAD_FILES + 10,
  },
  fileFilter: (_req, file, cb) => cb(null, /\.(xlsx|xls|csv)$/i.test(file.originalname)),
}).array('files', env.MAX_UPLOAD_FILES);

/**
 * GET /api/gcs/report-types?marketplace=amazon|blinkit
 * Returns the list of supported report types for the given marketplace.
 */
gcsRouter.get('/report-types', (req, res) => {
  const marketplace = z.enum(MARKETPLACES).optional().parse(req.query.marketplace || undefined);
  const types = marketplace ? ALL_REPORT_TYPES.filter((t) => t.marketplace === marketplace) : ALL_REPORT_TYPES;
  res.json(types);
});

/**
 * POST /api/gcs/ingest  (multipart/form-data)
 *   brand        — target brand folder in the bucket (e.g. "eatopia")
 *   marketplace  — "amazon" | "blinkit"
 *   reportType   — report type id (e.g. "seller_central", "total_sales")
 *   files        — one or more .xlsx / .xls / .csv files
 *
 * Uploads each file to gs://<bucket>/<brand>/<marketplace>/<folder>/<filename>,
 * then kicks off a background sync for that brand so the data appears in the
 * dashboard immediately.
 */
gcsRouter.post('/ingest', ingestUpload, async (req, res) => {
  const brand = brandSchema.parse(req.body?.brand ?? undefined);
  const marketplace = marketplaceSchema.parse(req.body?.marketplace ?? undefined);

  const reportTypeId = z.string().trim().min(1).parse(req.body?.reportType ?? '');
  const reportType = findReportType(marketplace, reportTypeId);
  if (!reportType) {
    throw new HttpError(400, `Unknown report type "${reportTypeId}" for marketplace "${marketplace}".`);
  }

  // ── Date range (required for canonical filename) ────────────────────────────
  const startDate = z.string().trim().min(1, 'startDate is required').parse(req.body?.startDate ?? '');
  const endDate   = z.string().trim().min(1, 'endDate is required').parse(req.body?.endDate   ?? '');
  if (!isValidDate(startDate)) throw new HttpError(400, `Invalid startDate "${startDate}" — expected YYYY-MM-DD.`);
  if (!isValidDate(endDate))   throw new HttpError(400, `Invalid endDate "${endDate}" — expected YYYY-MM-DD.`);
  if (endDate < startDate)     throw new HttpError(400, 'endDate must be on or after startDate.');

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    throw new HttpError(400, 'Attach at least one .xlsx, .xls or .csv file in the "files" field.');
  }

  // ── Rename to canonical format: <brand>_<reportType>_<YYYYMMDD>_<YYYYMMDD>.<ext> ──
  const validFiles = files
    .map((f) => ({ original: f.originalname, buffer: f.buffer }))
    .filter((f) => looksLikeSpreadsheet(f.buffer) || /\.csv$/i.test(f.original));

  const ingestFiles = validFiles.map((f, i) => ({
    // Add "_2", "_3" … suffix when multiple files share the same date range.
    name: buildFilename(brand, reportTypeId, startDate, endDate, f.original, validFiles.length > 1 ? `_${i + 1}` : ''),
    buffer: f.buffer,
  }));

  const uploadResults = await guard(() =>
    uploadFilesToGcs(brand, reportType, ingestFiles)
  , res);

  // Kick off a background sync so the uploaded files are ingested into the
  // dashboard immediately. We don't wait for it — just return the job id.
  let syncJob: Awaited<ReturnType<typeof startSync>> | null = null;
  if (uploadResults.some((r) => r.status === 'uploaded')) {
    try {
      syncJob = await startSync(brand, false, marketplace, requestUser(req));
    } catch {
      // Sync failure (e.g. cooldown, concurrent job) is non-fatal for the upload.
    }
  }

  res.json({ files: uploadResults, sync: syncJob });
});


/**
 * POST /api/gcs/detect  (multipart/form-data)
 *   files — one or more .xlsx / .xls / .csv files
 *
 * Inspects each file's columns and guesses its report type, so the bulk
 * ingest UI can pre-fill the per-file report type. No upload happens here.
 */
gcsRouter.post('/detect', ingestUpload, (req, res) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) {
    throw new HttpError(400, 'Attach at least one .xlsx, .xls or .csv file in the "files" field.');
  }
  const detections = files.map((f) => detectIngestType(f.buffer, f.originalname));
  res.json({ detections });
});

/**
 * POST /api/gcs/ingest-bulk  (multipart/form-data)
 *   brand        — target brand folder
 *   startDate    — YYYY-MM-DD (applies to every file)
 *   endDate      — YYYY-MM-DD (applies to every file)
 *   files        — the report files
 *   assignments  — JSON array [{ filename, marketplace, reportType }] matching
 *                  each file by its original name
 *
 * Uploads a mixed batch of report types in one call (the daily workflow where
 * all ~14 advertising exports are dropped together), then kicks off one sync
 * per marketplace touched.
 */
const assignmentSchema = z.array(
  z.object({
    filename: z.string().min(1),
    marketplace: marketplaceSchema,
    reportType: z.string().trim().min(1),
  })
);

gcsRouter.post('/ingest-bulk', ingestUpload, async (req, res) => {
  const brand = brandSchema.parse(req.body?.brand ?? undefined);

  const startDate = z.string().trim().min(1, 'startDate is required').parse(req.body?.startDate ?? '');
  const endDate   = z.string().trim().min(1, 'endDate is required').parse(req.body?.endDate   ?? '');
  if (!isValidDate(startDate)) throw new HttpError(400, `Invalid startDate "${startDate}" — expected YYYY-MM-DD.`);
  if (!isValidDate(endDate))   throw new HttpError(400, `Invalid endDate "${endDate}" — expected YYYY-MM-DD.`);
  if (endDate < startDate)     throw new HttpError(400, 'endDate must be on or after startDate.');

  let assignments: z.infer<typeof assignmentSchema>;
  try {
    assignments = assignmentSchema.parse(JSON.parse(req.body?.assignments ?? '[]'));
  } catch {
    throw new HttpError(400, 'assignments must be a JSON array of { filename, marketplace, reportType }.');
  }
  if (assignments.length === 0) throw new HttpError(400, 'No file assignments provided.');

  const byName = new Map(assignments.map((a) => [a.filename, a]));
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw new HttpError(400, 'Attach at least one file in the "files" field.');

  const items: BulkIngestItem[] = [];
  const skipped: Array<{ filename: string; objectName: string; size: number; status: 'error'; message: string }> = [];
  for (const f of files) {
    const a = byName.get(f.originalname);
    if (!a) {
      skipped.push({ filename: f.originalname, objectName: f.originalname, size: f.buffer.length, status: 'error', message: 'No report type assigned.' });
      continue;
    }
    if (!(looksLikeSpreadsheet(f.buffer) || /\.csv$/i.test(f.originalname))) {
      skipped.push({ filename: f.originalname, objectName: f.originalname, size: f.buffer.length, status: 'error', message: 'Not a readable spreadsheet.' });
      continue;
    }
    items.push({ original: f.originalname, buffer: f.buffer, marketplace: a.marketplace, reportTypeId: a.reportType });
  }

  if (items.length === 0) {
    throw new HttpError(400, 'None of the uploaded files had a valid report-type assignment.');
  }

  const { results, marketplaces } = await guard(() => uploadBulkToGcs(brand, startDate, endDate, items), res);

  // One sync per marketplace that actually received a file.
  const syncJobs: Array<Awaited<ReturnType<typeof startSync>>> = [];
  if (results.some((r) => r.status === 'uploaded')) {
    for (const m of marketplaces) {
      try {
        syncJobs.push(await startSync(brand, false, m, requestUser(req)));
      } catch {
        // cooldown / concurrent job — non-fatal for the upload
      }
    }
  }

  res.json({ files: [...results, ...skipped], sync: syncJobs });
});
