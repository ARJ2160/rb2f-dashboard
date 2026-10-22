import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseAdvertisedProduct } from '../src/ingestion/parsers/advertised-product';
import { parseSbAttributed } from '../src/ingestion/parsers/sb-attributed';

const ctx = { nameDates: null, preamble: [] };

test('advertised product: per day × campaign × ASIN; 14-day columns; Click-only columns ignored', () => {
  const headers = ['Date', 'Campaign Name', 'Advertised ASIN', 'Impressions', 'Clicks', 'Spend', '14 Day Total Sales (₹)', '14 Day Total Units (#)', '14 Day Total Sales – (Click)'];
  const rows = [
    { Date: 46276, 'Campaign Name': 'C1', 'Advertised ASIN': 'B0BQCRK79V', Impressions: 443, Clicks: 4, Spend: 27.05, '14 Day Total Sales (₹)': 0, '14 Day Total Units (#)': 0, '14 Day Total Sales – (Click)': 999 },
    { Date: 46276, 'Campaign Name': 'C2', 'Advertised ASIN': 'B0BQCRK79V', Impressions: 100, Clicks: 2, Spend: '₹10.00', '14 Day Total Sales (₹)': '₹2,299', '14 Day Total Units (#)': 1, '14 Day Total Sales – (Click)': 999 },
    { Date: 46276, 'Campaign Name': 'C3', 'Advertised ASIN': '', Impressions: 5, Clicks: 0, Spend: 1, '14 Day Total Sales (₹)': 0, '14 Day Total Units (#)': 0 },
  ];
  const r = parseAdvertisedProduct('sp', headers, rows, ctx);
  assert.deepEqual(r.records, [
    { date: '2026-09-11', campaignName: 'C1', asin: 'B0BQCRK79V', impressions: 443, clicks: 4, spend: 27.05, adSales: 0, adUnits: 0 },
    { date: '2026-09-11', campaignName: 'C2', asin: 'B0BQCRK79V', impressions: 100, clicks: 2, spend: 10, adSales: 2299, adUnits: 1 },
  ]);
});

test('SB attributed purchases: Promoted + Brand Halo kept, keyed by campaign × ASIN × day', () => {
  const rows = [
    { Date: 'Aug 1, 2026', 'Campaign Name': 'RB /SB /KT/ Mens running/ Branded', 'Attribution type': 'Promoted', 'Purchased ASIN': 'B0C5NDQP6N', '14 Day Total Sales (₹)': '₹2038.1', '14 Day Total Units (#)': 1 },
    { Date: 'Aug 1, 2026', 'Campaign Name': 'RB /SB /KT/ Mens running/ Branded', 'Attribution type': 'Brand Halo', 'Purchased ASIN': 'B0C5NDQP6N', '14 Day Total Sales (₹)': '₹100', '14 Day Total Units (#)': 1 },
  ];
  const r = parseSbAttributed(rows, ctx);
  assert.deepEqual(r.records, [
    { date: '2026-08-01', campaignName: 'RB /SB /KT/ Mens running/ Branded', asin: 'B0C5NDQP6N', adSales: 2138.1, adUnits: 2 },
  ]);
});
