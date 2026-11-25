import { Router } from 'express';
import { z } from 'zod';

import { profileIdSchema, rangeQuerySchema } from '../lib/params';
import { invalidateMyDims } from './reports/dims';
import {
  asinLevel, campaigns, categoryAdvertised, daily, dur, geo, groups,
  meta, placements, searchTerms, targeting, topSearchTerms,
} from './reports';

/** Myntra reports — /api/myntra/*. profileId, ISO from/to, optional category. */
export const myntraRouter = Router();
const optText = z.string().trim().max(200).optional().transform((v) => (v ? v : undefined));
const range = (qry: unknown) => { const r = rangeQuerySchema.parse(qry); const { category } = z.object({ category: optText }).parse(qry); return { ...r, category }; };
const profile = (qry: unknown) => z.object({ profileId: profileIdSchema }).parse(qry).profileId;
const limit = (qry: unknown, def: number) => z.object({ limit: z.coerce.number().int().min(1).max(5000).default(def) }).parse(qry).limit;

myntraRouter.get('/meta', async (req, res) => { res.json(await meta(profile(req.query))); });
myntraRouter.get('/summary', async (req, res) => { const { groupBy } = z.object({ groupBy: z.enum(['category', 'style']).default('category') }).parse(req.query); res.json(await groups(range(req.query), groupBy)); });
myntraRouter.get('/dsr', async (req, res) => { res.json(await daily(range(req.query))); });
myntraRouter.get('/dur', async (req, res) => { const { metric } = z.object({ metric: z.enum(['units', 'rev']).default('units') }).parse(req.query); res.json(await dur(range(req.query), metric)); });
myntraRouter.get('/asin', async (req, res) => { res.json(await asinLevel({ ...range(req.query), limit: limit(req.query, 2000) })); });
myntraRouter.get('/targeting', async (req, res) => { res.json(await targeting({ ...range(req.query), limit: limit(req.query, 1000) })); });
myntraRouter.get('/search-terms', async (req, res) => { res.json(await searchTerms({ ...range(req.query), limit: limit(req.query, 1000) })); });
myntraRouter.get('/placements', async (req, res) => { res.json(await placements(range(req.query))); });
myntraRouter.get('/category-advertised', async (req, res) => { res.json(await categoryAdvertised(range(req.query))); });
myntraRouter.get('/campaigns', async (req, res) => { res.json(await campaigns(range(req.query))); });
myntraRouter.get('/geo', async (req, res) => { res.json(await geo(range(req.query))); });
myntraRouter.get('/top-search-terms', async (req, res) => { res.json(await topSearchTerms({ ...range(req.query), limit: limit(req.query, 500) })); });
myntraRouter.post('/rebuild-dims', async (req, res) => { invalidateMyDims(profile(req.query)); res.json({ ok: true }); });
