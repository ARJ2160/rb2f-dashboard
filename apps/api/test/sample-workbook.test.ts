/**
 * Optional smoke test against a real combined workbook:
 *   SAMPLE_XLSX="/path/to/RB2F__YPLAYZ__10 april- data.xlsx" npm test -w @dash/api
 * Skipped when SAMPLE_XLSX is not set.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';

import { datesFromFilename } from '../src/lib/dates';
import { detectReportType } from '../src/ingestion/detect-report';
import { parseBusinessReport } from '../src/ingestion/parsers/business-report';
import { parseCampaignReport } from '../src/ingestion/parsers/campaign';
import { readWorkbook } from '../src/ingestion/sheet-reader';

const file = process.env.SAMPLE_XLSX;

test('real workbook: every sheet detected; business + campaign sheets parse', { skip: !file }, () => {
  const name = path.basename(file!);
  const sheets = readWorkbook(readFileSync(file!));
  const nameDates = datesFromFilename(name);
  for (const s of sheets) {
    const d = detectReportType(s.headers, s.sheetName, name);
    const ctx = { nameDates: datesFromFilename(s.sheetName) ?? nameDates, preamble: s.preamble };
    let summary = '';
    if (d?.reportType === 'business_report') {
      const r = parseBusinessReport(s.headers, s.rows, ctx);
      assert.equal(r.error, undefined);
      const sales = r.records.reduce((a, x) => a + x.sales, 0);
      const units = r.records.reduce((a, x) => a + x.units, 0);
      summary = `asins=${r.records.length} sales=${sales.toFixed(2)} units=${units}`;
    }
    if (d && /^s[pbd]_campaign$/.test(d.reportType)) {
      const r = parseCampaignReport(d.reportType.slice(0, 2) as 'sp', s.headers, s.rows, ctx);
      const spend = r.records.reduce((a, x) => a + x.spend, 0);
      const adSales = r.records.reduce((a, x) => a + x.adSales, 0);
      summary = `campaigns=${r.records.length} spend=${spend.toFixed(2)} adSales=${adSales.toFixed(2)} ${r.warnings.join('; ')}`;
    }
    console.log(`  [${s.sheetName}] rows=${s.rows.length} → ${d ? `${d.reportType} (${d.detectedBy})` : 'unrecognised'} ${summary}`);
  }
});
