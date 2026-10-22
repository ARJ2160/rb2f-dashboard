import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseCampaignMapper } from '../src/ingestion/parsers/campaign-mapper';
import { parseOrderReport } from '../src/ingestion/parsers/order-report';
import { normalizePlacement, parsePlacements } from '../src/ingestion/parsers/placement';
import { parseSearchTerms } from '../src/ingestion/parsers/search-term';
import { parseVendorCentral } from '../src/ingestion/parsers/vendor-central';

const ctx = { nameDates: null, preamble: [] };

test('search terms: ad groups summed, Excel apostrophe stripped, target kept separately', () => {
  const headers = ['Date', 'Campaign Name', 'Ad Group Name', 'Targeting', 'Match Type', 'Customer Search Term', 'Impressions', 'Clicks', 'Spend', '14 Day Total Sales (₹)', '14 Day Total Units (#)'];
  const rows = [
    { Date: 46279, 'Campaign Name': 'C1', 'Ad Group Name': 'AG1', Targeting: 'close-match', 'Match Type': '-', 'Customer Search Term': "'shoes for men", Impressions: 4, Clicks: 1, Spend: 4.68, '14 Day Total Sales (₹)': 0, '14 Day Total Units (#)': 0 },
    { Date: 46279, 'Campaign Name': 'C1', 'Ad Group Name': 'AG2', Targeting: 'close-match', 'Match Type': '-', 'Customer Search Term': 'Shoes  for Men', Impressions: 6, Clicks: 2, Spend: '₹10', '14 Day Total Sales (₹)': '₹2,299', '14 Day Total Units (#)': 1 },
  ];
  const r = parseSearchTerms('sp', headers, rows, ctx);
  assert.deepEqual(r.records, [
    { date: '2026-09-14', channel: 'sp', campaignName: 'C1', target: 'close-match', matchType: '-', searchTerm: 'shoes for men', impressions: 10, clicks: 3, spend: 14.68, adSales: 2299, adUnits: 1 },
  ]);
});

test('SD targeting: search term = target', () => {
  const r = parseSearchTerms('sd', ['Date', 'Campaign Name', 'Targeting', 'Impressions', 'Clicks', 'Spend'], [{ Date: 46279, 'Campaign Name': 'SD1', Targeting: 'Views=(category="Shoes")', Impressions: 10, Clicks: 1, Spend: 2 }], ctx);
  assert.equal(r.records[0]!.searchTerm, 'views=(category="shoes")');
  assert.equal(r.records[0]!.target, r.records[0]!.searchTerm);
});

test('placements normalised to TOS / ROS / PDP, others kept', () => {
  assert.equal(normalizePlacement('Top of Search on-Amazon'), 'TOS');
  assert.equal(normalizePlacement('Product pages on Amazon'), 'PDP');
  assert.equal(normalizePlacement('Rest of search on Amazon'), 'ROS');
  assert.equal(normalizePlacement('Off Amazon'), 'Off Amazon');
  const r = parsePlacements('sp', ['Date', 'Campaign Name', 'Placement', 'Impressions', 'Clicks', 'Spend', '14 Day Total Sales (₹)', '14 Day Total Units (#)'], [
    { Date: 46248, 'Campaign Name': 'C', Placement: 'Product pages on Amazon', Impressions: 2, Clicks: 0, Spend: 0, '14 Day Total Sales (₹)': 0, '14 Day Total Units (#)': 0 },
  ], ctx);
  assert.equal(r.records[0]!.placement, 'PDP');
  assert.equal(r.records[0]!.date, '2026-08-14');
});

test('campaign mapper: duplicates merged (first non-empty per field); no Category column warned', () => {
  const r = parseCampaignMapper([
    { 'Campaign name': 'RB /SP /KT/HBA1/ Branded/Mix/ Exact', Type: 'SP', Targeting: 'KT', 'Branded/Non-Branded': 'Branded', 'Auto/Manual': 'Manual' },
    { 'Campaign name': 'RB /SP /KT/HBA1/ Branded/Mix/ Exact', Type: '', Targeting: '', 'Branded/Non-Branded': '', 'Auto/Manual': 'Manual' },
  ]);
  assert.equal(r.records.length, 1);
  assert.deepEqual(r.records[0], {
    campaignKey: 'rb /sp /kt/hba1/ branded/mix/ exact',
    campaignName: 'RB /SP /KT/HBA1/ Branded/Mix/ Exact',
    category: null,
    type: 'SP',
    targeting: 'KT',
    branded: 'Branded',
    autoManual: 'Manual',
  });
  assert.ok(r.warnings.some((w) => w.includes('No "Category" column')));
});

test('order report: shipped only, state normalised, per date × state × ASIN', () => {
  const rows = [
    { 'amazon-order-id': '1', 'purchase-date': '2026-09-01T10:00:00+05:30', 'order-status': 'Shipped', asin: 'B0A0000001', 'ship-state': 'MAHARASHTRA', quantity: 2, 'item-price': '₹4,598' },
    { 'amazon-order-id': '2', 'purchase-date': '2026-09-01T11:00:00+05:30', 'order-status': 'Shipped', asin: 'B0A0000001', 'ship-state': 'MH', quantity: 1, 'item-price': '2299' },
    { 'amazon-order-id': '3', 'purchase-date': '2026-09-01T12:00:00+05:30', 'order-status': 'Cancelled', asin: 'B0A0000001', 'ship-state': 'MH', quantity: 1, 'item-price': '2299' },
  ];
  const r = parseOrderReport(rows, ctx);
  assert.deepEqual(r.records, [{ date: '2026-09-01', state: 'Maharashtra', asin: 'B0A0000001', units: 3, sales: 6897, orders: 2, unpricedUnits: 0 }]);
});

test('vendor State view also yields state rows (units summed per state, unpriced kept)', () => {
  const headers = ['State', 'ASIN', 'Shipped Revenue', 'Shipped COGS', 'Shipped Units', 'Date'];
  const r = parseVendorCentral(headers, [
    { State: 'MAHARASHATRA', ASIN: 'B0A0000001', 'Shipped Revenue': '₹0.00', 'Shipped COGS': '₹0.00', 'Shipped Units': 2, Date: '24/09/2026' },
    { State: 'MAHARASHTRA', ASIN: 'B0A0000001', 'Shipped Revenue': '₹0.00', 'Shipped COGS': '₹0.00', 'Shipped Units': 1, Date: '24/09/2026' },
  ], ctx);
  assert.deepEqual(r.states, [{ date: '2026-09-24', state: 'Maharashtra', asin: 'B0A0000001', units: 3, sales: 0, orders: null, unpricedUnits: 3 }]);
});
