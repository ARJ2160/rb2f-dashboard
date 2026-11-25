import { Router } from 'express';
import { z } from 'zod';
import { profileIdSchema, rangeQuerySchema } from '../lib/params';
import { invalidateNkDims } from './reports/dims';
import { asinLevel, campaignsReport, categoryAdvertised, daily, dur, groups, meta, placements, searchTerms, skuSov } from './reports';

export const nykaaRouter = Router();
const optText = z.string().trim().max(200).optional().transform((v) => (v ? v : undefined));
const range = (qry: unknown) => { const r = rangeQuerySchema.parse(qry); const { category } = z.object({ category: optText }).parse(qry); return { ...r, category }; };
const profile = (qry: unknown) => z.object({ profileId: profileIdSchema }).parse(qry).profileId;
const limit = (qry: unknown, def: number) => z.object({ limit: z.coerce.number().int().min(1).max(5000).default(def) }).parse(qry).limit;

nykaaRouter.get('/meta', async (req, res) => { res.json(await meta(profile(req.query))); });
nykaaRouter.get('/summary', async (req, res) => { const { groupBy } = z.object({ groupBy: z.enum(['category', 'sku']).default('category') }).parse(req.query); res.json(await groups(range(req.query), groupBy)); });
nykaaRouter.get('/dsr', async (req, res) => { res.json(await daily(range(req.query))); });
nykaaRouter.get('/dur', async (req, res) => { const { metric } = z.object({ metric: z.enum(['units', 'rev']).default('units') }).parse(req.query); res.json(await dur(range(req.query), metric)); });
nykaaRouter.get('/asin', async (req, res) => { res.json(await asinLevel({ ...range(req.query), limit: limit(req.query, 2000) })); });
nykaaRouter.get('/search-terms', async (req, res) => { res.json(await searchTerms({ ...range(req.query), limit: limit(req.query, 1000) })); });
nykaaRouter.get('/placements', async (req, res) => { res.json(await placements(range(req.query))); });
nykaaRouter.get('/category-advertised', async (req, res) => { res.json(await categoryAdvertised(range(req.query))); });
nykaaRouter.get('/campaigns', async (req, res) => { res.json(await campaignsReport(range(req.query))); });
nykaaRouter.get('/sku-sov', async (req, res) => { res.json(await skuSov({ ...range(req.query), limit: limit(req.query, 1000) })); });
nykaaRouter.post('/rebuild-dims', async (req, res) => { invalidateNkDims(profile(req.query)); res.json({ ok: true }); });
