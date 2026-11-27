import assert from 'node:assert/strict';
import { test } from 'node:test';

import { packBySize } from '@dash/shared';

/** Minimal stand-in for a File — packBySize only looks at `size`. */
const f = (name: string, size: number) => ({ name, size });
const names = (chunks: Array<Array<{ name: string }>>) => chunks.map((c) => c.map((x) => x.name));

test('packBySize: empty input yields no chunks', () => {
  assert.deepEqual(packBySize([], 100), []);
});

test('packBySize: everything under the budget stays in one chunk', () => {
  const chunks = packBySize([f('a', 10), f('b', 20), f('c', 30)], 100);
  assert.deepEqual(names(chunks), [['a', 'b', 'c']]);
});

test('packBySize: opens a new chunk when the next item would exceed the budget', () => {
  // 40 + 40 = 80 (<= 100); + 40 = 120 (> 100) → c starts a new chunk
  const chunks = packBySize([f('a', 40), f('b', 40), f('c', 40)], 100);
  assert.deepEqual(names(chunks), [['a', 'b'], ['c']]);
});

test('packBySize: an item filling the budget exactly keeps the chunk; the next opens a new one', () => {
  // 60 + 40 = 100 (== budget, stays); next byte spills over
  const chunks = packBySize([f('a', 60), f('b', 40), f('c', 1)], 100);
  assert.deepEqual(names(chunks), [['a', 'b'], ['c']]);
});

test('packBySize: a single over-budget item gets its own chunk and does not swallow the next', () => {
  const chunks = packBySize([f('big', 250), f('a', 10)], 100);
  assert.deepEqual(names(chunks), [['big'], ['a']]);
});

test('packBySize: consecutive over-budget items each get their own chunk', () => {
  const chunks = packBySize([f('x', 200), f('y', 300)], 100);
  assert.deepEqual(names(chunks), [['x'], ['y']]);
});

test('packBySize: preserves order, loses no items, and keeps multi-item chunks within budget', () => {
  const items = Array.from({ length: 20 }, (_, i) => f(`f${i}`, 30));
  const chunks = packBySize(items, 100); // 3 per chunk (90); a 4th would be 120
  assert.deepEqual(
    chunks.flat().map((x) => x.name),
    items.map((x) => x.name)
  );
  for (const c of chunks) {
    if (c.length > 1) {
      const total = c.reduce((s, x) => s + x.size, 0);
      assert.ok(total <= 100, `chunk total ${total} exceeds budget`);
    }
  }
});
