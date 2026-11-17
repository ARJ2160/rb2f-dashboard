import type {
  OpsBrandWithChannels,
  OpsNav,
  OpsUploadLogEntry,
  OpsUploadResponse,
  OpsUploadResult,
  OpsWarehouse,
} from '@dash/shared';
import { OPS_FILE_TYPES, type OpsFileType } from '@dash/shared';
import { randomUUID } from 'node:crypto';
import { desc, eq } from 'drizzle-orm';
import { Router } from 'express';
import { z } from 'zod';

import { db } from '../db/client';
import { dimWarehouse, importBatches } from '../db/schema';
import { readWorkbook, type SheetData } from '../ingestion/sheet-reader';
import { ingestSlots } from '../lib/ingest-slots';
import { log } from '../lib/logger';
import { cleanFilename, looksLikeSpreadsheet, receiveFiles } from '../lib/upload-files';
import { pick, str, type Row } from '../lib/values';
import { HttpError } from '../middleware/error-handler';
import { requestUser } from '../middleware/rate-limit';
import {
  createBrand,
  getBrand,
  getBrandChannels,
  getBrandWithChannels,
  identifierWarning,
  listBrands,
  navFromChannels,
  recomputeBrandChannels,
  updateBrand,
} from './brands';
import { channelOf, detectOpsFile, sniffIdentifier } from './detect';
import { getBrandSettings, upsertBrandSettings } from './settings';
import { ingestScFile } from './sc/ingest';
import { datesFromFilename } from '../lib/dates';
import { ensureWarehouses, normalizeFcCode } from './warehouses';

export const opsRouter = Router();

const brandIdSchema = z
  .string()
  .trim()
  .regex(/^[a-z0-9][a-z0-9_-]{0,63}$/, 'brandId: lower-case letters, digits, - and _ (max 64), starting alphanumeric');
const codeList = z.array(z.string().trim().min(1)).max(50).optional();

// ── Brands ────────────────────────────────────────────────────────────────

opsRouter.get('/brands', async (_req, res) => {
  const brands = await listBrands();
  const withChannels: OpsBrandWithChannels[] = await Promise.all(
    brands.map(async (b) => ({ ...b, channels: await getBrandChannels(b.id) }))
  );
  res.json(withChannels);
});

opsRouter.post('/brands', async (req, res) => {
  const body = z
    .object({
      id: brandIdSchema,
      name: z.string().trim().min(1).max(120),
      logoUrl: z.string().trim().url().max(500).optional().nullable(),
      vendorCodes: codeList,
      sellerIds: codeList,
      marketplace: z.string().trim().max(40).optional(),
      active: z.boolean().optional(),
    })
    .parse(req.body);
  if (await getBrand(body.id)) throw new HttpError(409, `Brand "${body.id}" already exists.`);
  const brand = await createBrand(body);
  log.info('Ops brand created', { user: requestUser(req), brandId: brand.id });
  res.status(201).json(brand);
});

opsRouter.get('/brands/:id', async (req, res) => {
  const id = brandIdSchema.parse(req.params.id);
  const brand = await getBrandWithChannels(id);
  if (!brand) throw new HttpError(404, `Brand "${id}" not found.`);
  res.json(brand);
});

opsRouter.patch('/brands/:id', async (req, res) => {
  const id = brandIdSchema.parse(req.params.id);
  const patch = z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      logoUrl: z.string().trim().url().max(500).nullable().optional(),
      vendorCodes: codeList,
      sellerIds: codeList,
      marketplace: z.string().trim().max(40).optional(),
      active: z.boolean().optional(),
    })
    .parse(req.body);
  const brand = await updateBrand(id, patch);
  if (!brand) throw new HttpError(404, `Brand "${id}" not found.`);
  res.json(brand);
});

// ── Adaptive nav ────────────────────────────────────────────────────────────

opsRouter.get('/nav', async (req, res) => {
  const { brandId } = z.object({ brandId: brandIdSchema }).parse(req.query);
  const nav: OpsNav = navFromChannels(await getBrandChannels(brandId));
  res.json(nav);
});

