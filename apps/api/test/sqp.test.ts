import assert from 'node:assert/strict';
import { test } from 'node:test';

import { detectReportType } from '../src/ingestion/detect-report';
import {
  parseSearchQueryPerformance,
  periodFromName,
  periodFromPreamble,
  rekeyTwoRowHeader,
} from '../src/ingestion/parsers/search-query-performance';
import { readWorkbook } from '../src/ingestion/sheet-reader';
import { decideHarvest, isAsinTerm } from '../src/reports/harvest-rules';
import { compareBy, scoreQuery, type SqpCounts } from '../src/reports/sqp-scoring';

const FLAT_HEADER =
  'Search Query,Search Query Score,Search Query Volume,Impressions: Total Count,Impressions: Brand Count,Impressions: Brand Share %,Clicks: Total Count,Clicks: Click Rate %,Clicks: Brand Count,Cart Adds: Total Count,Cart Adds: Brand Count,Purchases: Total Count,Purchases: Brand Count,Reporting Date';

test('SQP flat export: header found under Amazon metadata line, period from that line, queries normalised and merged', () => {
  const csv = [
    'Brand=["Cult"],Reporting Range=["Weekly"],Select week=["Week 41 | 2026-10-05 - 2026-10-11 2026"]',
    FLAT_HEADER,
    '"shoes for men",1,"12,000",50000,5000,10%,1000,2%,150,300,60,100,25,2026-10-11',
    `"'Shoes  For Men",1,12000,10,0,0%,0,0%,0,0,0,0,0,2026-10-11`,
    'running shoes,2,8000,40000,2000,5%,800,2%,30,200,10,90,4,2026-10-11',
  ].join('\n');
  const [sheet] = readWorkbook(Buffer.from(csv), {});
  assert.ok(sheet);
  assert.equal(detectReportType(sheet.headers, sheet.sheetName, 'export.csv')?.reportType, 'search_query_performance');
  const r = parseSearchQueryPerformance(sheet.headers, sheet.rows, { nameDates: null, preamble: sheet.preamble }, [sheet.sheetName, 'export.csv']);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.period, { from: '2026-10-05', to: '2026-10-11' });
  assert.equal(r.records.length, 2);
  const men = r.records.find((x) => x.searchQuery === 'shoes for men')!;
  assert.equal(men.volume, 12000); // max, not doubled
  assert.equal(men.impressionsTotal, 50010);
  assert.equal(men.clicksBrand, 150);
  assert.equal(men.purchasesBrand, 25);
});

test('SQP two-row header (group row above "Total Count / Brand Count") is re-keyed', () => {
  // Simulate what readWorkbook produces when the group row is taken as the
  // header: columns become __col_N for the empty cells and the group names
  // for the populated ones. The *real* header ("Search Query", "Total Count",
  // etc.) lands as the first data row. rekeyTwoRowHeader must detect this
  // and rebuild the keys as "Impressions: Total Count", etc.
  const headers = [
    '__col_0', '__col_1', 'Impressions', '__col_3',
    'Clicks', '__col_5', 'Cart Adds', '__col_7',
    'Purchases', '__col_9',
  ];
  const rows = [
    // row 0 — the actual column-name row (misidentified as data)
    { '__col_0': 'Search Query', '__col_1': 'Search Query Volume',
      'Impressions': 'Total Count', '__col_3': 'Brand Count',
      'Clicks': 'Total Count', '__col_5': 'Brand Count',
      'Cart Adds': 'Total Count', '__col_7': 'Brand Count',
      'Purchases': 'Total Count', '__col_9': 'Brand Count' },
    // row 1 — actual data
    { '__col_0': 'yoga mat', '__col_1': 900,
      'Impressions': 10000, '__col_3': 1000,
      'Clicks': 400, '__col_5': 60,
      'Cart Adds': 100, '__col_7': 20,
      'Purchases': 40, '__col_9': 9 },
  ];

  // rekeyTwoRowHeader must rebuild headers and strip the false "data" row
  const rekeyed = rekeyTwoRowHeader(headers, rows);
  assert.deepEqual(rekeyed.headers, [
    'Search Query', 'Search Query Volume',
    'Impressions: Total Count', 'Impressions: Brand Count',
    'Clicks: Total Count', 'Clicks: Brand Count',
    'Cart Adds: Total Count', 'Cart Adds: Brand Count',
    'Purchases: Total Count', 'Purchases: Brand Count',
  ]);
  assert.equal(rekeyed.rows.length, 1);
  assert.equal(rekeyed.rows[0]?.['Impressions: Total Count'], 10000);

  // Full parse with period from filename
  const name = 'search_query_performance/cult_sqp_20260701_20260731.xlsx';
  const r = parseSearchQueryPerformance(headers, rows, { nameDates: null, preamble: [] }, ['Sheet1', name]);
  assert.equal(r.error, undefined);
  assert.deepEqual(r.period, { from: '2026-07-01', to: '2026-07-31' });
  assert.deepEqual(r.records, [
    {
      periodStart: '2026-07-01', periodEnd: '2026-07-31', searchQuery: 'yoga mat', volume: 900,
      impressionsTotal: 10000, impressionsBrand: 1000, clicksTotal: 400, clicksBrand: 60,
      cartAddsTotal: 100, cartAddsBrand: 20, purchasesTotal: 40, purchasesBrand: 9,
    },
  ]);
});

