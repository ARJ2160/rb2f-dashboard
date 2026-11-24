import { Router } from 'express';
import { z } from 'zod';

import { profileIdSchema, rangeQuerySchema } from '../lib/params';
import { invalidateZpDims } from './reports/dims';
import {
  asinLevel,
  campaigns,
  categoryAdvertised,
  daily,
  dur,
  geo,
  groups,
  inventory,
  keywords,
  meta,
} from './reports';

/**
 * Zepto reports — /api/zepto/*. `profileId` (GCS brands: gcs_<brand>), ISO
 * `from`/`to`, optional `category` and `channel` (csv of sp|sb|sd). Sales/units
 * come from Total Sales; ad metrics from the period-level SP/SB/SD reports.
 */
export const zeptoRouter = Router();

const optText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((v) => (v ? v : undefined));

const range = (q: unknown) => {
  const r = rangeQuerySchema.parse(q);
  const { category, channel } = z.object({ category: optText, channel: optText }).parse(q);
  return { ...r, category, channel };
};
const profile = (q: unknown) => z.object({ profileId: profileIdSchema }).parse(q).profileId;

zeptoRouter.get('/meta', async (req, res) => {
  res.json(await meta(profile(req.query)));
});

zeptoRouter.get('/summary', async (req, res) => {
  const { groupBy } = z.object({ groupBy: z.enum(['category', 'sku']).default('category') }).parse(req.query);
  res.json(await groups(range(req.query), groupBy));
});

zeptoRouter.get('/dsr', async (req, res) => {
  res.json(await daily(range(req.query)));
});

zeptoRouter.get('/dur', async (req, res) => {
  const { metric } = z.object({ metric: z.enum(['units', 'rev']).default('units') }).parse(req.query);
  res.json(await dur(range(req.query), metric));
});

zeptoRouter.get('/geo', async (req, res) => {
  res.json(await geo(range(req.query)));
});

zeptoRouter.get('/keywords', async (req, res) => {
  const o = z
    .object({
      grain: z.enum(['kw', 'kwc']).default('kw'),
      q: optText,
      sort: optText,
      dir: z.enum(['asc', 'desc']).default('desc'),
      limit: z.coerce.number().int().min(1).max(5000).default(1000),
    })
    .parse(req.query);
  res.json(
    await keywords({ ...range(req.query), grain: o.grain, search: o.q, sort: o.sort, dir: o.dir, limit: o.limit })
  );
});

zeptoRouter.get('/category-advertised', async (req, res) => {
  res.json(await categoryAdvertised(range(req.query)));
});

zeptoRouter.get('/asin', async (req, res) => {
  const o = z
    .object({
      sort: optText,
      dir: z.enum(['asc', 'desc']).default('desc'),
      limit: z.coerce.number().int().min(1).max(5000).default(2000),
    })
    .parse(req.query);
  res.json(await asinLevel({ ...range(req.query), sort: o.sort, dir: o.dir, limit: o.limit }));
});

zeptoRouter.get('/campaigns', async (req, res) => {
  res.json(await campaigns(range(req.query)));
});

zeptoRouter.get('/inventory', async (req, res) => {
  const { snapshot, category } = z
    .object({ snapshot: optText, category: optText, profileId: profileIdSchema })
    .parse(req.query);
  res.json(await inventory({ profileId: profile(req.query), snapshot, category }));
});

zeptoRouter.post('/rebuild-dims', async (req, res) => {
  invalidateZpDims(profile(req.query));
  res.json({ ok: true });
});
