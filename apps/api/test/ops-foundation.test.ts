import assert from 'node:assert/strict';
import { test } from 'node:test';

import { OPS_SETTINGS_DEFAULTS } from '@dash/shared';
import { identifierWarning } from '../src/ops/brands';
import { AMAZON_NOW_CODES, classifyWarehouse, normalizeFcCode, seedWarehouseRows } from '../src/ops/warehouses';

const brand = { id: 'eatopia', name: 'Eatopia', logoUrl: null, vendorCodes: ['ABCDE'], sellerIds: ['A1SELLER'], marketplace: 'Amazon.in', active: true };

test('warehouse network rule: Amazon-Now list vs Core', () => {
  assert.equal(classifyWarehouse('HLK1'), 'Amazon Now');
  assert.equal(classifyWarehouse('hlk1'), 'Amazon Now'); // case-insensitive
  assert.equal(classifyWarehouse('DED3'), 'Core');
  assert.equal(classifyWarehouse('BLR8'), 'Core');
  assert.equal(normalizeFcCode('  blr8 '), 'BLR8');
});

test('warehouse seed covers the Amazon-Now list with HHS1 geo known', () => {
  const rows = seedWarehouseRows();
  assert.equal(rows.length, AMAZON_NOW_CODES.length);
  assert.ok(rows.every((r) => r.network === 'Amazon Now'));
  const hhs1 = rows.find((r) => r.code === 'HHS1')!;
  assert.deepEqual([hhs1.city, hhs1.state, hhs1.needsReview], ['Gurgaon', 'Haryana', false]);
  const had1 = rows.find((r) => r.code === 'HAD1')!;
  assert.deepEqual([had1.city, had1.needsReview], [null, true]);
});

test('settings defaults match the spec (§1.4)', () => {
  assert.equal(OPS_SETTINGS_DEFAULTS.criticalDays, 12);
  assert.equal(OPS_SETTINGS_DEFAULTS.excessDays, 60);
  assert.equal(OPS_SETTINGS_DEFAULTS.dueSoonDays, 3);
  assert.equal(OPS_SETTINGS_DEFAULTS.vcSalesMetric, 'Shipped Units');
});

test('identifier warning only fires on a real mismatch', () => {
  assert.equal(identifierWarning(brand, { kind: 'vendorCode', value: 'ABCDE' }), null); // matches
  assert.equal(identifierWarning(brand, null), null); // nothing to check
  assert.equal(identifierWarning({ ...brand, vendorCodes: [] }, { kind: 'vendorCode', value: 'ZZZZZ' }), null); // no pool
  const warn = identifierWarning(brand, { kind: 'vendorCode', value: 'ZZZZZ' });
  assert.ok(warn && warn.includes('ZZZZZ') && warn.includes('Eatopia'));
});
