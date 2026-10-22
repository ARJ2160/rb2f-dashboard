import { randomUUID } from 'node:crypto';

import { REPORT_TYPES, type FileUploadResult } from '@dash/shared';

import { db } from '../db/client';
import { uploads } from '../db/schema';
import { datesFromFilename } from '../lib/dates';
import { detectAdChannel, detectReportType } from './detect-report';

const PREVIEW_ROWS = 30;
import { parseAsinMapper } from './parsers/asin-mapper';
import { parseBusinessReport } from './parsers/business-report';
import { parseCampaignReport } from './parsers/campaign';
import type { ParseContext, ParseResult } from './parsers/types';
import { parseVendorCentral } from './parsers/vendor-central';
import { readWorkbook, type SheetData } from './sheet-reader';
import {
  storeAds,
  storeAsinAds,
  storeCampaignAttrs,
  storeHourly,
  storeAsinMapper,
  storeCampaignMapper,
  storePlacements,
  storeSales,
  storeSbAttributed,
  storeSearchTerms,
  storeStateSales,
} from './store';
import { parseAdvertisedProduct } from './parsers/advertised-product';
import { parseSbAttributed } from './parsers/sb-attributed';
import { parseCampaignMapper } from './parsers/campaign-mapper';
import { parseOrderReport } from './parsers/order-report';
import { parsePlacements } from './parsers/placement';
import { parseSearchTerms } from './parsers/search-term';

/**
 * Upload pipeline:  file → sheets → detect report type → parse → store by date.
 *
 * A workbook can hold one report (the normal Seller Central export) or many
 * (a combined workbook with one tab per report); every sheet is handled
 * independently, so one bad tab never blocks the rest of the batch.
 */
export async function ingestFile(profileId: string, filename: string, buffer: Buffer): Promise<FileUploadResult[]> {
  let sheets: SheetData[];
  try {
    // Cheap preview first; only parse every row if some sheet is a report we ingest.
    const preview = readWorkbook(buffer, { maxRows: PREVIEW_ROWS });
    const needsFull = preview.some((s) => {
      const d = detectReportType(s.headers, s.sheetName, filename);
      return d != null && REPORT_TYPES[d.reportType].inScope;
    });
    sheets = needsFull ? readWorkbook(buffer) : preview;
  } catch (err) {
    const r: FileUploadResult = { filename, status: 'error', message: `Could not read file: ${(err as Error).message}` };
    await log(profileId, r);
    return [r];
  }
  if (sheets.length === 0) {
    const r: FileUploadResult = { filename, status: 'skipped', message: 'File contains no data.' };
    await log(profileId, r);
    return [r];
  }

  const multi = sheets.length > 1;
  const results: FileUploadResult[] = [];
  for (const sheet of sheets) {
    const label = multi ? `${filename} › ${sheet.sheetName.trim()}` : filename;
    const uploadId = randomUUID();
    let result: FileUploadResult;
    try {
      result = await ingestSheet(profileId, filename, label, sheet, uploadId);
    } catch (err) {
      result = { filename: label, status: 'error', message: `Failed to store: ${(err as Error).message}` };
    }
    await log(profileId, result, multi ? sheet.sheetName : null, uploadId);
    results.push(result);
  }
  return results;
}

