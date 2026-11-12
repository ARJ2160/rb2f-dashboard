import { Router } from 'express';
import { z } from 'zod';

import { isGcsProfile } from '../gcs/paths';
import { ingestSlots } from '../lib/ingest-slots';
import { log } from '../lib/logger';
import { profileIdSchema, rangeQuerySchema } from '../lib/params';
import { cleanFilename, looksLikeSpreadsheet, receiveFiles } from '../lib/upload-files';
import { HttpError } from '../middleware/error-handler';
import { requestUser } from '../middleware/rate-limit';
import { invalidateImDims } from './dims';
import { ingestInstamartFile, type ImFileResult } from './ingest';
import { cityAds, daily, dur, geo, groups, keywords, meta, momWow } from './reports';

/**
 * Swiggy Instamart reports — /api/instamart/*. Same endpoints and response
 * shapes as /api/blinkit (the web app renders both with the same views);
 * there is no inventory feed yet, so /inventory is absent.
 */
export const instamartRouter = Router();

const optText = z.string().trim().max(200).optional().transform((v) => (v ? v : undefined));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const adTypeSchema = z.string().trim().regex(/^[A-Z]{1,6}$/).optional().or(z.literal('').transform(() => undefined));
const range = (q: unknown) => ({ ...rangeQuerySchema.parse(q), category: z.object({ category: optText }).parse(q).category });
const profile = (q: unknown) => z.object({ profileId: profileIdSchema, category: optText }).parse(q);

instamartRouter.get('/meta', async (req, res) => {
  res.json(await meta(profile(req.query).profileId));
});

instamartRouter.get('/mom', async (req, res) => {
  const { asOf } = z.object({ asOf: isoDate.optional().or(z.literal('').transform(() => undefined)) }).parse(req.query);
  res.json(await momWow({ ...profile(req.query), asOf }));
});

/** GET /dsr?profileId&from&to&category&adType=KW|SIB|AS */
instamartRouter.get('/dsr', async (req, res) => {
  const { adType } = z.object({ adType: adTypeSchema }).parse(req.query);
  res.json(await daily({ ...range(req.query), adType }));
});

/** GET /dur?…&metric=units|revenue (no order IDs in the Instamart export, so "orders" is answered with units). */
instamartRouter.get('/dur', async (req, res) => {
  const { metric } = z.object({ metric: z.enum(['units', 'orders', 'revenue']).default('units') }).parse(req.query);
  res.json(await dur({ ...range(req.query), metric: metric === 'orders' ? 'units' : metric }));
});

instamartRouter.get('/groups', async (req, res) => {
  const { groupBy } = z.object({ groupBy: z.enum(['category', 'sku']).default('category') }).parse(req.query);
  res.json(await groups({ ...range(req.query), groupBy }));
});

instamartRouter.get('/geo', async (req, res) => {
  res.json(await geo(range(req.query)));
});

instamartRouter.get('/city-ads', async (req, res) => {
  res.json(await cityAds(range(req.query)));
});

instamartRouter.get('/keywords', async (req, res) => {
  const o = z
    .object({
      geo: optText,
      campaignId: optText,
      adType: adTypeSchema,
      grain: z.enum(['kw', 'kwc']).default('kw'),
      q: optText,
      minImpr: z.coerce.number().min(0).default(0),
      sort: z.enum(['spend', 'impr', 'clicks', 'atc', 'aunits', 'asales', 'dsales', 'nu']).default('spend'),
      limit: z.coerce.number().int().min(1).max(5000).default(1000),
    })
    .parse(req.query);
  res.json(await keywords({ ...range(req.query), geo: o.geo, campaignId: o.campaignId, adType: o.adType, grain: o.grain, search: o.q, minImpr: o.minImpr, sort: o.sort, limit: o.limit }));
});

instamartRouter.post('/rebuild-dims', async (req, res) => {
  invalidateImDims(profile(req.query).profileId);
  res.json({ ok: true });
});

/** POST /uploads (multipart: files[], profileId) — Instamart exports for a non-GCS profile. The SKU mapper is processed first. */
instamartRouter.post('/uploads', receiveFiles, async (req, res) => {
  const profileId = profileIdSchema.parse(req.body?.profileId ?? undefined);
  if (isGcsProfile(profileId)) throw new HttpError(400, `"${profileId}" is fed only by the GCS warehouse — use Sync on the GCS page.`);
  const files = ((req.files as Express.Multer.File[] | undefined) ?? [])
    .map((f) => ({ name: cleanFilename(f.originalname), buffer: f.buffer }))
    .sort((a, b) => Number(!/mapper/i.test(a.name)) - Number(!/mapper/i.test(b.name)));
  if (files.length === 0) throw new HttpError(400, 'Attach at least one .xlsx, .xls or .csv file in the "files" field.');
  const results: ImFileResult[] = [];
  for (const f of files) {
    if (!looksLikeSpreadsheet(f.buffer)) {
      results.push({ filename: f.name, status: 'error', message: 'Not a spreadsheet or CSV file — nothing was stored.' });
      continue;
    }
    results.push(...(await ingestSlots.run(() => ingestInstamartFile(profileId, f.name, f.buffer))));
  }
  log.info('Instamart upload processed', {
    user: requestUser(req), profileId, files: files.length,
    stored: results.filter((r) => r.status === 'stored').length, errors: results.filter((r) => r.status === 'error').length,
  });
  res.json({ profileId, files: results });
});
