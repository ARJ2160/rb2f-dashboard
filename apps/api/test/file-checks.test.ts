import assert from 'node:assert/strict';
import { test } from 'node:test';

import { cleanFilename, looksLikeSpreadsheet } from '../src/lib/file-checks';

test('looksLikeSpreadsheet: xlsx (zip), xls (OLE2), CSV and UTF-16 text pass', () => {
  assert.ok(looksLikeSpreadsheet(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00])));
  assert.ok(looksLikeSpreadsheet(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00])));
  assert.ok(looksLikeSpreadsheet(Buffer.from('\uFEFFDate,Sessions,Units\n2026-10-01,120,8\n', 'utf8')));
  assert.ok(looksLikeSpreadsheet(Buffer.from('\uFEFFa\tb\n', 'utf16le')));
});

test('looksLikeSpreadsheet: binaries renamed to .xlsx are rejected', () => {
  const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.from([0x00, 0x01, 0x02])]);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
  assert.equal(looksLikeSpreadsheet(pdf), false);
  assert.equal(looksLikeSpreadsheet(png), false);
  assert.equal(looksLikeSpreadsheet(Buffer.alloc(0)), false);
});

test('cleanFilename: restores UTF-8, drops paths and control characters, caps length', () => {
  const latin1 = Buffer.from('Sales ₹ report.xlsx', 'utf8').toString('latin1');
  assert.equal(cleanFilename(latin1), 'Sales ₹ report.xlsx');
  assert.equal(cleanFilename('C:\\Users\\me\\Business_Report.csv'), 'Business_Report.csv');
  assert.equal(cleanFilename('../../etc/passwd.csv'), 'passwd.csv');
  assert.equal(cleanFilename('bad\u0000\u001fname.csv'), 'badname.csv');
  const long = cleanFilename(`${'x'.repeat(300)}.xlsx`);
  assert.equal(long.length, 200);
  assert.ok(long.endsWith('.xlsx'));
  assert.equal(cleanFilename('   '), 'upload');
});
