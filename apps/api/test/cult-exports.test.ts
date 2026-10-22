/**
 * Header sets from real Cult (Amazon India) exports, Oct 2026. This account's
 * SP reports use 14-day attribution and the SP campaign export is hourly —
 * both broke the first version of detection.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectReportType } from '../src/ingestion/detect-report';
import { parseAsinMapper } from '../src/ingestion/parsers/asin-mapper';

const CASES: Array<[string, string[], string]> = [
  ['Sponsored_Products_Campaign_report_5.csv', ['Start Date', 'End Date', 'Start Time', 'Portfolio name', 'Campaign Type', 'Campaign Name', 'Country', 'Status', 'Currency', 'Budget', 'Targeting Type', 'Bidding strategy', 'Impressions', 'Clicks', 'Spend', '14 Day Total Orders (#)', '14 Day Total Sales (₹)'], 'sp_campaign'],
  ['Sponsored_Brands_Campaign_report_1.xlsx', ['Date', 'Portfolio name', 'Currency', 'Campaign Name', 'Cost Type', 'Country', 'Impressions', 'Clicks', 'Spend', '14 Day Total Sales (₹)', '14 Day Total Units (#)', 'Viewable Impressions', '5 Second Views', '14 Day Branded Searches', '14 Day Detail Page Views (DPV)'], 'sb_campaign'],
  ['Sponsored_Display_Campaign_report_1.xlsx', ['Date', 'Country', 'Status', 'Currency', 'Budget', 'Campaign Name', 'Cost Type', 'Impressions', 'Viewable Impressions', 'Clicks', '14 Day Detail Page Views (DPV)', 'Spend', '14 Day Total Units (#)', '14 Day Total Sales (₹)', '14 Day ATC Views', 'Branded Searches view-through conversions'], 'sd_campaign'],
  ['Sponsored_Products_Search_term_report_39.xlsx', ['Date', 'Campaign Name', 'Ad Group Name', 'Targeting', 'Match Type', 'Customer Search Term', 'Impressions', 'Clicks', 'Spend', '14 Day Total Sales (₹)', '14 Day Brand Halo ASIN Units (#)'], 'sp_search_term'],
  ['Sponsored_Brands_Search_term_report_2.xlsx', ['Date', 'Campaign Name', 'Targeting', 'Customer Search Term', 'Cost Type', 'Impressions', 'Viewable Impressions', 'Clicks', 'Spend', '14 Day Total Sales (₹)'], 'sb_search_term'],
  ['Sponsored_Products_Placement_report_3.xlsx', ['Date', 'Campaign Name', 'Bidding strategy', 'Placement', 'Impressions', 'Clicks', 'Spend', '14 Day Total Sales (₹)'], 'sp_placement'],
  ['Sponsored_Brands_Campaign_placement_report_2.xlsx', ['Date', 'Campaign Name', 'Cost Type', 'Placement', 'Impressions', 'Viewable Impressions', 'Clicks', 'Spend', '5 Second Views'], 'sb_placement'],
  ['Sponsored_Products_Advertised_product_report_15.xlsx', ['Date', 'Campaign Name', 'Ad Group Name', 'Advertised ASIN', 'Impressions', 'Clicks', 'Spend', '14 Day Total Sales (₹)'], 'sp_advertised_product'],
  ['Sponsored_Display_Advertised_product_report_2.xlsx', ['Date', 'Campaign Name', 'Cost Type', 'Bid Optimisation', 'Advertised SKU', 'Advertised ASIN', 'Impressions', 'Viewable Impressions', 'Clicks', 'Spend'], 'sd_advertised_product'],
  ['Sponsored_Display_Targeting_report_2.xlsx', ['Date', 'Campaign Name', 'Cost Type', 'Targeting', 'Bid Optimisation', 'Impressions', 'Viewable Impressions', 'Clicks', 'Spend'], 'sd_targeting'],
  ['Sponsored_Brands_Attributed_Purchases_report_2.csv', ['Date', 'Currency', 'Campaign Name', 'Attribution type', 'Purchased ASIN', '14 Day Total Sales (₹)'], 'sb_attributed_purchase'],
  ['RB2F __ Cult __ Mastersheet - ASIN Mapper.csv', ['Brand', 'Amazon ASIN', 'Sub-Cat', 'Article Type', 'Style ID', 'Model', 'Gender', 'Size', 'MRP', 'Product Title'], 'asin_mapper'],
  ['RB2F __ Cult __ Mastersheet - Campaign Mapper.csv', ['Campaign name', 'Type', 'Targeting', 'Branded/Non-Branded', 'Auto/Manual'], 'campaign_mapper'],
];

for (const [file, headers, expected] of CASES) {
  test(`detect ${file} → ${expected}`, () => {
    assert.equal(detectReportType(headers, 'Sheet1', file)?.reportType, expected);
  });
}

test('Cult ASIN mapper: "Amazon ASIN" + "Article Type", junk rows skipped, duplicates collapsed', () => {
  const headers = ['Brand', 'Amazon ASIN', 'Sub-Cat', 'Article Type', 'Product Title'];
  const rows = [
    { Brand: 'CULT', 'Amazon ASIN': 'B0BZRM6H2F', 'Sub-Cat': 'Sports', 'Article Type': 'Training', 'Product Title': 'cult X1' },
    { Brand: 'CULT', 'Amazon ASIN': 'B0BZRM6H2F', 'Sub-Cat': 'Sports', 'Article Type': 'Training', 'Product Title': 'cult X1' },
    { Brand: 'Brand', 'Amazon ASIN': 'Amazon ASIN', 'Sub-Cat': 'Sub-Cat', 'Article Type': 'Article Type', 'Product Title': '' },
    { Brand: 'AVANT', 'Amazon ASIN': 'B0C5NDQP6N', 'Sub-Cat': '#N/A', 'Article Type': '#N/A', 'Product Title': 'x' },
  ];
  const r = parseAsinMapper(headers, rows);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.records.map((x) => [x.asin, x.category]), [
    ['B0BZRM6H2F', 'Training'],
    ['B0C5NDQP6N', null],
  ]);
  assert.ok(r.warnings.some((w) => w.includes('"Article Type"')));
});
