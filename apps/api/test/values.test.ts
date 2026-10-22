import assert from 'node:assert/strict';
import { test } from 'node:test';

import { num, pick } from '../src/lib/values';

test('num strips currency, commas, %, and keeps exponents', () => {
  assert.equal(num('₹9,549.13'), 9549.13);
  assert.equal(num('13,643'), 13643);
  assert.equal(num('₹2.26E+3'), 2260);
  assert.equal(num('6.91%'), 6.91);
  assert.equal(num(42), 42);
  assert.equal(num(''), 0);
  assert.equal(num('-'), 0);
});

test('pick is case/whitespace-insensitive and skips blanks', () => {
  const row = { ' Sessions - Total ': 336, asin: '', ASIN: 'B0X' };
  assert.equal(pick(row, ['Sessions - Total']), 336);
  assert.equal(pick(row, ['asin']), 'B0X');
});
