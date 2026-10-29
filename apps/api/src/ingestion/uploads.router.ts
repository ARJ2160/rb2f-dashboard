import type { FileUploadResult, UploadLogEntry, UploadResponse } from '@dash/shared';
import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { isGcsProfile } from '../gcs/paths';
import { db } from '../db/client';
import { uploads } from '../db/schema';
import { ingestSlots } from '../lib/ingest-slots';
import { log } from '../lib/logger';
import { profileIdSchema } from '../lib/params';
import { cleanFilename, looksLikeSpreadsheet, receiveFiles } from '../lib/upload-files';
import { HttpError } from '../middleware/error-handler';
import { requestUser } from '../middleware/rate-limit';
import { markDimsStale, rebuildCampaignDims } from '../reports/dims';
import { ingestFile } from './ingest.service';

export const uploadsRouter = Router();

/**
 * POST /api/uploads  (multipart/form-data)
 *   files      one or more .xlsx / .xls / .csv raw Amazon exports
 *   profileId  brand / account partition (default "default")
 *
 * Synchronous: parses and stores, then returns a per-file (per-sheet) result.
 */
uploadsRouter.post('/', receiveFiles, async (req, res) => {
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

  const results: FileUploadResult[] = [];
  for (const f of files) {
    const name = cleanFilename(f.originalname);
    if (!looksLikeSpreadsheet(f.buffer)) {
      results.push({ filename: name, status: 'error', message: 'Not a spreadsheet or CSV file — nothing was stored.' });
      continue;
    }
    results.push(...(await ingestSlots.run(() => ingestFile(profileId, name, f.buffer))));
  }
  log.info('Upload processed', {
    user: requestUser(req),
    profileId,
    files: files.length,
    stored: results.filter((r) => r.status === 'stored').length,
    errors: results.filter((r) => r.status === 'error').length,
  });
  // Campaign-level filters (ad type / category / targeting / branding) are
  // derived from everything uploaded so far — rebuild once per batch.
  let dimsError: string | undefined;
  if (results.some((r) => r.status === 'stored')) {
    markDimsStale(profileId);
    try {
      await rebuildCampaignDims(profileId);
    } catch (err) {
      log.error('Campaign dims rebuild after upload failed', { err, profileId });
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
