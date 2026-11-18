import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  changePct,
  daysOnHand,
  drr,
  fillRatePct,
  shipmentFlag,
  shipmentShortfall,
  skuFcFlag,
  skuFcHealth,
  skuHealth,
  skuStockFlag,
  shipmentHealth,
  warehouseHealth,
  type ScThresholds,
} from '../src/ops/sc/metrics';

const T: ScThresholds = {
  criticalDays: 12,
  excessDays: 60,
  returnRateBad: 5,
  agedShareBad: 20,
  demandChangeAlert: 30,
  stuckReceivingDays: 14,
  workingTooLongDays: 5,
  inTransitTooLongDays: 10,
};

test('drr / daysOnHand / changePct', () => {
  assert.equal(drr(90, 30), 3);
  assert.equal(drr(10, 0), null);
  assert.equal(daysOnHand(300, 3), 100);
  assert.equal(daysOnHand(300, null), null);
  assert.equal(changePct(0, 5), null); // "New"
  assert.equal(changePct(10, 5), -50);
});

test('SKU stock flag (§4.3)', () => {
  assert.equal(skuStockFlag({ sellable: 100, unitsSold30: 0, daysOnHand: null, inbound: 0 }, T), 'No sales');
  assert.equal(skuStockFlag({ sellable: 0, unitsSold30: 0, daysOnHand: null, inbound: 0 }, T), '-');
  assert.equal(skuStockFlag({ sellable: 0, unitsSold30: 50, daysOnHand: 0, inbound: 0 }, T), 'Out of stock');
  assert.equal(
    skuStockFlag({ sellable: 30, unitsSold30: 300, daysOnHand: 3, inbound: 100 }, T),
    'Critical - inbound'
  );
  assert.equal(
    skuStockFlag({ sellable: 30, unitsSold30: 300, daysOnHand: 3, inbound: 0 }, T),
    'Critical - send stock'
  );
  assert.equal(skuStockFlag({ sellable: 100, unitsSold30: 300, daysOnHand: 18, inbound: 0 }, T), 'Watch'); // < 24
  assert.equal(skuStockFlag({ sellable: 1000, unitsSold30: 300, daysOnHand: 100, inbound: 0 }, T), 'Excess');
  assert.equal(skuStockFlag({ sellable: 300, unitsSold30: 300, daysOnHand: 30, inbound: 0 }, T), 'OK');
});

test('SKU×FC flag', () => {
  assert.equal(skuFcFlag({ sellable: 0, unitsSold30: 10, daysOnHand: 0 }, T), 'Stockout at FC');
  assert.equal(skuFcFlag({ sellable: 10, unitsSold30: 10, daysOnHand: 5 }, T), 'Low cover');
  assert.equal(skuFcFlag({ sellable: 999, unitsSold30: 10, daysOnHand: 99 }, T), 'Excess');
  assert.equal(skuFcFlag({ sellable: 100, unitsSold30: 10, daysOnHand: 30 }, T), 'OK');
});

test('shipment flag (ordered rules) + shortfall (over-receipt = 0)', () => {
  assert.equal(shipmentFlag({ status: 'Cancelled', shortfall: 0, daysSinceCreated: 99 }, T), 'Cancelled');
  assert.equal(
    shipmentFlag({ status: 'Closed', shortfall: 40, daysSinceCreated: 30 }, T),
    'Closed - short received (raise case)'
  );
  assert.equal(shipmentFlag({ status: 'Closed', shortfall: 0, daysSinceCreated: 30 }, T), 'Closed - OK');
  assert.equal(
    shipmentFlag({ status: 'Receiving', shortfall: 0, daysSinceCreated: 20 }, T),
    'Receiving - stuck'
  );
  assert.equal(
    shipmentFlag({ status: 'In transit', shortfall: 0, daysSinceCreated: 12 }, T),
    'In transit - delayed'
  );
  assert.equal(shipmentFlag({ status: 'Working', shortfall: 0, daysSinceCreated: 7 }, T), 'Not shipped yet');
  assert.equal(shipmentFlag({ status: 'In transit', shortfall: 0, daysSinceCreated: 3 }, T), 'In transit');
  assert.equal(shipmentShortfall('Closed', 134, 135), 0); // over-received counts as 0 (§7.2)
  assert.equal(shipmentShortfall('Closed', 174, 134), 40);
  assert.equal(shipmentShortfall('Receiving', 100, 10), 0); // not closed
  assert.equal(fillRatePct(98, 100), 98);
});

test('SKU health (§5.3)', () => {
  assert.equal(
    skuHealth(
      { stockFlag: 'Out of stock', fcStockouts: 0, returnRatePct: 0, agedSharePct: 0, drr7: 1, drr30: 1 },
      T
    ).status,
    'not_working'
  );
  assert.equal(
    skuHealth({ stockFlag: 'Watch', fcStockouts: 0, returnRatePct: 0, agedSharePct: 0, drr7: 1, drr30: 1 }, T)
      .status,
    'needs_attention'
  );
  const ret = skuHealth(
    { stockFlag: 'OK', fcStockouts: 0, returnRatePct: 9, agedSharePct: 0, drr7: 1, drr30: 1 },
    T
  );
  assert.equal(ret.status, 'needs_attention');
  assert.ok(ret.reasons.some((r) => r.includes('Return rate')));
  assert.equal(
    skuHealth({ stockFlag: 'OK', fcStockouts: 0, returnRatePct: 0, agedSharePct: 0, drr7: 1, drr30: 1 }, T)
      .status,
    'working'
  );
  // demand falling > 30%
  assert.equal(
    skuHealth({ stockFlag: 'OK', fcStockouts: 0, returnRatePct: 0, agedSharePct: 0, drr7: 0.5, drr30: 1 }, T)
      .status,
    'needs_attention'
  );
});

test('shipment / FC / warehouse health', () => {
  assert.equal(
    shipmentHealth(
      { flag: 'Closed - short received (raise case)', status: 'Closed', shortfall: 40, fillRate: 60 },
      T
    ).status,
    'not_working'
  );
  assert.equal(
    shipmentHealth({ flag: 'Receiving', status: 'Receiving', shortfall: 0, fillRate: 58 }, T).status,
    'needs_attention'
  );
  assert.equal(
    shipmentHealth({ flag: 'Closed - OK', status: 'Closed', shortfall: 0, fillRate: 100 }, T).status,
    'working'
  );
  assert.equal(skuFcHealth({ fcFlag: 'Stockout at FC' }, T).status, 'not_working');
  assert.equal(
    warehouseHealth(
      { skusStockedOut: 2, shipmentsShort: 0, shipmentsStuckOrDelayed: 0, lowCoverSkus: 0, excessSkus: 0 },
      T
    ).status,
    'not_working'
  );
  assert.equal(
    warehouseHealth(
      { skusStockedOut: 0, shipmentsShort: 0, shipmentsStuckOrDelayed: 0, lowCoverSkus: 3, excessSkus: 1 },
      T
    ).status,
    'needs_attention'
  );
});
