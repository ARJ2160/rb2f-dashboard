import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readWorkbook } from '../src/ingestion/sheet-reader';
import {
  parseFbaInventory,
  parseLedgerSummary,
  parseShipmentContents,
  parseShipments,
  shipmentIdFromName,
} from '../src/ops/sc/parse';

const ctx = { nameDates: null, preamble: [] as string[] };
function csv(lines: string[][]): Buffer {
  const cell = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return Buffer.from(lines.map((r) => r.map(cell).join(',')).join('\n'), 'utf-8');
}
const sheet = (buf: Buffer) => readWorkbook(buf)[0]!;

const LEDGER_H = [
  'Date',
  'FNSKU',
  'ASIN',
  'MSKU',
  'Title',
  'Disposition',
  'Starting Warehouse Balance',
  'In Transit Between Warehouses',
  'Receipts',
  'Customer Shipments',
  'Customer Returns',
  'Vendor Returns',
  'Warehouse Transfer In/Out',
  'Found',
  'Lost',
  'Damaged',
  'Disposed',
  'Other Events',
  'Ending Warehouse Balance',
  'Unknown Events',
  'Location',
];

test('ledger: US MM/DD/YYYY date, negative outflows, disposition & FC', () => {
  const s = sheet(
    csv([
      LEDGER_H,
      [
        '11/14/2026',
        'X1',
        'B0CL4V4H9X',
        'EHJ-MX-SB',
        'Jam',
        'SELLABLE',
        '9',
        '0',
        '0',
        '-3',
        '1',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '7',
        '0',
        'BLR8',
      ],
      [
        '11/09/2026',
        'X1',
        'B0CL4V4H9X',
        'EHJ-MX-SB',
        'Jam',
        'DEFECTIVE',
        '22',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '22',
        '0',
        'DEL4',
      ],
    ])
  );
  const r = parseLedgerSummary(s.headers, s.rows, ctx);
  assert.equal(r.error, undefined);
  assert.equal(r.records.length, 2);
  const a = r.records[0]!;
  assert.equal(a.date, '2026-11-14'); // US calendar, not 14 months
  assert.equal(a.customerShipments, -3);
  assert.equal(a.customerReturns, 1);
  assert.equal(a.endingBalance, 7);
  assert.equal(a.disposition, 'SELLABLE');
  assert.equal(a.location, 'BLR8');
  assert.equal(r.records[1]!.date, '2026-11-09'); // 11/09 → 9 Nov, not 11 Sep
  assert.deepEqual([r.from, r.to], ['2026-11-09', '2026-11-14']);
  assert.equal(r.warehouses.sort().join(','), 'BLR8,DEL4');
  assert.equal(r.products.length, 1); // same FNSKU/ASIN/MSKU deduped
});

test('fba: accepts either column spelling and stashes unknown columns in extra', () => {
  // Uses the "sales-shipped-last-30-days" spelling and "Total Reserved Quantity"; adds an unknown column.
  const s = sheet(
    csv([
      [
        'snapshot-date',
        'sku',
        'fnsku',
        'asin',
        'available',
        'sales-shipped-last-30-days',
        'Total Reserved Quantity',
        'some-new-column',
      ],
      ['2026-11-16', 'EHJ-2MX-240', 'X9', 'B0CL4WQ3L8', '99', '140', '17', 'surprise'],
    ])
  );
  const r = parseFbaInventory(s.headers, s.rows, ctx);
  assert.equal(r.error, undefined);
  const rec = r.records[0]!;
  assert.equal(rec.available, 99);
  assert.equal(rec.unitsShipped30, 140); // mapped from sales-shipped-last-30-days
  assert.equal(rec.reserved, 17); // mapped from Total Reserved Quantity
  assert.equal(rec.snapshotDate, '2026-11-16');
  assert.deepEqual(rec.extra, { 'some-new-column': 'surprise' });
});

test('fba: missing `available` degrades gracefully with a warning', () => {
  const s = sheet(
    csv([
      ['snapshot-date', 'sku', 'units-shipped-t30'],
      ['2026-11-16', 'SKU1', '10'],
    ])
  );
  const r = parseFbaInventory(s.headers, s.rows, ctx);
  assert.equal(r.records.length, 1);
  assert.ok(r.missingColumns.includes('available'));
  assert.ok(r.warnings.some((w) => /available/.test(w)));
});

test('shipment ID is the code in the LAST parentheses; 3- and 4-letter months parse', () => {
  assert.equal(shipmentIdFromName('FBA STA (27/10/2026 10:29)-DED5 (FBA15MS2NJ5Z)'), 'FBA15MS2NJ5Z');
  const s = sheet(
    csv([
      [
        'Shipment name',
        'Status',
        'Created',
        'Last updated',
        'Destination',
        'Delivery window',
        'SKUs',
        'Units expected',
        'Units located',
      ],
      [
        'FBA STA (27/10/2026 10:29)-DED5 (FBA15MS2NJ5Z)',
        'Closed',
        '27 Oct 2026',
        '29 Sept 2026',
        'DED5',
        '',
        '3',
        '100',
        '98',
      ],
    ])
  );
  const r = parseShipments(s.headers, s.rows, ctx);
  const rec = r.records[0]!;
  assert.equal(rec.shipmentId, 'FBA15MS2NJ5Z');
  assert.equal(rec.created, '2026-10-27');
  assert.equal(rec.lastUpdated, '2026-09-29'); // "29 Sept 2026" (4-letter month)
  assert.equal(rec.destination, 'DED5');
  assert.equal(rec.unitsExpected, 100);
  assert.equal(rec.unitsLocated, 98);
  assert.equal(r.warehouses[0], 'DED5');
});

test('shipment contents maps shipped vs received', () => {
  const s = sheet(
    csv([
      ['Shipment ID', 'MSKU', 'Shipped', 'Received'],
      ['FBA15MS2NJ5Z', 'EHJ-MX-SB', '50', '48'],
    ])
  );
  const r = parseShipmentContents(s.headers, s.rows, ctx);
  assert.equal(r.records[0]!.unitsShipped, 50);
  assert.equal(r.records[0]!.unitsReceived, 48);
});