// ── Warehouse master (FC network, shared across brands) ──────────────────────

opsRouter.get('/warehouses', async (_req, res) => {
  const rows = await db.select().from(dimWarehouse).orderBy(dimWarehouse.code);
  const body: OpsWarehouse[] = rows.map((r) => ({
    code: r.code,
    network: r.network === 'Amazon Now' ? 'Amazon Now' : 'Core',
    city: r.city,
    state: r.state,
    needsReview: r.needsReview,
  }));
  res.json(body);
});

opsRouter.patch('/warehouses/:code', async (req, res) => {
  const code = normalizeFcCode(req.params.code);
  const patch = z
    .object({
      network: z.enum(['Core', 'Amazon Now']).optional(),
      city: z.string().trim().max(120).nullable().optional(),
      state: z.string().trim().max(120).nullable().optional(),
      needsReview: z.boolean().optional(),
    })
    .parse(req.body);
  const set: Partial<typeof dimWarehouse.$inferInsert> = {};
  if (patch.network !== undefined) set.network = patch.network;
  if (patch.city !== undefined) set.city = patch.city;
  if (patch.state !== undefined) set.state = patch.state;
  if (patch.needsReview !== undefined) set.needsReview = patch.needsReview;
  if (Object.keys(set).length === 0) throw new HttpError(400, 'Nothing to update.');
  const [row] = await db.update(dimWarehouse).set(set).where(eq(dimWarehouse.code, code)).returning();
  if (!row) throw new HttpError(404, `Warehouse "${code}" not found.`);
  res.json({ code: row.code, network: row.network, city: row.city, state: row.state, needsReview: row.needsReview });
});

// ── Per-brand settings ───────────────────────────────────────────────────────

opsRouter.get('/settings', async (req, res) => {
  const { brandId } = z.object({ brandId: brandIdSchema }).parse(req.query);
  res.json(await getBrandSettings(brandId));
});

opsRouter.patch('/settings', async (req, res) => {
  const { brandId } = z.object({ brandId: brandIdSchema }).parse(req.query);
  if (!(await getBrand(brandId))) throw new HttpError(404, `Brand "${brandId}" not found.`);
  const patch = z
    .object({
      criticalDays: z.number().int().min(1).max(365).optional(),
      excessDays: z.number().int().min(1).max(365).optional(),
      dueSoonDays: z.number().int().min(0).max(60).optional(),
      vcSalesMetric: z.string().trim().max(60).optional(),
      vcRevenueMetric: z.string().trim().max(60).optional(),
      stuckReceivingDays: z.number().int().min(1).max(120).optional(),
      workingTooLongDays: z.number().int().min(1).max(120).optional(),
      inTransitTooLongDays: z.number().int().min(1).max(120).optional(),
      fillGood: z.number().int().min(0).max(100).optional(),
      fillBad: z.number().int().min(0).max(100).optional(),
      notAcceptedBad: z.number().int().min(0).max(100).optional(),
      demandChangeAlert: z.number().int().min(0).max(200).optional(),
      noPoAlertDays: z.number().int().min(0).max(365).optional(),
      returnRateBad: z.number().int().min(0).max(100).optional(),
      agedShareBad: z.number().int().min(0).max(100).optional(),
    })
    .parse(req.body);
  res.json(await upsertBrandSettings(brandId, patch));
});

// ── Upload history ───────────────────────────────────────────────────────────

opsRouter.get('/uploads', async (req, res) => {
  const q = z
    .object({ brandId: brandIdSchema, limit: z.coerce.number().int().min(1).max(500).default(50) })
    .parse(req.query);
  const rows = await db
    .select()
    .from(importBatches)
    .where(eq(importBatches.brandId, q.brandId))
    .orderBy(desc(importBatches.createdAt))
    .limit(q.limit);
  const body: OpsUploadLogEntry[] = rows.map((r) => ({
    id: r.id,
    filename: r.filename,
    fileType: r.fileType,
    channel: r.channel,
    status: r.status,
    rows: r.rows,
    dateFrom: r.dateFrom,
    dateTo: r.dateTo,
    message: [r.message, r.identifierWarning].filter(Boolean).join(' | ') || null,
    createdAt: r.createdAt.toISOString(),
  }));
  res.json(body);
});