test('SQP period: month / quarter metadata, file names, and refusal without one', () => {
  assert.deepEqual(periodFromPreamble(['Reporting Range=["Monthly"] Select month=["February 2026"]']), { from: '2026-02-01', to: '2026-02-28' });
  assert.deepEqual(periodFromPreamble(['Reporting Range=["Quarterly"] Select quarter=["Q3 2026"]']), { from: '2026-07-01', to: '2026-09-30' });
  assert.deepEqual(periodFromName('SQP_2026-04-01_2026-04-30.csv'), { from: '2026-04-01', to: '2026-04-30' });
  assert.equal(periodFromName('SQP_2026-04-01.csv'), null); // one day is not a period
  const r = parseSearchQueryPerformance(['Search Query', 'Search Query Volume'], [{ 'Search Query': 'x', 'Search Query Volume': 1 }], { nameDates: null, preamble: [] }, ['Sheet1', 'sqp.csv']);
  assert.match(r.error ?? '', /reporting period/);
});

test('SQP: refuses a file whose count columns are not recognised (would store all zeros)', () => {
  const r = parseSearchQueryPerformance(
    ['Search Query', 'Search Query Volume', 'Clicks: Click Rate %'],
    [{ 'Search Query': 'x', 'Search Query Volume': 5, 'Clicks: Click Rate %': '2%' }],
    { nameDates: null, preamble: ['Select week=["Week 1 | 2026-01-04 - 2026-01-10 2026"]'] },
    []
  );
  assert.match(r.error ?? '', /Nothing was stored/);
});

const base: SqpCounts = {
  searchQuery: 'q', volume: 1000,
  impressionsTotal: 100_000, impressionsBrand: 10_000, // CTR cat 1%, brand 2%
  clicksTotal: 1000, clicksBrand: 200,
  cartAddsTotal: 100, cartAddsBrand: 30, // ATC cat 10%, brand 15%
  purchasesTotal: 50, purchasesBrand: 10, // purchase cat 50%, brand 33%
};

test('scoring: strength = how many of CTR / add-to-cart / purchase beat category', () => {
  // base: CTR 2% vs 1% (win), ATC 15% vs 10% (win), purchase 33% vs 50% (lose) → Medium
  const s = scoreQuery(base, undefined, 20);
  assert.equal(s.ctrBrandPct, 2);
  assert.equal(s.ctrCategoryPct, 1);
  assert.equal(s.wins, 2);
  assert.equal(s.isOpportunity, true);
  assert.equal(s.strength, 'Medium');
  assert.equal(s.targeted, 'Not Targeted');
  assert.equal(s.launchIn, 'SP & SB');
  assert.equal(s.spend, null);
  assert.equal(s.acosPct, null);
  assert.match(s.basis, /Brand CTR 2\.0% vs category 1\.0% — beats category\./);

  const strong = scoreQuery({ ...base, purchasesBrand: 20 }, undefined, null); // purchase 66.7% vs 50%
  assert.equal(strong.strength, 'Strong');
  const low = scoreQuery({ ...base, cartAddsBrand: 10, purchasesBrand: 1 }, undefined, null); // only CTR wins
  assert.equal(low.strength, 'Low');
  assert.equal(low.isOpportunity, true);
  const purchaseOnly = scoreQuery({ ...base, clicksBrand: 50, cartAddsBrand: 2, purchasesBrand: 2 }, undefined, null); // CTR 0.5%, ATC 4%, purchase 100%
  assert.equal(purchaseOnly.strength, 'Low');
  const none = scoreQuery({ ...base, clicksBrand: 50, cartAddsBrand: 2, purchasesBrand: 0 }, undefined, null);
  assert.equal(none.wins, 0);
  assert.equal(none.isOpportunity, false);
  assert.equal(none.strength, null);
});

