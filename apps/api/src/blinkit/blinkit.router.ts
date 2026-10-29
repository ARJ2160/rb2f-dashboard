import { Router } from 'express';
import multer from 'multer';
import { z } from 'zod';

import { env } from '../config/env';
import { isGcsProfile } from '../gcs/paths';
import { profileIdSchema, rangeQuerySchema } from '../lib/params';
import { HttpError } from '../middleware/error-handler';
import { ingestBlinkitFile } from './ingestion/ingest';
import { cityAds } from './reports/city-ads.service';
import { invalidateDims } from './reports/dims';
import { inventory, inventoryTrend } from './reports/inventory.service';
import { keywords } from './reports/keywords.service';
import { meta } from './reports/meta.service';
import { daily, dur, geo, groups, momWow } from './reports/summary.service';

/**
 * Blinkit reports — /api/blinkit/*. Same conventions as /api/reports:
 * `profileId` (GCS brands: gcs_<brand>), ISO `from` / `to`, optional `category`.
 */
export const blinkitRouter = Router();

const optText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : undefined));
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD');
const range = (q: unknown) => {
  const r = rangeQuerySchema.parse(q);
  const { category } = z.object({ category: optText }).parse(q);
  return { ...r, category };
};
const profile = (q: unknown) => {
  const { profileId, category } = z.object({ profileId: profileIdSchema, category: optText }).parse(q);
  return { profileId, category };
};

/** GET /meta?profileId — data ranges, categories, campaigns + their geography, unmapped items / campaigns, inventory snapshots. */
blinkitRouter.get('/meta', async (req, res) => {
  res.json(await meta(profile(req.query).profileId));
});

/** GET /mom?profileId&asOf&category — MTD vs PMTD, L7D vs P7D (Amazon SummaryResponse shape). */
blinkitRouter.get('/mom', async (req, res) => {
  const { asOf } = z.object({ asOf: isoDate.optional().or(z.literal('').transform(() => undefined)) }).parse(req.query);
  res.json(await momWow({ ...profile(req.query), asOf }));
});

/** GET /dsr?profileId&from&to&category — raw sums per day. */
blinkitRouter.get('/dsr', async (req, res) => {
  res.json(await daily(range(req.query)));
});

/** GET /dur?profileId&from&to&metric=units|orders|revenue&category — item × date (Amazon DurResponse shape). */
blinkitRouter.get('/dur', async (req, res) => {
  const { metric } = z.object({ metric: z.enum(['units', 'orders', 'revenue']).default('units') }).parse(req.query);
  res.json(await dur({ ...range(req.query), metric }));
});

/** GET /groups?profileId&from&to&category&groupBy=category|sku — Category / SKU performance. */
blinkitRouter.get('/groups', async (req, res) => {
  const { groupBy } = z.object({ groupBy: z.enum(['category', 'sku']).default('category') }).parse(req.query);
  res.json(await groups({ ...range(req.query), groupBy }));
});

/** GET /geo?profileId&from&to&category — sales by customer state / city. */
blinkitRouter.get('/geo', async (req, res) => {
  res.json(await geo(range(req.query)));
});

/** GET /city-ads?profileId&from&to&category — ads only for campaigns with exact city targeting. */
blinkitRouter.get('/city-ads', async (req, res) => {
  res.json(await cityAds(range(req.query)));
});

/** GET /keywords?profileId&from&to&category&geo&campaignId&adType&grain&q&minImpr&sort&limit */
blinkitRouter.get('/keywords', async (req, res) => {
  const o = z
    .object({
      geo: optText,
      campaignId: optText,
      adType: z.enum(['PL', 'PR', 'BL']).optional().or(z.literal('').transform(() => undefined)),
      grain: z.enum(['kw', 'kwc']).default('kw'),
      q: optText,
      minImpr: z.coerce.number().min(0).default(0),
      sort: z.enum(['spend', 'impr', 'atc', 'aunits', 'asales', 'dsales', 'nu']).default('spend'),
      limit: z.coerce.number().int().min(1).max(5000).default(1000),
    })
    .parse(req.query);
  res.json(
    await keywords({
      ...range(req.query),
      geo: o.geo,
      campaignId: o.campaignId,
      adType: o.adType,
      grain: o.grain,
      search: o.q,
      minImpr: o.minImpr,
      sort: o.sort,
      limit: o.limit,
    })
  );
});

/** GET /inventory?profileId&snapshot&category — run rate + days of cover per item × feeder. */
blinkitRouter.get('/inventory', async (req, res) => {
  const { snapshot } = z.object({ snapshot: isoDate.optional().or(z.literal('').transform(() => undefined)) }).parse(req.query);
  res.json(await inventory({ ...profile(req.query), snapshot }));
});

/** GET /inventory/trend?profileId&category&itemId&facilityId — stock and DOC across daily snapshots. */
blinkitRouter.get('/inventory/trend', async (req, res) => {
  const { itemId, facilityId } = z.object({ itemId: optText, facilityId: optText }).parse(req.query);
  res.json(await inventoryTrend({ ...profile(req.query), itemId, facilityId }));
});

/** POST /rebuild-dims?profileId — re-read the mappers (normally automatic after every ingest). */
blinkitRouter.post('/rebuild-dims', async (req, res) => {
  invalidateDims(profile(req.query).profileId);
  res.json({ ok: true });
});

// ── Manual upload (same pipeline as the GCS sync) ──

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.MAX_UPLOAD_MB * 1024 * 1024, files: 50 },
  fileFilter: (_req, file, cb) => cb(null, /\.(xlsx|xls|csv)$/i.test(file.originalname)),
});

/** POST /uploads (multipart: files[], profileId) — Blinkit exports for a non-GCS profile. Mappers are processed first. */
blinkitRouter.post('/uploads', upload.array('files', 50), async (req, res) => {
  const profileId = profileIdSchema.parse(req.body?.profileId ?? undefined);
  if (isGcsProfile(profileId)) throw new HttpError(400, `"${profileId}" is fed only by the GCS warehouse — use Sync on the GCS page.`);
  const files = ((req.files as Express.Multer.File[] | undefined) ?? [])
    .slice()
    .sort((a, b) => Number(!/mapper/i.test(a.originalname)) - Number(!/mapper/i.test(b.originalname)));
  const results = [];
  for (const f of files) results.push(...(await ingestBlinkitFile(profileId, f.originalname, f.buffer)));
  res.json({ profileId, files: results });
});