// ── Upload (Phase 1: detect, check brand, log; facts stored once parsers land) ──

const WH_CODE_COLUMNS: Partial<Record<string, string[]>> = {
  sc_ledger_summary: ['Location'],
  sc_ledger_detail: ['Fulfillment Center', 'Fulfilment Center'],
  sc_shipments: ['Destination'],
  vc_po: ['Ship-to location'],
};

const US_DATE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const RANGE = /Viewing\s*Range\s*=\s*\[\s*([0-9/]+)\s*[-–]\s*([0-9/]+)\s*\]/i;

const pad = (n: string) => n.padStart(2, '0');
const fromUs = (v: string) => {
  const m = v.trim().match(US_DATE);
  return m ? `${m[3]}-${pad(m[1]!)}-${pad(m[2]!)}` : null;
};
const fromIso = (v: string) => (ISO_DATE.test(v.trim()) ? v.trim() : null);
/** Retail Analytics metadata dates are DD/MM/YY. */
const fromDmy = (v: string) => {
  const p = v.trim().split('/');
  if (p.length !== 3) return null;
  const [d, mo, y] = p as [string, string, string];
  const yyyy = y.length === 2 ? `20${y}` : y;
  return `${yyyy}-${pad(mo)}-${pad(d)}`;
};

/** Best-effort date range for the preview, parsed per file type (correct calendar per Amazon's format). */
function previewDateRange(
  fileType: string,
  rows: readonly Row[],
  preamble: readonly string[]
): { from: string | null; to: string | null } {
  const collect = (col: string[], conv: (v: string) => string | null) => {
    const ds: string[] = [];
    for (const r of rows) {
      const iso = conv(str(pick(r, col)));
      if (iso) ds.push(iso);
    }
    ds.sort();
    return ds.length ? { from: ds[0]!, to: ds[ds.length - 1]! } : { from: null, to: null };
  };
  if (fileType === 'sc_ledger_summary') return collect(['Date'], fromUs);
  if (fileType === 'sc_fba_inventory') return collect(['snapshot-date'], fromIso);
  if (fileType === 'vc_inventory' || fileType === 'vc_sales') {
    const m = preamble.join(' ').match(RANGE);
    if (m) return { from: fromDmy(m[1]!), to: fromDmy(m[2]!) };
  }
  return { from: null, to: null };
}

