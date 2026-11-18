import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readWorkbook } from '../src/ingestion/sheet-reader';
import { detectOpsFile, sniffIdentifier } from '../src/ops/detect';

/** Build a CSV buffer from a header row + data rows (cells with commas are quoted). */
function csv(lines: string[][]): Buffer {
  const cell = (c: string) => (/[",\n]/.test(c) ? `"${c.replace(/"/g, '""')}"` : c);
  return Buffer.from(lines.map((r) => r.map(cell).join(',')).join('\n'), 'utf-8');
}
function only(buf: Buffer) {
  const sheets = readWorkbook(buf);
  assert.equal(sheets.length, 1, 'one sheet');
  return sheets[0]!;
}

// Exact header rows from the real Seller Central sample files.
const LEDGER_SUMMARY = [
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
const FBA_INVENTORY = [
  'snapshot-date',
  'sku',
  'fnsku',
  'asin',
  'product-name',
  'condition',
  'available',
  'inbound-quantity',
  'inbound-working',
  'inbound-shipped',
  'inbound-received',
  'Total Reserved Quantity',
  'unfulfillable-quantity',
  'units-shipped-t7',
  'units-shipped-t30',
  'sales-shipped-last-7-days',
  'sales-shipped-last-30-days',
];

test('detects Seller Central Inventory Ledger — Summary (real headers)', () => {
  const s = only(
    csv([
      LEDGER_SUMMARY,
      [
        '11/14/2026',
        'X0028BLH8V',
        'B0CL4V4H9X',
        'EHJ-MX-SB',
        'Jam',
        'SELLABLE',
        '9',
        '0',
        '0',
        '-1',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '0',
        '8',
        '0',
        'BLR8',
      ],
    ])
  );
  const d = detectOpsFile(s.headers, s.preamble);
  assert.deepEqual(d, { fileType: 'sc_ledger_summary', channel: 'sc', detectedBy: 'headers' });
});

test('detects FBA Inventory (real headers)', () => {
  const s = only(
    csv([
      FBA_INVENTORY,
      [
        '2026-11-16',
        'EHJ-2MX-240_MFN',
        'X0028BSKUJ',
        'B0CL4WQ3L8',
        '',
        'New',
        '99',
        '98',
        '0',
        '98',
        '0',
        '17',
        '1',
        '29',
        '140',
        '15858',
        '74799',
      ],
    ])
  );
  const d = detectOpsFile(s.headers, s.preamble);
  assert.equal(d?.fileType, 'sc_fba_inventory');
  assert.equal(d?.channel, 'sc');
});

test('detects Inventory Ledger — Detailed', () => {
  const s = only(
    csv([
      [
        'Date',
        'FNSKU',
        'ASIN',
        'MSKU',
        'Title',
        'Event Type',
        'Reference ID',
        'Quantity',
        'Fulfillment Center',
        'Disposition',
        'Reason',
        'Country',
      ],
      ['11/14/2026', 'X1', 'B1', 'SKU1', 'T', 'Receipts', 'FBA15X', '10', 'BLR8', 'SELLABLE', '', 'IN'],
    ])
  );
  assert.equal(detectOpsFile(s.headers, s.preamble)?.fileType, 'sc_ledger_detail');
});

test('detects Shipments list (headers carry no shared token → fallback header row)', () => {
  const s = only(
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
        '29 Oct 2026',
        'DED5',
        '',
        '3',
        '100',
        '98',
      ],
    ])
  );
  const d = detectOpsFile(s.headers, s.preamble);
  assert.equal(d?.fileType, 'sc_shipments');
  assert.equal(d?.channel, 'sc');
});

test('detects Shipment contents', () => {
  const s = only(
    csv([
      ['Shipment ID', 'MSKU', 'Title', 'Shipped', 'Received'],
      ['FBA15MS2NJ5Z', 'EHJ-MX-SB', 'Jam', '50', '48'],
    ])
  );
  assert.equal(detectOpsFile(s.headers, s.preamble)?.fileType, 'sc_shipment_contents');
});

test('detects Vendor Central PO items export + sniffs vendor code', () => {
  const header = [
    'PO',
    'Vendor code',
    'Order date',
    'Status',
    'Product name',
    'ASIN',
    'Requested quantity',
    'Accepted quantity',
    'Received quantity',
    'Ship-to location',
    'Window start',
    'Window end',
    'Cost',
  ];
  const s = only(
    csv([
      header,
      [
        '5Y52K59U',
        'ABCDE',
        '02/10/2026',
        'Confirmed',
        'Jam',
        'B0C9ZLH9HZ',
        '100',
        '90',
        '0',
        'DED3',
        '',
        '',
        '100',
      ],
    ])
  );
  const d = detectOpsFile(s.headers, s.preamble);
  assert.equal(d?.fileType, 'vc_po');
  assert.equal(d?.channel, 'vc');
  assert.deepEqual(sniffIdentifier('vc_po', s.rows, s.preamble), { kind: 'vendorCode', value: 'ABCDE' });
});

const VC_META =
  'Programme=[Retail],Distributor View=[Manufacturing],View By=[ASIN],Countries=[IN],Businesses=[Eatopia],Viewing Range=[01/11/26 - 09/11/26],Report Updated=[09/11/26]';

test('splits Retail Analytics Inventory vs Sales by columns, and sniffs Businesses', () => {
  const inv = only(
    csv([
      [VC_META],
      [
        'ASIN',
        'Product Title',
        'Brand',
        'Net Received Units',
        'Open Purchase Order Quantity',
        'Sellable On Hand Units',
        'Unsellable On-Hand Units',
      ],
      ['B0C9ZLH9HZ', 'Jam', 'Eatopia', '10', '578', '263', '5'],
    ])
  );
  const di = detectOpsFile(inv.headers, inv.preamble);
  assert.equal(di?.fileType, 'vc_inventory');
  assert.deepEqual(sniffIdentifier('vc_inventory', inv.rows, inv.preamble), {
    kind: 'businesses',
    value: 'Eatopia',
  });

  const sales = only(
    csv([
      [VC_META],
      [
        'ASIN',
        'Product Title',
        'Brand',
        'Ordered Revenue',
        'Ordered Units',
        'Shipped Revenue',
        'Shipped Units',
      ],
      ['B0C9ZLH9HZ', 'Jam', 'Eatopia', '1000', '10', '900', '9'],
    ])
  );
  assert.equal(detectOpsFile(sales.headers, sales.preamble)?.fileType, 'vc_sales');
});

test('an unrelated export is not recognised', () => {
  const s = only(
    csv([
      ['Campaign Name', 'Impressions', 'Clicks', 'Spend'],
      ['x', '10', '1', '5'],
    ])
  );
  assert.equal(detectOpsFile(s.headers, s.preamble), null);
});
