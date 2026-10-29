import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Cooldowns, formatWait, RateLimiter, Semaphore } from '../src/lib/limits';

test('rate limiter: allows `limit` hits per window per key, then resets', () => {
  let now = 1_000;
  const rl = new RateLimiter(3, 60_000, () => now);
  assert.deepEqual(
    [1, 2, 3, 4].map(() => rl.hit('alice@x.com').allowed),
    [true, true, true, false]
  );
  assert.equal(rl.hit('bob@x.com').allowed, true, 'keys are independent');
  const blocked = rl.hit('alice@x.com');
  assert.equal(blocked.remaining, 0);
  assert.equal(blocked.resetAt, 61_000);
  now = 61_000;
  assert.equal(rl.hit('alice@x.com').allowed, true, 'new window');
});

test('semaphore: never runs more than `max` tasks and runs queued ones in order', async () => {
  const sem = new Semaphore(2);
  let active = 0;
  let peak = 0;
  const order: number[] = [];
  const task = (i: number, ms: number) =>
    sem.run(async () => {
      active++;
      peak = Math.max(peak, active);
      await new Promise((r) => setTimeout(r, ms));
      order.push(i);
      active--;
      return i;
    });
  const results = await Promise.all([task(1, 30), task(2, 10), task(3, 5), task(4, 5)]);
  assert.deepEqual(results, [1, 2, 3, 4]);
  assert.equal(peak, 2);
  assert.equal(sem.running, 0);
  assert.equal(sem.waiting, 0);
  assert.deepEqual(order.slice(0, 1), [2], 'the short task finishes first and frees a slot');
});

test('semaphore: a failing task releases its slot', async () => {
  const sem = new Semaphore(1);
  await assert.rejects(sem.run(() => Promise.reject(new Error('boom'))), /boom/);
  assert.equal(await sem.run(async () => 'next'), 'next');
});

test('cooldowns: remaining time, availableAt, expiry', () => {
  let now = Date.parse('2026-10-29T10:00:00Z');
  const c = new Cooldowns(() => now);
  assert.equal(c.remainingMs('amazon:eatopia'), 0);
  assert.equal(c.availableAt('amazon:eatopia'), null);
  c.start('amazon:eatopia', 120_000);
  assert.equal(c.remainingMs('amazon:eatopia'), 120_000);
  assert.equal(c.availableAt('amazon:eatopia'), '2026-10-29T10:02:00.000Z');
  assert.equal(c.remainingMs('blinkit:eatopia'), 0, 'per key');
  now += 120_000;
  assert.equal(c.remainingMs('amazon:eatopia'), 0);
  c.start('x', 0);
  assert.equal(c.remainingMs('x'), 0, 'a zero cooldown is no cooldown');
});

test('formatWait', () => {
  assert.equal(formatWait(400), '1 s');
  assert.equal(formatWait(45_000), '45 s');
  assert.equal(formatWait(61_000), '2 min');
  assert.equal(formatWait(30 * 60_000), '30 min');
});
