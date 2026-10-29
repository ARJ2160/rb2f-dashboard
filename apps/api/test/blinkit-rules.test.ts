import assert from 'node:assert/strict';
import { test } from 'node:test';

import { daysOfCover, docStatus, feederCity, geoFromCampaignName, parseCityList, resolveCampaignGeo, runRate, salesCityOf } from '@dash/shared/blinkit';

// ── Exact-city rule for Blinkit ads ──

test('city rule: one city / one metro is city-level, several metros only a group, Top City / Pan-India never', () => {
  const pune = parseCityList('Pune');
  assert.equal(pune.kind, 'city');
  assert.equal(parseCityList('Banglore').kind === 'city' && parseCityList('Banglore').kind, 'city');

  const ncrPart = parseCityList('Gurgaon + Delhi');
  assert.equal(ncrPart.kind, 'city');
  assert.deepEqual(ncrPart.kind === 'city' && ncrPart.cities, ['Delhi', 'Gurgaon']);

  const ncr = parseCityList('Delhi NCR');
  assert.equal(ncr.kind === 'city' && ncr.label, 'Delhi NCR');

  assert.equal(parseCityList('Hyderabad, Bengaluru, Mumbai').kind, 'multi');
  for (const t of ['Pan India', 'All', 'All India', 'Top City']) assert.equal(parseCityList(t).kind, 'none', t);
});

test('city rule: live Eatopia campaign names carry no city; the mapper beats the name', () => {
  for (const n of ['Honey | FH | SP | Top City | H | WES', 'Jam | MxB | SP | ROC | H', 'Jam | Spotlight', 'Branded | SP', 'Ketchup | SP | H | N'])
    assert.equal(geoFromCampaignName(n).kind, 'none', n);
  const named = geoFromCampaignName('Jam Slow Kwr/Mumbai');
  assert.equal(named.kind === 'city' && named.label, 'Mumbai');
  assert.equal(geoFromCampaignName('All in One NCR Healthy Namkeen').kind, 'city'); // a product name, not "all cities"
  assert.equal(resolveCampaignGeo('Pan India', 'Jam Kwr/Pune').kind, 'none');
});

// ── Run rate and days of cover ──

test('DOC: run rate = L7D units / 7, DOC = sellable / run rate, null without sales', () => {
  assert.equal(runRate(70), 10);
  assert.equal(daysOfCover(250, runRate(70)), 25);
  assert.equal(daysOfCover(100, runRate(0)), null);
});

test('DOC status bands (7 / 15 / 45 days)', () => {
  assert.equal(docStatus(0, 5, 20), 'stock-out');
  assert.equal(docStatus(0, 0, 0), 'inactive');
  assert.equal(docStatus(40, 0, 3), 'no-sales');
  assert.equal(docStatus(5, 7, 30), 'critical');
  assert.equal(docStatus(10, 7, 30), 'low');
  assert.equal(docStatus(30, 7, 30), 'healthy');
  assert.equal(docStatus(100, 7, 30), 'excess');
});

test('feeder warehouse → city', () => {
  assert.equal(feederCity('Bengaluru B5 - Feeder'), 'Bengaluru');
  assert.equal(feederCity('Kundli Feeder'), 'Delhi NCR');
  assert.equal(feederCity('Mumbai M12 - Feeder Warehouse'), 'Mumbai');
});

test('city rule (warehouse names): 3-letter city codes, "Top 5 cities" never city-level, Noida sales booked as Ghaziabad', () => {
  const city = (n: string) => { const g = geoFromCampaignName(n); return g.kind === 'city' ? g.cities : g.kind; };
  assert.deepEqual(city('Jam Kwr/Hyd'), ['Hyderabad']);
  assert.deepEqual(city('Jam/Slow Kw/Gen/Ahm'), ['Ahmedabad']);
  assert.deepEqual(city('RB/Kids Honey/ PNQ'), ['Pune']);
  assert.deepEqual(city('Jam Kwr/Noida'), ['Noida']);
  assert.notEqual(city('Honey/Top 5 cities'), 'city');
  assert.equal(city('Tulsi Honey/Kw/Gen/Spotlight'), 'none');
  assert.equal(salesCityOf('Noida'), 'Ghaziabad');
  assert.equal(salesCityOf('Pune'), 'Pune');
});
