import assert from 'node:assert/strict';
import { test } from 'node:test';

import { changePct, periodLabel, summaryPeriods } from '../src/lib/periods';

test('summaryPeriods: data through 21 Oct', () => {
  assert.deepEqual(summaryPeriods('2026-10-21'), {
    mtd: { from: '2026-10-01', to: '2026-10-21' },
    pmtd: { from: '2026-09-01', to: '2026-09-21' },
    l7d: { from: '2026-10-15', to: '2026-10-21' },
    p7d: { from: '2026-10-08', to: '2026-10-14' },
  });
});

test('summaryPeriods: month-end clamps the previous month, January rolls the year back', () => {
  assert.deepEqual(summaryPeriods('2026-03-31').pmtd, { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(summaryPeriods('2028-03-30').pmtd, { from: '2028-02-01', to: '2028-02-29' });
  const jan = summaryPeriods('2027-01-05');
  assert.deepEqual(jan.pmtd, { from: '2026-12-01', to: '2026-12-05' });
  assert.deepEqual(jan.p7d, { from: '2026-12-23', to: '2026-12-29' });
});

test('periodLabel', () => {
  assert.equal(periodLabel('2026-10-01', '2026-10-21'), '1-21 Oct');
  assert.equal(periodLabel('2026-09-28', '2026-10-04'), '28 Sep-4 Oct');
  assert.equal(periodLabel('2026-10-01', '2026-10-01'), '1 Oct');
  assert.equal(periodLabel('2026-12-29', '2027-01-04'), '29 Dec 2026-4 Jan 2027');
});

test('changePct matches the sheet (Sales 1,030,555 vs 924,046 → 11.53%)', () => {
  assert.equal(changePct(1030555, 924046)!.toFixed(2), '11.53');
  assert.equal(changePct(42.74, 51.2)!.toFixed(2), '-16.52');
  assert.equal(changePct(5, 0), null);
  assert.equal(changePct(null, 3), null);
});
