import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseVendorCentral } from '../src/ingestion/parsers/vendor-central';
import { readWorkbook } from '../src/ingestion/sheet-reader';

test('CSV: metadata lines skipped, header found, D/M/Y dates not US-guessed', () => {
  const csv = [
    'Program=[Retail],Distributor View=[Manufacturing]',
    'Viewing Range=[10/04/2026 - 11/04/2026]',
    'Date,ASIN,Product Title,Ordered Revenue,Ordered Units',
    '10/04/2026,B0A0000001,"Shampoo, 300ml","₹1,000.00",2',
    '11/04/2026,B0A0000001,"Shampoo, 300ml",500,1',
  ].join('\n');
  const [sheet] = readWorkbook(Buffer.from(csv, 'utf8'));
  assert.ok(sheet);
  assert.deepEqual(sheet.headers, ['Date', 'ASIN', 'Product Title', 'Ordered Revenue', 'Ordered Units']);
  assert.equal(sheet.preamble.length, 2);
  const r = parseVendorCentral(sheet.headers, sheet.rows, { nameDates: null, preamble: sheet.preamble });
  assert.deepEqual(
    r.records.map((x) => [x.date, x.sales, x.units]),
    [
      ['2026-04-10', 1000, 2],
      ['2026-04-11', 500, 1],
    ]
  );
});
