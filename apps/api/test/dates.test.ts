import assert from 'node:assert/strict';
import { test } from 'node:test';

import { datesFromFilename, parseDateCell } from '../src/lib/dates';

const NOW = new Date('2026-10-09T12:00:00Z');

test('filename: D_Month_-_D_Month range', () => {
  assert.deepEqual(datesFromFilename('SB_Campaign_placement_report_1_June_-_3_August.xlsx', NOW), {
    from: '2026-06-01',
    to: '2026-08-03',
  });
});

test('filename: single day, free text, duplicate-download suffix', () => {
  assert.deepEqual(datesFromFilename('RB2F__YPLAYZ__10 april- data (1).xlsx', NOW), { from: '2026-04-10', to: '2026-04-10' });
});

test('filename: no-separator form and future month rolls back a year', () => {
  assert.deepEqual(datesFromFilename('SP_campaign_1JUNE-30JUNE.csv', NOW), { from: '2026-06-01', to: '2026-06-30' });
  assert.deepEqual(datesFromFilename('Business_Report_5_Dec.xlsx', NOW), { from: '2025-12-05', to: '2025-12-05' });
});

test('filename: Dec → Jan range wraps the start year', () => {
  assert.deepEqual(datesFromFilename('Vendor_20_Dec_-_5_Jan.xlsx', NOW), { from: '2025-12-20', to: '2026-01-05' });
});

test('filename: ISO dates and no dates', () => {
  assert.deepEqual(datesFromFilename('report_2026-04-01_2026-04-30.csv', NOW), { from: '2026-04-01', to: '2026-04-30' });
  assert.equal(datesFromFilename('Feb-March - data.xlsx', NOW), null);
});

test('cell dates: serial, ISO, D/M/Y default, M/D/Y when unambiguous, text', () => {
  assert.equal(parseDateCell(46122), '2026-04-10');
  assert.equal(parseDateCell('2026-04-10T05:30:00+05:30'), '2026-04-10');
  assert.equal(parseDateCell('10/04/2026'), '2026-04-10');
  assert.equal(parseDateCell('04/25/2026'), '2026-04-25');
  assert.equal(parseDateCell('10 Apr 2026'), '2026-04-10');
  assert.equal(parseDateCell('Apr 10, 2026'), '2026-04-10');
  assert.equal(parseDateCell(''), null);
  assert.equal(parseDateCell(12), null); // a metric, not a date
});
