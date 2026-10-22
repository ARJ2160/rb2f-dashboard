import assert from 'node:assert/strict';
import { test } from 'node:test';

import { collectAttrs, looksVideo } from '../src/lib/ad-type';
import { parseHourCell } from '../src/lib/dates';

test('parseHourCell: numbers, Excel fractions, strings', () => {
  assert.equal(parseHourCell(0), 0);
  assert.equal(parseHourCell(23), 23);
  assert.equal(parseHourCell(0.5), 12); // Excel time fraction
  assert.equal(parseHourCell('07:00'), 7);
  assert.equal(parseHourCell('7 - 8'), 7);
  assert.equal(parseHourCell('12 AM'), 0);
  assert.equal(parseHourCell('3pm'), 15);
  assert.equal(parseHourCell(''), null);
  assert.equal(parseHourCell(24), null);
  assert.equal(parseHourCell('abc'), null);
});

test('looksVideo: SBV/SDV/video tokens, not substrings', () => {
  assert.equal(looksVideo('Cult_SBV_Running'), true);
  assert.equal(looksVideo('Brand Video Ad'), true);
  assert.equal(looksVideo(null, 'SDV-retarget'), true);
  assert.equal(looksVideo('Cult_SB_Store'), false);
  assert.equal(looksVideo('Providence shoes'), false);
});

test('collectAttrs: one per campaign, video if any row says so', () => {
  const out = collectAttrs([
    { campaignName: 'A', channel: 'sb', isVideo: false },
    { campaignName: 'A', channel: 'sb', isVideo: true },
    { campaignName: 'B', channel: 'sp', isVideo: false },
  ]);
  assert.deepEqual(out, [
    { campaignName: 'A', channel: 'sb', isVideo: true },
    { campaignName: 'B', channel: 'sp', isVideo: false },
  ]);
});
