import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectByHeaders } from '../src/ingestion/detect-report';
import { parseAsinMapper } from '../src/ingestion/parsers/asin-mapper';
import { parseVendorCentral } from '../src/ingestion/parsers/vendor-central';
import { readWorkbook } from '../src/ingestion/sheet-reader';

const noCtx = { nameDates: null, preamble: [] };

test('rule 1: Ordered columns win over Shipped', () => {
  const headers = ['Date', 'ASIN', 'Ordered Revenue', 'Ordered Units', 'Shipped Revenue', 'Shipped Units'];
  const r = parseVendorCentral(headers, [{ Date: '01/09/2026', ASIN: 'B0A0000001', 'Ordered Revenue': '₹2,000', 'Ordered Units': 2, 'Shipped Revenue': '₹999', 'Shipped Units': 9 }], noCtx);
  assert.deepEqual(r.records.map((x) => [x.sales, x.units, x.unpricedUnits]), [[2000, 2, 0]]);
});

test('rule 2: no Ordered columns → Shipped Revenue / Units', () => {
  const headers = ['Date', 'ASIN', 'Shipped Revenue', 'Shipped Units'];
  const r = parseVendorCentral(headers, [{ Date: '01/09/2026', ASIN: 'B0A0000001', 'Shipped Revenue': '₹1,500.50', 'Shipped Units': 3 }], noCtx);
  assert.deepEqual(r.records.map((x) => [x.sales, x.units, x.unpricedUnits]), [[1500.5, 3, 0]]);
  assert.equal(detectByHeaders(headers), 'vendor_central');
});

test('rule 3: Shipped Revenue ₹0 with units → units left for mapper pricing', () => {
  const headers = ['Date', 'ASIN', 'Shipped Revenue', 'Shipped Units'];
  const r = parseVendorCentral(headers, [{ Date: '01/09/2026', ASIN: 'B0A0000001', 'Shipped Revenue': '₹0.00', 'Shipped Units': 4 }], noCtx);
  assert.deepEqual(r.records.map((x) => [x.sales, x.units, x.unpricedUnits]), [[0, 4, 4]]);
});

test('stacked daily exports in one sheet (Cult VC layout): block dates, repeated headers, states summed', () => {
  const csv = [
    ',Programme=[Retail],Distributor View=[Manufacturing],View By=[State],Currency=[INR],Viewing Range=[24/09/26 - 24/09/26]',
    'State,ASIN,Shipped Revenue,Shipped COGS,Shipped Units',
    'WEST BENGAL,B0G8FTX7QG,₹0.00,₹0.00,1',
    'KARNATAKA,B0G8FTX7QG,₹0.00,₹0.00,2',
    'Programme=[Retail],Distributor View=[Manufacturing],View By=[State],Currency=[INR],Reporting Range=[Custom],Viewing Range=[23/09/26 - 23/09/26]',
    'State,ASIN,Shipped Revenue,Shipped COGS,Shipped Units',
    'DELHI,B0G8FTX7QG,₹0.00,₹0.00,5',
  ].join('\n');
  const [sheet] = readWorkbook(Buffer.from(csv, 'utf8'));
  assert.ok(sheet);
  assert.equal(detectByHeaders(sheet.headers), 'vendor_central');
  const r = parseVendorCentral(sheet.headers, sheet.rows, { nameDates: null, preamble: sheet.preamble });
  assert.equal(r.error, undefined);
  assert.deepEqual(
    r.records.map((x) => [x.date, x.asin, x.units, x.unpricedUnits]).sort(),
    [
      ['2026-09-23', 'B0G8FTX7QG', 5, 5],
      ['2026-09-24', 'B0G8FTX7QG', 3, 3],
    ]
  );
});

test('ASIN mapper reads selling price: BAU first, Event Price fallback, never MRP', () => {
  const headers = ['Amazon ASIN', 'Article Type', 'MRP', 'BAU', 'Event Price'];
  const r = parseAsinMapper(headers, [
    { 'Amazon ASIN': 'B0A0000001', 'Article Type': 'Running', MRP: '4,999', BAU: '2,299', 'Event Price': '2,149' },
    { 'Amazon ASIN': 'B0A0000002', 'Article Type': 'Running', MRP: '4,999', BAU: '', 'Event Price': '1,999' },
    { 'Amazon ASIN': 'B0A0000003', 'Article Type': 'Running', MRP: '4,999', BAU: '', 'Event Price': '' },
  ]);
  assert.deepEqual(r.records.map((x) => [x.asin, x.sellingPrice]), [
    ['B0A0000001', 2299],
    ['B0A0000002', 1999],
    ['B0A0000003', null],
  ]);
});
