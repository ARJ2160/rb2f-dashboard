import { Router } from 'express';
import { z } from 'zod';

import { HttpError } from '../middleware/error-handler';
import { GcsError } from './gcs-client';
import { gcsConfigError, getBrands, listSyncedFiles, startSync } from './gcs-sync.service';

/**
 * Read-only GCS warehouse endpoints. Reports for a synced brand use the normal
 * /api/reports/* routes with `profileId=gcs_<brand>`.
 */
export const gcsRouter = Router();

const brandSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9_-]{1,60}$/, 'brand: lower-case letters, digits, - and _ only');

/** Map GCS / config failures to clean HTTP errors. */
async function guard<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GcsError) {
      const status = err.status === 404 ? 404 : gcsConfigError() ? 503 : 502;
      throw new HttpError(status, err.message);
    }
    throw err;
  }
}

/** GET /api/gcs/brands?refresh=1 — brand folders + last sync + running job. */
gcsRouter.get('/brands', async (req, res) => {
  const refresh = req.query.refresh === '1' || req.query.refresh === 'true';
  res.json(await getBrands(refresh));
});

/** POST /api/gcs/sync  { brand, force? } — starts a background sync, returns the job. */
gcsRouter.post('/sync', async (req, res) => {
  const body = z.object({ brand: brandSchema, force: z.boolean().default(false) }).parse(req.body ?? {});
  const job = await guard(() => startSync(body.brand, body.force));
  res.status(202).json(job);
});

/** GET /api/gcs/files?brand= — every synced object and how it was ingested. */
gcsRouter.get('/files', async (req, res) => {
  const q = z.object({ brand: brandSchema }).parse(req.query);
  res.json(await guard(() => listSyncedFiles(q.brand)));
});
