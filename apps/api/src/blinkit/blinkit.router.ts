import { Router } from 'express';
import { z } from 'zod';

import { isGcsProfile } from '../gcs/paths';
import { ingestSlots } from '../lib/ingest-slots';
import { log } from '../lib/logger';
import { profileIdSchema, rangeQuerySchema } from '../lib/params';
import { cleanFilename, looksLikeSpreadsheet, receiveFiles } from '../lib/upload-files';
import { HttpError } from '../middleware/error-handler';
import { requestUser } from '../middleware/rate-limit';
import { type BkFileResult, ingestBlinkitFile } from './ingestion/ingest';
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

/** GET /dsr?profileId&from&to&category&adType=PL|PR|BL — raw sums per day (adType filters the ads side only). */
blinkitRouter.get('/dsr', async (req, res) => {
  const { adType } = z.object({ adType: z.enum(['PL', 'PR', 'BL']).optional().or(z.literal('').transform(() => undefined)) }).parse(req.query);
  res.json(await daily({ ...range(req.query), adType }));
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

/** POST /uploads (multipart: files[], profileId) — Blinkit exports for a non-GCS profile. Mappers are processed first. */
blinkitRouter.post('/uploads', receiveFiles, async (req, res) => {
  const profileId = profileIdSchema.parse(req.body?.profileId ?? undefined);
  if (isGcsProfile(profileId)) throw new HttpError(400, `"${profileId}" is fed only by the GCS warehouse — use Sync on the GCS page.`);
  const files = ((req.files as Express.Multer.File[] | undefined) ?? [])
    .map((f) => ({ name: cleanFilename(f.originalname), buffer: f.buffer }))
    .sort((a, b) => Number(!/mapper/i.test(a.name)) - Number(!/mapper/i.test(b.name)));
  if (files.length === 0) throw new HttpError(400, 'Attach at least one .xlsx, .xls or .csv file in the "files" field.');
  const results: BkFileResult[] = [];
  for (const f of files) {
    if (!looksLikeSpreadsheet(f.buffer)) {
      results.push({ filename: f.name, status: 'error', message: 'Not a spreadsheet or CSV file — nothing was stored.' });
      continue;
    }
    results.push(...(await ingestSlots.run(() => ingestBlinkitFile(profileId, f.name, f.buffer))));
  }
  log.info('Blinkit upload processed', {
    user: requestUser(req),
    profileId,
    files: files.length,
    stored: results.filter((r) => r.status === 'stored').length,
    errors: results.filter((r) => r.status === 'error').length,
  });
  res.json({ profileId, files: results });
});
