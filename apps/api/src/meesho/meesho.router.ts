import { Router } from 'express';
import { z } from 'zod';
import { profileIdSchema, rangeQuerySchema } from '../lib/params';
import { invalidateMeDims } from './reports/dims';
import { asinLevel, daily, deleteManualAd, dur, geo, groups, manualAds, meta, upsertManualAd } from './reports';

export const meeshoRouter = Router();
const optText = z.string().trim().max(200).optional().transform((v) => (v ? v : undefined));
const range = (qry: unknown) => { const r = rangeQuerySchema.parse(qry); const { category } = z.object({ category: optText }).parse(qry); return { ...r, category }; };
const profile = (qry: unknown) => z.object({ profileId: profileIdSchema }).parse(qry).profileId;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

meeshoRouter.get('/meta', async (req, res) => { res.json(await meta(profile(req.query))); });
meeshoRouter.get('/summary', async (req, res) => { const { groupBy } = z.object({ groupBy: z.enum(['category', 'sku']).default('category') }).parse(req.query); res.json(await groups(range(req.query), groupBy)); });
meeshoRouter.get('/dsr', async (req, res) => { res.json(await daily(range(req.query))); });
meeshoRouter.get('/dur', async (req, res) => { const { metric } = z.object({ metric: z.enum(['units', 'rev', 'net_units']).default('units') }).parse(req.query); res.json(await dur(range(req.query), metric)); });
meeshoRouter.get('/asin', async (req, res) => { const { limit } = z.object({ limit: z.coerce.number().int().min(1).max(5000).default(2000) }).parse(req.query); res.json(await asinLevel({ ...range(req.query), limit })); });
meeshoRouter.get('/geo', async (req, res) => { res.json(await geo(range(req.query))); });
meeshoRouter.get('/manual-ads', async (req, res) => { res.json(await manualAds(range(req.query))); });
meeshoRouter.post('/manual-ads', async (req, res) => {
  const b = z.object({ date: isoDate, campaign: z.string().trim().max(200).default(''), spend: z.number().min(0), adSales: z.number().min(0).optional(), adUnits: z.number().min(0).optional(), impressions: z.number().min(0).optional(), clicks: z.number().min(0).optional() }).parse(req.body);
  await upsertManualAd({ profileId: profile(req.query), ...b });
  res.json({ ok: true });
});
meeshoRouter.delete('/manual-ads', async (req, res) => {
  const { date, campaign } = z.object({ date: isoDate, campaign: z.string().trim().max(200).default('') }).parse(req.query);
  await deleteManualAd(profile(req.query), date, campaign);
  res.json({ ok: true });
});
meeshoRouter.post('/rebuild-dims', async (req, res) => { invalidateMeDims(profile(req.query)); res.json({ ok: true }); });