test('scoring: click threshold and full targeting still disqualify; shares are brand ÷ total', () => {
  const thin = scoreQuery({ ...base, clicksBrand: 15, cartAddsBrand: 3 }, undefined, null);
  assert.equal(thin.isOpportunity, false, 'clicks must be > 15');
  assert.equal(thin.strength, null);
  const both = scoreQuery(base, { channels: ['SP', 'SB'], spend: 100, adSales: 200 }, 30);
  assert.equal(both.isOpportunity, false, 'already in SP & SB');
  assert.equal(both.launchIn, null);
  assert.equal(both.acosVsAccount, 'worse'); // 50% vs 30%
  const sp = scoreQuery(base, { channels: ['SP'], spend: 10, adSales: 100 }, 30);
  assert.equal(sp.isOpportunity, true);
  assert.equal(sp.launchIn, 'SB');
  assert.equal(sp.acosPct, 10);
  assert.equal(sp.acosVsAccount, 'better');
  // Zero denominators give null rates, which never win.
  const noImpr = scoreQuery({ ...base, impressionsBrand: 0 }, undefined, null);
  assert.equal(noImpr.ctrBrandPct, null);
  assert.equal(noImpr.strength, 'Low'); // ATC still wins
  assert.equal(sp.impressionShare, 10);
  assert.equal(sp.clickShare, 20);
  assert.equal(sp.cartAddShare, 30);
  assert.equal(sp.purchaseShare, 20);
});

test('sorting: strength first (Strong → Low), missing values last for metrics', () => {
  const rows = [
    scoreQuery({ ...base, searchQuery: 'a' }, undefined, null),
    scoreQuery({ ...base, searchQuery: 'b' }, { channels: ['SP'], spend: 5, adSales: 100 }, null),
    scoreQuery({ ...base, searchQuery: 'c' }, { channels: ['SB'], spend: 50, adSales: 100 }, null),
  ];
  assert.deepEqual([...rows].sort(compareBy('acos')).map((r) => r.query), ['c', 'b', 'a']);
  const tiers = [
    scoreQuery({ ...base, searchQuery: 'low', cartAddsBrand: 10, purchasesBrand: 1 }, undefined, null),
    scoreQuery({ ...base, searchQuery: 'strong', purchasesBrand: 20 }, undefined, null),
    scoreQuery({ ...base, searchQuery: 'medium' }, undefined, null),
  ];
  assert.deepEqual([...tiers].sort(compareBy('strength')).map((r) => r.query), ['strong', 'medium', 'low']);
});

test('harvesting: multiple orders + missing a manual target in SP and/or SB', () => {
  const t = { orders: 4, spOrders: 4, sbOrders: 0, manualSp: false, manualSb: false, minOrders: 2 };
  assert.deepEqual(decideHarvest(t), { performingIn: 'SP', harvestInto: 'SP & SB' });
  assert.deepEqual(decideHarvest({ ...t, manualSp: true }), { performingIn: 'SP', harvestInto: 'SB' });
  assert.deepEqual(decideHarvest({ ...t, sbOrders: 1, orders: 5, manualSb: true }), { performingIn: 'SP & SB', harvestInto: 'SP' });
  assert.equal(decideHarvest({ ...t, manualSp: true, manualSb: true }), null, 'already manual in both');
  assert.equal(decideHarvest({ ...t, orders: 1, spOrders: 1 }), null, 'one order is not multiple');
  assert.equal(isAsinTerm('b0abc12345'), true);
  assert.equal(isAsinTerm('shoes for men'), false);
});
