import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseBusinessReport } from '../src/ingestion/parsers/business-report';
import { parseCampaignReport } from '../src/ingestion/parsers/campaign';
import { parseVendorCentral } from '../src/ingestion/parsers/vendor-central';

const oneDay = { nameDates: { from: '2026-04-10', to: '2026-04-10' }, preamble: [] };
const range = { nameDates: { from: '2026-04-01', to: '2026-04-30' }, preamble: [] };

test('business report: no date column → single-day filename date; currency/commas parsed', () => {
  const headers = ['(Parent) ASIN', '(Child) ASIN', 'Title', 'Sessions - Total', 'Page Views - Total', 'Units Ordered', 'Ordered Product Sales', 'Total Order Items'];
  const rows = [
    { '(Parent) ASIN': 'B0P', '(Child) ASIN': 'b0a', Title: 'Shampoo', 'Sessions - Total': '1,336', 'Page Views - Total': 451, 'Units Ordered': 11, 'Ordered Product Sales': '₹9,549.13', 'Total Order Items': 10 },
    { '(Parent) ASIN': '', '(Child) ASIN': '', Title: 'Lost row', 'Sessions - Total': 5, 'Page Views - Total': 7, 'Units Ordered': 1, 'Ordered Product Sales': '₹100', 'Total Order Items': 1 },
  ];
  const r = parseBusinessReport(headers, rows, oneDay);
  assert.equal(r.error, undefined);
  assert.equal(r.records.length, 2);
  const a = r.records.find((x) => x.asin === 'B0A')!;
  assert.deepEqual(
    { date: a.date, sales: a.sales, units: a.units, orderItems: a.orderItems, sessions: a.sessions, pageViews: a.pageViews, source: a.source },
    { date: '2026-04-10', sales: 9549.13, units: 11, orderItems: 10, sessions: 1336, pageViews: 451, source: 'seller' }
  );
  assert.ok(r.records.some((x) => x.asin === ''), 'blank-ASIN row kept');
});

test('business report: multi-day file without a date column is rejected, not mis-dated', () => {
  const r = parseBusinessReport(['(Child) ASIN', 'Units Ordered', 'Ordered Product Sales'], [{ '(Child) ASIN': 'B0A', 'Units Ordered': 1, 'Ordered Product Sales': 1 }], range);
  assert.ok(r.error);
  assert.equal(r.records.length, 0);
});

test('vendor central: per-row dates, no sessions, glance views as page views', () => {
  const headers = ['Date', 'ASIN', 'Product Title', 'Ordered Revenue', 'Ordered Units', 'Glance Views'];
  const rows = [
    { Date: '01/04/2026', ASIN: 'B0A0000001', 'Product Title': 'Shampoo', 'Ordered Revenue': '₹1,000.50', 'Ordered Units': 3, 'Glance Views': 40 },
    { Date: '02/04/2026', ASIN: 'B0A0000001', 'Product Title': 'Shampoo', 'Ordered Revenue': '500', 'Ordered Units': 1, 'Glance Views': '' },
  ];
  const r = parseVendorCentral(headers, rows, range);
  assert.equal(r.records.length, 2);
  const d1 = r.records.find((x) => x.date === '2026-04-01')!;
  assert.equal(d1.sales, 1000.5);
  assert.equal(d1.sessions, null);
  assert.equal(d1.orderItems, null);
  assert.equal(d1.pageViews, 40);
});

test('vendor central: single-day "Viewing Range" preamble dates the file', () => {
  const r = parseVendorCentral(['ASIN', 'Ordered Revenue', 'Ordered Units'], [{ ASIN: 'B0A0000001', 'Ordered Revenue': 10, 'Ordered Units': 1 }], {
    nameDates: null,
    preamble: ['Program=[Retail]', 'Viewing Range=[10/04/2026 - 10/04/2026]'],
  });
  assert.equal(r.error, undefined);
  assert.equal(r.records[0]!.date, '2026-04-10');
});

test('campaign: Start Date == End Date → that day; units fall back to orders when absent', () => {
  const headers = ['Start Date', 'End Date', 'Program Type', 'Campaign Name', 'Impressions', 'Clicks', 'Spend', '7 Day Total Orders (#)', '7 Day Total Sales'];
  const rows = [
    { 'Start Date': 46122, 'End Date': 46122, 'Campaign Name': 'C1', Impressions: 28, Clicks: 2, Spend: '₹55.21', '7 Day Total Orders (#)': 1, '7 Day Total Sales': '₹1,200.00' },
    { 'Start Date': 46122, 'End Date': 46122, 'Campaign Name': 'C1', Impressions: 2, Clicks: 0, Spend: '₹0.00', '7 Day Total Orders (#)': 0, '7 Day Total Sales': '₹0.00' },
    { 'Start Date': 46100, 'End Date': 46122, 'Campaign Name': 'C2', Impressions: 9, Clicks: 1, Spend: 1, '7 Day Total Orders (#)': 0, '7 Day Total Sales': 0 },
  ];
  const r = parseCampaignReport('sp', headers, rows, range);
  assert.equal(r.records.length, 1, 'multi-day row skipped when file spans many days');
  assert.deepEqual(r.records[0], { date: '2026-04-10', channel: 'sp', campaignName: 'C1', impressions: 30, clicks: 2, spend: 55.21, adSales: 1200, adUnits: 1 });
  assert.ok(r.warnings.some((w) => /Total Orders/.test(w)));
  assert.ok(r.warnings.some((w) => /span several days/.test(w)));
});
