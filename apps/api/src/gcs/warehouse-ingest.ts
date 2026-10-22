import { randomUUID } from 'node:crypto';

import type { AdChannel, FileUploadResult, ReportType } from '@dash/shared';
import { eq } from 'drizzle-orm';

import { db } from '../db/client';
import { campaignAttrs, products } from '../db/schema';
import { detectByHeaders } from '../ingestion/detect-report';
import { finalize, ingestFile, log } from '../ingestion/ingest.service';
import { parseAdvertisedProduct } from '../ingestion/parsers/advertised-product';
import { parseBusinessReport } from '../ingestion/parsers/business-report';
import { campaignKeyOf } from '../ingestion/parsers/campaign-mapper';
import { parseCampaignReport } from '../ingestion/parsers/campaign';
import { parsePlacements } from '../ingestion/parsers/placement';
import { parseSearchTerms } from '../ingestion/parsers/search-term';
import type { ParseContext } from '../ingestion/parsers/types';
import { readWorkbook, type SheetData } from '../ingestion/sheet-reader';
import { pick, str } from '../lib/values';
import {
  storeAds,
  storeAsinAds,
  storeCampaignAttrs,
  storePlacements,
  storeSales,
  storeSearchTerms,
} from '../ingestion/store';
import {
  buildTitleIndex,
  channelFromCampaignName,
  detectWarehouseAdKind,
  hasDayOfMonthDates,
  resolveDayOfMonth,
  toClassicByChannel,
  toUtf8Csv,
  warehouseNameDates,
  UNRESOLVED_ASIN,
  type WarehouseAdKind,
} from './warehouse';

/**
 * GCS-only ingest: understands the warehouse formats (see warehouse.ts) and
 * stores them with the same parsers / tables as manual uploads. Anything that
 * is not a warehouse format (ASIN / campaign mappers, classic exports) goes
 * through the normal upload pipeline unchanged.
 */
export async function ingestWarehouseFile(
  profileId: string,
  filename: string,
  raw: Buffer
): Promise<FileUploadResult[]> {
  const buffer = toUtf8Csv(raw);
  let sheets: SheetData[];
  try {
    sheets = readWorkbook(buffer);
  } catch (err) {
    const r: FileUploadResult = {
      filename,
      status: 'error',
      message: `Could not read file: ${(err as Error).message}`,
    };
    await log(profileId, r);
    return [r];
  }

  const warehouse = sheets.filter((s) => detectWarehouseAdKind(s.headers) || isDayOfMonthBusinessReport(s));
  if (warehouse.length === 0) return ingestFile(profileId, filename, buffer);

  const results: FileUploadResult[] = [];
  for (const sheet of sheets) {
    const kind = detectWarehouseAdKind(sheet.headers);
    let out: FileUploadResult[];
    try {
      if (kind) out = await ingestAdSheet(profileId, filename, sheet, kind);
      else if (isDayOfMonthBusinessReport(sheet))
        out = [await ingestBusinessReport(profileId, filename, sheet)];
      else
        out = [
          {
            filename,
            status: 'skipped',
            rowsRead: sheet.rows.length,
            message: 'Could not recognise this sheet.',
          },
        ];
    } catch (err) {
      out = [{ filename, status: 'error', message: `Failed to store: ${(err as Error).message}` }];
    }
    for (const r of out) {
      await log(profileId, r);
      results.push(r);
    }
  }
  return results;
}

function isDayOfMonthBusinessReport(s: SheetData): boolean {
  return detectByHeaders(s.headers) === 'business_report' && hasDayOfMonthDates(s.headers, s.rows);
}

const NO_NAME_DATES: ParseContext = { nameDates: null, preamble: [] };

const REPORT_TYPE: Record<WarehouseAdKind, Record<AdChannel, ReportType>> = {
  campaign: { sp: 'sp_campaign', sb: 'sb_campaign', sd: 'sd_campaign' },
  advertised: { sp: 'sp_advertised_product', sb: 'sb_advertised_product', sd: 'sd_advertised_product' },
  placement: { sp: 'sp_placement', sb: 'sb_placement', sd: 'sp_placement' },
  search_term: { sp: 'sp_search_term', sb: 'sb_search_term', sd: 'sd_targeting' },
};

/** Channel of a campaign: the campaign export's "Ad product" (stored as campaign_attrs), else the RB name token. */
async function channelResolver(profileId: string): Promise<(name: string) => AdChannel | null> {
  const attrs = await db
    .select({ key: campaignAttrs.campaignKey, channel: campaignAttrs.channel })
    .from(campaignAttrs)
    .where(eq(campaignAttrs.profileId, profileId));
  const known = new Map(attrs.map((a) => [a.key, a.channel as AdChannel]));
  return (name) => known.get(campaignKeyOf(name)) ?? channelFromCampaignName(name);
}

/** Title → ASIN from the file's own rows that carry an ID, plus product titles already known for the profile. */
async function titleResolver(profileId: string, sheet: SheetData): Promise<(title: string) => string | null> {
  const known = await db
    .select({ asin: products.asin, mapperTitle: products.mapperTitle, reportTitle: products.reportTitle })
    .from(products)
    .where(eq(products.profileId, profileId));
  const pairs: Array<[string, string]> = [];
  for (const r of sheet.rows) {
    const id = str(pick(r, ['Advertised product ID']));
    if (id) pairs.push([str(pick(r, ['Advertised product name'])), id]);
  }
  for (const p of known) {
    if (p.reportTitle) pairs.push([p.reportTitle, p.asin]);
    if (p.mapperTitle) pairs.push([p.mapperTitle, p.asin]);
  }
  return buildTitleIndex(pairs);
}

