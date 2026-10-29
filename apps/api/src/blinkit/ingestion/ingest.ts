import { BK_REPORT_LABEL, normKey, type BkReportType } from '@dash/shared/blinkit';

import { toUtf8Csv } from '../../gcs/warehouse';
import { invalidateDims } from '../reports/dims';
import { detectReport } from './detect-report';
import { parseAds, type AdType } from './parsers/ads';
import { parseInventory } from './parsers/inventory';
import { parseCampaignMapper, parseSkuMapper } from './parsers/mappers';
import { parseSales } from './parsers/sales';
import { readBlinkitWorkbook } from './sheet-reader';
import { storeAds, storeCampaignMap, storeInventory, storeSales, storeSkuMap } from './store';

/** Same shape as the Amazon FileUploadResult, with Blinkit report types. */
export interface BkFileResult {
  filename: string;
  sheet?: string;
  status: 'stored' | 'skipped' | 'error';
  reportType?: BkReportType;
  from?: string;
  to?: string;
  rowsRead?: number;
  rowsStored?: number;
  message?: string;
  warnings?: string[];
}

const AD_TYPES: Partial<Record<BkReportType, AdType>> = {
  bk_ads_product_listing: 'PL',
  bk_ads_product_reco: 'PR',
  bk_ads_banner_listing: 'BL',
};

/**
 * One Blinkit file (any sheet count) → detect each sheet by its columns →
 * parse → replace-by-date store. Used by the GCS sync (`<brand>/blinkit/…`)
 * and POST /api/blinkit/uploads.
 */
export async function ingestBlinkitFile(profileId: string, filename: string, raw: Buffer): Promise<BkFileResult[]> {
  const results: BkFileResult[] = [];
  let read: ReturnType<typeof readBlinkitWorkbook>;
  try {
    read = readBlinkitWorkbook(toUtf8Csv(raw), filename);
  } catch (err) {
    return [{ filename, status: 'error', message: `Could not read file: ${(err as Error).message}` }];
  }
  if (read.skippedTabs.length)
    results.push({
      filename,
      status: 'skipped',
      message: `Large workbook: ${read.skippedTabs.length} tab(s) not scanned — only mapper / inventory / report tabs are read.`,
    });

  for (const s of read.sheets) {
    const type = detectReport(s);
    const base = { filename, sheet: s.sheetName, reportType: type, rowsRead: s.rows.length };
    const span = (dates: string[]) => (dates.length ? { from: dates[0]!, to: dates[dates.length - 1]! } : {});
    try {
      if (type === 'unknown') {
        results.push({ ...base, status: 'skipped', message: `Sheet "${s.sheetName}" is not a recognised Blinkit report (columns did not match).` });
        continue;
      }
      let stored = 0;
      let dates: string[] = [];
      let warnings: string[] = [];
      const adType = AD_TYPES[type];
      if (type === 'bk_sales') {
        const p = parseSales(s);
        ({ dates, warnings } = p);
        if (p.records.length) stored = await storeSales(profileId, p.dates, p.records);
      } else if (adType) {
        const p = parseAds(s, adType);
        ({ dates, warnings } = p);
        if (p.records.length) stored = await storeAds(profileId, adType, p.dates, p.records);
      } else if (type === 'bk_inventory') {
        const p = parseInventory(s);
        ({ dates, warnings } = p);
        if (p.records.length && p.dates[0]) stored = await storeInventory(profileId, p.dates[0], p.records);
      } else if (type === 'bk_sku_mapper') {
        const p = parseSkuMapper(s);
        warnings = p.warnings;
        if (p.records.length) stored = await storeSkuMap(profileId, p.records);
      } else if (type === 'bk_campaign_mapper') {
        const p = parseCampaignMapper(s);
        warnings = p.warnings;
        // source = the sheet (or the file, for a CSV) so a city mapper and a category mapper don't overwrite each other
        const isCsv = read.sheets.length === 1 && /\.csv$/i.test(filename);
        const source = normKey(isCsv ? filename.replace(/^.*\//, '').replace(/[_-]?\d{4}.*$/, '') : s.sheetName) || 'campaign mapper';
        if (p.records.length) stored = await storeCampaignMap(profileId, source, p.records);
      }
      results.push({
        ...base,
        status: stored ? 'stored' : 'skipped',
        rowsStored: stored,
        ...span(dates),
        ...(stored ? {} : { message: `${BK_REPORT_LABEL[type]}: nothing stored.` }),
        ...(warnings.length ? { warnings } : {}),
      });
    } catch (err) {
      results.push({ ...base, status: 'error', message: (err as Error).message });
    }
  }
  if (results.some((r) => r.status === 'stored')) invalidateDims(profileId);
  return results;
}
