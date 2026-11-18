import { Router } from 'express';
import { z } from 'zod';

import { isIsoDate } from '@dash/shared';
import { getScViews } from './reports';

/** Seller Central report endpoints — /api/ops/sc/*. All views derive from one build per request. */
export const scRouter = Router();

const brandIdSchema = z
  .string()
  .trim()
  .regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/);
const isoDate = z.string().refine(isIsoDate, 'Expected YYYY-MM-DD');
const querySchema = z.object({
  brandId: brandIdSchema,
  from: isoDate.optional().or(z.literal('').transform(() => undefined)),
  to: isoDate.optional().or(z.literal('').transform(() => undefined)),
});

const views = (req: { query: unknown }) => {
  const q = querySchema.parse(req.query);
  return getScViews(q.brandId, { from: q.from, to: q.to });
};

scRouter.get('/summary', async (req, res) => res.json((await views(req)).summary));
scRouter.get('/skus', async (req, res) => res.json((await views(req)).skus));
scRouter.get('/warehouses', async (req, res) => res.json((await views(req)).warehouses));
scRouter.get('/shipments', async (req, res) => res.json((await views(req)).shipments));
scRouter.get('/sku-warehouse', async (req, res) => res.json((await views(req)).skuWarehouse));
scRouter.get('/trend', async (req, res) => res.json((await views(req)).trend));
/** Everything in one call (used by the Overview page to avoid six round-trips). */
scRouter.get('/all', async (req, res) => res.json(await views(req)));