async function ingestAdSheet(
  profileId: string,
  filename: string,
  sheet: SheetData,
  kind: WarehouseAdKind
): Promise<FileUploadResult[]> {
  const resolve = kind === 'campaign' ? () => null : await channelResolver(profileId);
  const byTitle = kind === 'advertised' ? await titleResolver(profileId, sheet) : undefined;
  const { byChannel, undated, unknownChannel, unresolvedAsin } = toClassicByChannel(
    kind,
    sheet.rows,
    resolve,
    byTitle
  );
  const fileWarnings: string[] = [];
  if (unresolvedAsin) {
    fileWarnings.push(
      `${unresolvedAsin} advertised row(s) have no product ID and a product name that matches no known ASIN — stored under ASIN "${UNRESOLVED_ASIN}" (counted in totals, category "Unmapped").`
    );
  }
  if (undated) fileWarnings.push(`${undated} row(s) skipped: no valid Day of Month / Month / Year.`);
  if (unknownChannel) {
    fileWarnings.push(
      `${unknownChannel} row(s) skipped: their campaign is not in the campaign export and its name has no SP/SB/SD token — sync the campaign file first.`
    );
  }
  if (byChannel.size === 0) {
    return [
      {
        filename,
        status: 'error',
        rowsRead: sheet.rows.length,
        message: 'No dated campaign rows could be read.',
        ...(fileWarnings.length ? { warnings: fileWarnings } : {}),
      },
    ];
  }

  const results: FileUploadResult[] = [];
  for (const [channel, classic] of byChannel) {
    const label = byChannel.size > 1 ? `${filename} › ${channel.toUpperCase()}` : filename;
    const uploadId = randomUUID();
    const base: Omit<FileUploadResult, 'status'> = {
      filename: label,
      reportType: REPORT_TYPE[kind][channel],
      detectedBy: 'headers',
      rowsRead: classic.rows.length,
    };
    const withFileWarnings = (r: FileUploadResult): FileUploadResult =>
      fileWarnings.length && results.length === 0
        ? { ...r, warnings: [...fileWarnings, ...(r.warnings ?? [])] }
        : r;

    let r: FileUploadResult;
    switch (kind) {
      case 'campaign': {
        const parsed = parseCampaignReport(channel, classic.headers, classic.rows, NO_NAME_DATES);
        r = await finalize(base, parsed, () =>
          db.transaction(async (tx) => {
            await storeAds(tx, profileId, uploadId, channel, parsed.records);
            await storeCampaignAttrs(tx, profileId, parsed.attrs);
          })
        );
        break;
      }
      case 'advertised': {
        // SB rows carry their own spend here, so SB is stored at ASIN level like SP / SD.
        const parsed = parseAdvertisedProduct(channel, classic.headers, classic.rows, NO_NAME_DATES);
        r = await finalize(base, parsed, () =>
          db.transaction(async (tx) => {
            await storeAsinAds(tx, profileId, uploadId, channel, parsed.records);
            await storeCampaignAttrs(tx, profileId, parsed.attrs);
          })
        );
        break;
      }
      case 'placement': {
        if (channel === 'sd') {
          r = {
            ...base,
            status: 'skipped',
            message: 'SD placement rows are not used (the Placements view covers SP + SB).',
          };
          break;
        }
        const parsed = parsePlacements(channel, classic.headers, classic.rows, NO_NAME_DATES);
        r = await finalize(base, parsed, () =>
          db.transaction((tx) => storePlacements(tx, profileId, uploadId, channel, parsed.records))
        );
        break;
      }
      case 'search_term': {
        const parsed = parseSearchTerms(channel, classic.headers, classic.rows, NO_NAME_DATES);
        r = await finalize(base, parsed, () =>
          db.transaction((tx) => storeSearchTerms(tx, profileId, uploadId, channel, parsed.records))
        );
        break;
      }
    }
    results.push(withFileWarnings(r));
  }
  return results;
}

async function ingestBusinessReport(
  profileId: string,
  filename: string,
  sheet: SheetData
): Promise<FileUploadResult> {
  const base: Omit<FileUploadResult, 'status'> = {
    filename,
    reportType: 'business_report',
    detectedBy: 'headers',
    rowsRead: sheet.rows.length,
  };
  const range = warehouseNameDates(filename);
  if (!range) {
    return {
      ...base,
      status: 'error',
      message:
        'The Business Report "Date" column holds only the day of the month, and the file name has no date range (…_YYYYMMDD_YYYYMMDD.csv) to take the month and year from.',
    };
  }
  const { rows, outOfRange } = resolveDayOfMonth(sheet.rows, range);
  const parsed = parseBusinessReport(sheet.headers, rows, NO_NAME_DATES);
  if (outOfRange)
    parsed.warnings.unshift(
      `${outOfRange} row(s) fall outside ${range.from} → ${range.to} and were skipped.`
    );
  const uploadId = randomUUID();
  return finalize(base, parsed, () =>
    db.transaction((tx) => storeSales(tx, profileId, uploadId, 'seller', parsed.records))
  );
}
