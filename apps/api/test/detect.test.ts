import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectByHeaders, detectByName, detectReportType } from '../src/ingestion/detect-report';

// Header sets copied from real Amazon India exports (YPLAYZ sample workbook).
const BUSINESS = ['(Parent) ASIN', '(Child) ASIN', 'Title', 'Sessions - Total', 'Page Views - Total', 'Units Ordered', 'Ordered Product Sales', 'Total Order Items'];
const SP = ['Start Date', 'End Date', 'Portfolio name', 'Program Type', 'Campaign Name', 'Impressions', 'Clicks', 'Spend', '7 Day Total Orders (#)', '7 Day Total Sales'];
const SB = ['Start Date', 'End Date', 'Portfolio name', 'Currency', 'Campaign Name', 'Cost type', 'Impressions', 'Clicks', 'Spend', '14 Day Total Sales', '14 Day Total Units (#)', '5 Second Views', '14 Day Branded Searches', '14 Day Detail Page Views (DPV)', 'Brand Store page views'];
const SD = ['Start Date', 'End Date', 'Status', 'Budget Amount', 'Campaign Name', 'Cost type', 'Impressions', 'Clicks', '14 Day Detail Page Views (DPV)', 'Spend', '14 Day Total Units (#)', '14 Day Total Sales', '14 Day ATC Views', '14 Day Branded Searches', 'Branded Searches view-through conversions'];
const SP_STR = ['Start Date', 'Campaign Name', 'Targeting', 'Match Type', 'Customer Search Term', 'Impressions', 'Clicks', 'Spend', '7 Day Total Sales'];
const VENDOR = ['ASIN', 'Product Title', 'Ordered Revenue', 'Ordered Units', 'Shipped Revenue', 'Shipped COGS', 'Shipped Units', 'Customer Returns'];
const MAPPER = ['ASIN', 'Title', 'Category', 'Sub-category', 'Size', 'Price', 'MRP'];
const CAMPAIGN_MAPPER = ['Campaigns ', 'Type', 'Targeting', 'Category', 'Branded/Non-Branded'];

test('headers decide the report type and ad channel', () => {
  assert.equal(detectByHeaders(BUSINESS), 'business_report');
  assert.equal(detectByHeaders(SP), 'sp_campaign');
  assert.equal(detectByHeaders(SB), 'sb_campaign');
  assert.equal(detectByHeaders(SD), 'sd_campaign');
  assert.equal(detectByHeaders(SP_STR), 'sp_search_term');
  assert.equal(detectByHeaders(VENDOR), 'vendor_central');
  assert.equal(detectByHeaders(MAPPER), 'asin_mapper');
  assert.equal(detectByHeaders(CAMPAIGN_MAPPER), 'campaign_mapper');
});

test('headers win over a misleading filename', () => {
  assert.deepEqual(detectReportType(SB, 'Sheet1', 'SP_Campaign_1_June.xlsx'), { reportType: 'sb_campaign', detectedBy: 'headers' });
});

test('name fallback', () => {
  assert.equal(detectByName('SP campaign '), 'sp_campaign');
  assert.equal(detectByName('Business reports'), 'business_report');
  assert.equal(detectByName('SB_STR_1_June_-_30_June.xlsx'), 'sb_search_term');
  assert.equal(detectByName('Vendor_Central_Sales_1_July.csv'), 'vendor_central');
  assert.equal(detectByName('random.xlsx'), null);
});
