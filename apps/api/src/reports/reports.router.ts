import { Router } from 'express';
import { z } from 'zod';

import { profileIdSchema, rangeQuerySchema } from '../lib/params';
import { getAds } from './ads.service';
import { getCategoryView } from './category.service';
import { getCoverage } from './coverage.service';
import { ensureDims, getBrandTerms, markDimsStale, rebuildCampaignDims, setBrandTerms } from './dims';
import { getDsr } from './dsr.service';
import { getDur } from './dur.service';
import { getHourly } from './hourly.service';
import { getPlacements } from './placements.service';
import { getSearchTerms } from './search-terms.service';
import { getStates } from './states.service';

export const reportsRouter = Router();

const optText = z.string().trim().max(200).optional().transform((v) => (v ? v : undefined));
const adFilters = z.object({ category: optText, adType: optText, targeting: optText, branding: optText });

/**
 * Build campaign filters / search-term classes if they're missing, then run
 * the report. A failed rebuild doesn't block the report — it's shown in notes.
 */
async function withDims<T extends { notes: string[] }>(profileId: string, run: () => Promise<T>): Promise<T> {
  const err = await ensureDims(profileId);
  const out = await run();
  if (err) out.notes.unshift(`Couldn't build the campaign filters / Branded-Competitor-Generic classes (${err}). Filters and branding may be incomplete — check the API log.`);
  return out;
}

/** GET /api/reports/dsr?profileId&from&to&category */
reportsRouter.get('/dsr', async (req, res) => {
  const q = rangeQuerySchema.parse(req.query);
  const { category } = z.object({ category: optText }).parse(req.query);
  res.json(await withDims(q.profileId, () => getDsr(q.profileId, q.from, q.to, category)));
});

/** GET /api/reports/dur?profileId&from&to&metric=units|orders&category */
reportsRouter.get('/dur', async (req, res) => {
  const q = rangeQuerySchema.parse(req.query);
  const { metric, category } = z.object({ metric: z.enum(['units', 'orders']).default('units'), category: optText }).parse(req.query);
  res.json(await getDur(q.profileId, q.from, q.to, metric, category));
});

/** GET /api/reports/coverage?profileId — uploaded date ranges per source + mapper match rate. */
reportsRouter.get('/coverage', async (req, res) => {
  const { profileId } = z.object({ profileId: profileIdSchema }).parse(req.query);
  res.json(await getCoverage(profileId));
});

/** GET /api/reports/category?profileId&from&to&category — rule book §10.4 (+ ASIN table) */
reportsRouter.get('/category', async (req, res) => {
  const q = rangeQuerySchema.parse(req.query);
  const { category } = z.object({ category: optText }).parse(req.query);
  res.json(await withDims(q.profileId, () => getCategoryView(q.profileId, q.from, q.to, { category })));
});

/** GET /api/reports/search-terms?…&channel&q&category&adType&targeting&branding&sort&limit */
reportsRouter.get('/search-terms', async (req, res) => {
  const q = rangeQuerySchema.parse(req.query);
  const o = adFilters
    .extend({
      channel: z.enum(['all', 'sp', 'sb', 'sd']).default('all'),
      q: optText,
      sort: z.enum(['spend', 'adSales', 'clicks', 'impressions', 'adUnits']).default('spend'),
      limit: z.coerce.number().int().min(1).max(2000).default(500),
    })
    .parse(req.query);
  res.json(await withDims(q.profileId, () => getSearchTerms(q.profileId, q.from, q.to, o)));
});

/** GET /api/reports/placements?…&channel&category&adType&targeting&branding */
reportsRouter.get('/placements', async (req, res) => {
  const q = rangeQuerySchema.parse(req.query);
  const o = adFilters.extend({ channel: z.enum(['all', 'sp', 'sb']).default('all') }).parse(req.query);
  res.json(await withDims(q.profileId, () => getPlacements(q.profileId, q.from, q.to, o)));
});

/** GET /api/reports/ads?…&category&adType&targeting&branding — Ads analysis */
reportsRouter.get('/ads', async (req, res) => {
  const q = rangeQuerySchema.parse(req.query);
  res.json(await withDims(q.profileId, () => getAds(q.profileId, q.from, q.to, adFilters.parse(req.query))));
});

/** GET /api/reports/hourly?…&channel&category&adType&targeting&branding — Hour-wise */
reportsRouter.get('/hourly', async (req, res) => {
  const q = rangeQuerySchema.parse(req.query);
  const o = adFilters.extend({ channel: z.enum(['all', 'sp', 'sb', 'sd']).default('all') }).parse(req.query);
  res.json(await withDims(q.profileId, () => getHourly(q.profileId, q.from, q.to, o)));
});

/** GET /api/reports/states?profileId&from&to&source&category — "State Wise Data" */
reportsRouter.get('/states', async (req, res) => {
  const q = rangeQuerySchema.parse(req.query);
  const o = z.object({ source: z.enum(['all', 'seller', 'vendor']).default('all'), category: optText }).parse(req.query);
  res.json(await getStates(q.profileId, q.from, q.to, o));
});

/** GET / PUT /api/reports/brand-terms?profileId — terms that make a search term "Branded". */
reportsRouter.get('/brand-terms', async (req, res) => {
  const { profileId } = z.object({ profileId: profileIdSchema }).parse(req.query);
  res.json({ profileId, terms: await getBrandTerms(profileId) });
});
/** POST /api/reports/rebuild-dims?profileId — force a rebuild of campaign filters + search-term classes. */
reportsRouter.post('/rebuild-dims', async (req, res) => {
  const { profileId } = z.object({ profileId: profileIdSchema }).parse(req.query);
  markDimsStale(profileId);
  const t0 = Date.now();
  const campaigns = await rebuildCampaignDims(profileId);
  res.json({ profileId, campaigns, ms: Date.now() - t0, terms: await getBrandTerms(profileId) });
});
reportsRouter.put('/brand-terms', async (req, res) => {
  const { profileId } = z.object({ profileId: profileIdSchema }).parse(req.query);
  const { terms } = z.object({ terms: z.array(z.string().max(60)).max(50) }).parse(req.body);
  const saved = await setBrandTerms(profileId, terms);
  markDimsStale(profileId);
  await rebuildCampaignDims(profileId);
  res.json({ profileId, terms: saved });
});
