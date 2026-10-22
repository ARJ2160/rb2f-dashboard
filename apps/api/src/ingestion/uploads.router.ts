import type { UploadLogEntry, UploadResponse } from '@dash/shared';
import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { env } from '../config/env';
import { isGcsProfile } from '../gcs/paths';
import { db } from '../db/client';
import { uploads } from '../db/schema';
import { profileIdSchema } from '../lib/params';
import { HttpError } from '../middleware/error-handler';
import { markDimsStale, rebuildCampaignDims } from '../reports/dims';
import { ingestFile } from './ingest.service';

const ACCEPTED = /\.(xlsx|xls|csv)$/i;

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 50 },
  fileFilter: (_req, file, cb) => cb(null, ACCEPTED.test(file.originalname)),
});

export const uploadsRouter = Router();

/**
 * POST /api/uploads  (multipart/form-data)
 *   files      one or more .xlsx / .xls / .csv raw Amazon exports
 *   profileId  brand / account partition (default "default")
 *
 * Synchronous: parses and stores, then returns a per-file (per-sheet) result.
 */
uploadsRouter.post('/', upload.array('files', 50), async (req, res) => {
  const profileId = profileIdSchema.parse(req.body?.profileId ?? undefined);
  if (isGcsProfile(profileId)) {
    throw new HttpError(
      400,
      `"${profileId}" is a GCS warehouse profile — its data comes only from the bucket (use Sync on the GCS page).`
    );
  }
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0)
    throw new HttpError(400, 'Attach at least one .xlsx, .xls or .csv file in the "files" field.');

  const results = [];
  for (const f of files) {
    // multer decodes the multipart filename as latin1; restore UTF-8 (₹, non-ASCII names).
    const name = Buffer.from(f.originalname, 'latin1').toString('utf8');
    results.push(...(await ingestFile(profileId, name, f.buffer)));
  }
  // Campaign-level filters (ad type / category / targeting / branding) are
  // derived from everything uploaded so far — rebuild once per batch.
  let dimsError: string | undefined;
  if (results.some((r) => r.status === 'stored')) {
    markDimsStale(profileId);
    try {
      await rebuildCampaignDims(profileId);
    } catch (err) {
      console.error('[uploads] campaign dims rebuild failed', err);
      dimsError = err instanceof Error ? err.message : String(err);
    }
  }
  const body: UploadResponse = { profileId, files: results, ...(dimsError ? { dimsError } : {}) };
  res.json(body);
});

/** GET /api/uploads?profileId=…&limit=50 — upload history. */
uploadsRouter.get('/', async (req, res) => {
  const q = z
    .object({ profileId: profileIdSchema, limit: z.coerce.number().int().min(1).max(500).default(50) })
    .parse(req.query);
  const rows = await db
    .select()
    .from(uploads)
    .where(eq(uploads.profileId, q.profileId))
    .orderBy(desc(uploads.createdAt))
    .limit(q.limit);
  const body: UploadLogEntry[] = rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    reportType: r.reportType,
    status: r.status,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    rowsStored: r.rowsStored,
    message: r.message,
    createdAt: r.createdAt.toISOString(),
  }));
  res.json(body);
});