async function ingestSheet(
  profileId: string,
  filename: string,
  label: string,
  sheet: SheetData,
  uploadId: string
): Promise<FileUploadResult> {
  const detected = detectReportType(sheet.headers, sheet.sheetName, filename);
  if (!detected) {
    return {
      filename: label,
      status: 'skipped',
      ...(sheet.partial ? {} : { rowsRead: sheet.rows.length }),
      message: 'Could not recognise this report from its columns or name.',
    };
  }
  const { reportType, detectedBy } = detected;
  const base: Omit<FileUploadResult, 'status'> = {
    filename: label,
    reportType,
    detectedBy,
    ...(sheet.partial ? {} : { rowsRead: sheet.rows.length }),
  };

  if (!REPORT_TYPES[reportType].inScope) {
    return {
      ...base,
      status: 'skipped',
      message: `${REPORT_TYPES[reportType].label} is recognised but not used yet — DSR/DUR don't need it. Nothing was stored from this file.`,
    };
  }
  if (sheet.rows.length === 0) return { ...base, status: 'skipped', message: 'Sheet has a header but no rows.' };

  const ctx: ParseContext = {
    nameDates: datesFromFilename(sheet.sheetName) ?? datesFromFilename(filename),
    preamble: sheet.preamble,
  };
  const finish = (parsed: ParseResult<object>, write: () => Promise<void>) => finalize(base, parsed, write);

  switch (reportType) {
    case 'business_report': {
      const parsed = parseBusinessReport(sheet.headers, sheet.rows, ctx);
      return finish(parsed, () => db.transaction((tx) => storeSales(tx, profileId, uploadId, 'seller', parsed.records)));
    }
    case 'vendor_central': {
      const parsed = parseVendorCentral(sheet.headers, sheet.rows, ctx);
      return finish(parsed, () =>
        db.transaction(async (tx) => {
          await storeSales(tx, profileId, uploadId, 'vendor', parsed.records);
          if (parsed.states.length) await storeStateSales(tx, profileId, uploadId, 'vendor', parsed.states);
        })
      );
    }
    case 'sp_campaign':
    case 'sb_campaign':
    case 'sd_campaign': {
      const channel = (reportType.slice(0, 2) as 'sp' | 'sb' | 'sd');
      const parsed = parseCampaignReport(channel, sheet.headers, sheet.rows, ctx);
      const headerChannel = detectAdChannel(sheet.headers);
      if (headerChannel && headerChannel !== channel) {
        parsed.warnings.push(`Columns look like ${headerChannel.toUpperCase()} but the name says ${channel.toUpperCase()}.`);
      }
      return finish(parsed, () =>
        db.transaction(async (tx) => {
          await storeAds(tx, profileId, uploadId, channel, parsed.records);
          if (parsed.hourly.length) await storeHourly(tx, profileId, uploadId, channel, parsed.hourly);
          await storeCampaignAttrs(tx, profileId, parsed.attrs);
        })
      );
    }
    case 'sp_advertised_product':
    case 'sd_advertised_product': {
      const channel = reportType === 'sp_advertised_product' ? 'sp' : 'sd';
      const parsed = parseAdvertisedProduct(channel, sheet.headers, sheet.rows, ctx);
      return finish(parsed, () =>
        db.transaction(async (tx) => {
          await storeAsinAds(tx, profileId, uploadId, channel, parsed.records);
          await storeCampaignAttrs(tx, profileId, parsed.attrs);
        })
      );
    }
    case 'sb_attributed_purchase': {
      const parsed = parseSbAttributed(sheet.rows, ctx);
      return finish(parsed, () => db.transaction((tx) => storeSbAttributed(tx, profileId, uploadId, parsed.records)));
    }
    case 'sp_search_term':
    case 'sb_search_term':
    case 'sd_targeting': {
      const channel = reportType === 'sp_search_term' ? 'sp' : reportType === 'sb_search_term' ? 'sb' : 'sd';
      const parsed = parseSearchTerms(channel, sheet.headers, sheet.rows, ctx);
      return finish(parsed, () => db.transaction((tx) => storeSearchTerms(tx, profileId, uploadId, channel, parsed.records)));
    }
    case 'sp_placement':
    case 'sb_placement': {
      const channel = reportType === 'sp_placement' ? 'sp' : 'sb';
      const parsed = parsePlacements(channel, sheet.headers, sheet.rows, ctx);
      return finish(parsed, () => db.transaction((tx) => storePlacements(tx, profileId, uploadId, channel, parsed.records)));
    }
    case 'order_report': {
      const parsed = parseOrderReport(sheet.rows, ctx);
      return finish(parsed, () => db.transaction((tx) => storeStateSales(tx, profileId, uploadId, 'seller', parsed.records)));
    }
    case 'campaign_mapper': {
      const parsed = parseCampaignMapper(sheet.rows);
      return finish(parsed, () => db.transaction((tx) => storeCampaignMapper(tx, profileId, parsed.records)));
    }
    case 'asin_mapper': {
      const parsed = parseAsinMapper(sheet.headers, sheet.rows);
      return finish(parsed, () => db.transaction((tx) => storeAsinMapper(tx, profileId, parsed.records)));
    }
    default:
      throw new Error(`No ingester wired for in-scope report type "${reportType}"`);
  }
}

export async function finalize(
  base: Omit<FileUploadResult, 'status'>,
  parsed: ParseResult<object>,
  write: () => Promise<void>
): Promise<FileUploadResult> {
  const withWarnings = parsed.warnings.length ? { warnings: parsed.warnings } : {};
  if (parsed.error) return { ...base, ...withWarnings, status: 'error', message: parsed.error };
  if (parsed.records.length === 0) return { ...base, ...withWarnings, status: 'skipped', message: 'No usable rows.' };

  try {
    await write();
  } catch (err) {
    return { ...base, ...withWarnings, status: 'error', message: `Failed to store: ${(err as Error).message}` };
  }
  const dates = parsed.records
    .map((r) => ('date' in r ? (r.date as string) : null))
    .filter((d): d is string => !!d)
    .sort();
  return {
    ...base,
    ...withWarnings,
    status: 'stored',
    rowsStored: parsed.records.length,
    ...(dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : {}),
  };
}

/** Write one entry to the upload audit log (never throws). */
export async function log(
  profileId: string,
  r: FileUploadResult,
  sheet: string | null = null,
  id: string = randomUUID()
): Promise<void> {
  try {
    await db.insert(uploads).values({
      id,
      profileId,
      filename: r.filename,
      sheet,
      reportType: r.reportType ?? null,
      status: r.status,
      dateFrom: r.from ?? null,
      dateTo: r.to ?? null,
      rowsRead: r.rowsRead ?? 0,
      rowsStored: r.rowsStored ?? 0,
      message: [r.message, ...(r.warnings ?? [])].filter(Boolean).join(' | ') || null,
    });
  } catch (err) {
    console.error('[uploads] failed to write log entry', err);
  }
}
