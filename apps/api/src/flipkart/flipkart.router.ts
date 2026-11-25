import { Router } from 'express';
import { z } from 'zod';

import { profileIdSchema, rangeQuerySchema } from '../lib/params';
import { invalidateFkDims } from './reports/dims';
import {
  asinLevel,
  campaigns,
  categoryAdvertised,
  daily,
  dur,
  groups,
  keywords,
  meta,
  placements,
  searchTerms,
} from './reports';

/**
 * Flipkart reports — /api/flipkart/*. `profileId` (GCS brands: gcs_<brand>),
 * ISO `from`/`to`, optional `category`. Gross sales/units + combined traffic
 * impr/clicks come from the Traffic report; returns / net from Earn More; ad
 * metrics from the period-level ad reports.
 */
export const flipkartRouter = Router();

const optText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : undefined));

const range = (qry: unknown) => {
  const r = rangeQuerySchema.parse(qry);
  const { category } = z.object({ category: optText }).parse(qry);
  return { ...r, category };
};
const profile = (qry: unknown) => z.object({ profileId: profileIdSchema }).parse(qry).profileId;
const limit = (qry: unknown, def: number) => z.object({ limit: z.coerce.number().int().min(1).max(5000).default(def) }).parse(qry).limit;

flipkartRouter.get('/meta', async (req, res) => {
  res.json(await meta(profile(req.query)));
});

flipkartRouter.get('/summary', async (req, res) => {
  const { groupBy } = z.object({ groupBy: z.enum(['category', 'fsn']).default('category') }).parse(req.query);
  res.json(await groups(range(req.query), groupBy));
});

flipkartRouter.get('/dsr', async (req, res) => {
  res.json(await daily(range(req.query)));
});

flipkartRouter.get('/dur', async (req, res) => {
  const { metric } = z.object({ metric: z.enum(['units', 'rev', 'net_units']).default('units') }).parse(req.query);
  res.json(await dur(range(req.query), metric));
});

flipkartRouter.get('/asin', async (req, res) => {
  res.json(await asinLevel({ ...range(req.query), limit: limit(req.query, 2000) }));
});

flipkartRouter.get('/keywords', async (req, res) => {
  res.json(await keywords({ ...range(req.query), limit: limit(req.query, 1000) }));
});

flipkartRouter.get('/search-terms', async (req, res) => {
  res.json(await searchTerms({ ...range(req.query), limit: limit(req.query, 1000) }));
});

flipkartRouter.get('/placements', async (req, res) => {
  res.json(await placements(range(req.query)));
});

flipkartRouter.get('/category-advertised', async (req, res) => {
  res.json(await categoryAdvertised(range(req.query)));
});

flipkartRouter.get('/campaigns', async (req, res) => {
  res.json(await campaigns(range(req.query)));
});

flipkartRouter.post('/rebuild-dims', async (req, res) => {
  invalidateFkDims(profile(req.query));
  res.json({ ok: true });
});