opsRouter.post('/uploads', receiveFiles, async (req, res) => {
  const brandId = brandIdSchema.parse(req.body?.brandId ?? '');
  const brand = await getBrand(brandId);
  if (!brand) throw new HttpError(404, `Brand "${brandId}" not found \u2014 create it first.`);

  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  if (files.length === 0) throw new HttpError(400, 'Attach at least one .xlsx, .xls or .csv file in the "files" field.');

  interface Pending { label: string; sheet: SheetData; fileType: OpsFileType; channel: 'vc' | 'sc'; }
  const pending: Pending[] = [];
  const preResults: OpsUploadResult[] = [];
  const preBatches: (typeof importBatches.$inferInsert)[] = [];
  const vcWarehouseCodes = new Set<string>();

  const fail = (label: string, message: string) => {
    preResults.push({ filename: label, fileType: null, channel: null, status: 'error', message });
    preBatches.push({ id: randomUUID(), brandId, filename: label, fileType: null, channel: null, status: 'error', rows: 0, message });
  };

  for (const f of files) {
    const name = cleanFilename(f.originalname);
    if (!looksLikeSpreadsheet(f.buffer)) { fail(name, 'Not a spreadsheet or CSV file.'); continue; }
    let sheets: SheetData[];
    try {
      sheets = await ingestSlots.run(async () => readWorkbook(f.buffer));
    } catch (err) {
      fail(name, `Could not read file: ${(err as Error).message}`);
      continue;
    }
    for (const sheet of sheets) {
      const label = sheets.length > 1 ? `${name} \u203a ${sheet.sheetName.trim()}` : name;
      const detected = detectOpsFile(sheet.headers, sheet.preamble);
      if (!detected) {
        preResults.push({ filename: label, fileType: null, channel: null, status: 'skipped', headersFound: sheet.headers.length, message: 'Not an Inventory / PO / Shipment export \u2014 not recognised from its columns.' });
        preBatches.push({ id: randomUUID(), brandId, filename: label, fileType: null, channel: null, status: 'skipped', rows: sheet.rows.length, headersFound: sheet.headers.length, message: 'Unrecognised columns.' });
        continue;
      }
      pending.push({ label, sheet, fileType: detected.fileType, channel: detected.channel });
    }
  }

  const txResults: OpsUploadResult[] = [];

  await db.transaction(async (tx) => {
    const txBatches: (typeof importBatches.$inferInsert)[] = [];
    for (const p of pending) {
      const id = randomUUID();
      const idWarn = identifierWarning(brand, sniffIdentifier(p.fileType, p.sheet.rows, p.sheet.preamble));
      const ctx = { nameDates: datesFromFilename(p.label) ?? null, preamble: p.sheet.preamble };

      if (OPS_FILE_TYPES[p.fileType].inScope) {
        const out = await ingestScFile(tx, brandId, id, p.fileType, p.sheet, ctx);
        const status = out.error ? 'error' : 'stored';
        txResults.push({ filename: p.label, fileType: p.fileType, channel: p.channel, status, rows: out.rows, headersFound: p.sheet.headers.length, dateFrom: out.from, dateTo: out.to, identifierWarning: idWarn, message: out.error ?? 'Stored.', ...(out.warnings.length ? { warnings: out.warnings } : {}) });
        txBatches.push({ id, brandId, filename: p.label, fileType: p.fileType, channel: p.channel, status, rows: out.rows, headersFound: p.sheet.headers.length, dateFrom: out.from, dateTo: out.to, identifierWarning: idWarn, message: out.error ?? ([...out.warnings].join(' | ') || 'Stored.') });
      } else {
        const range = previewDateRange(p.fileType, p.sheet.rows, p.sheet.preamble);
        const cols = WH_CODE_COLUMNS[p.fileType];
        if (cols) for (const r of p.sheet.rows) { const c = normalizeFcCode(pick(r, cols)); if (c) vcWarehouseCodes.add(c); }
        txResults.push({ filename: p.label, fileType: p.fileType, channel: p.channel, status: 'recognized', rows: p.sheet.rows.length, headersFound: p.sheet.headers.length, dateFrom: range.from, dateTo: range.to, identifierWarning: idWarn, message: 'Recognised \u2014 Vendor Central parser lands in the next phase; nothing stored yet.' });
        txBatches.push({ id, brandId, filename: p.label, fileType: p.fileType, channel: p.channel, status: 'recognized', rows: p.sheet.rows.length, headersFound: p.sheet.headers.length, dateFrom: range.from, dateTo: range.to, identifierWarning: idWarn, message: 'Recognised (parser pending).' });
      }
    }
    const allBatches = [...preBatches, ...txBatches];
    if (allBatches.length) await tx.insert(importBatches).values(allBatches);
    if (vcWarehouseCodes.size) await ensureWarehouses(tx, vcWarehouseCodes);
    await recomputeBrandChannels(tx, brandId);
  });

  log.info('Ops upload processed', {
    user: requestUser(req),
    brandId,
    files: files.length,
    stored: txResults.filter((r) => r.status === 'stored').length,
    recognized: txResults.filter((r) => r.status === 'recognized').length,
  });

  const body: OpsUploadResponse = { brandId, files: [...preResults, ...txResults] };
  res.json(body);
});
