import assert from 'node:assert/strict';
import { test } from 'node:test';

import { readWorkbook } from '../src/ingestion/sheet-reader';
import {
  buildTitleIndex,
  channelFromAdProduct,
  channelFromCampaignName,
  detectWarehouseAdKind,
  hasDayOfMonthDates,
  placementLabel,
  resolveDayOfMonth,
  rowDate,
  targetingFromCampaignName,
  toClassicByChannel,
  toUtf8Csv,
  warehouseNameDates,
} from '../src/gcs/warehouse';
import { normalizePlacement } from '../src/ingestion/parsers/placement';
import { syncOrder } from '../src/gcs/paths';

// Headers exactly as in the warehouse exports (adyaorganics, April 2026).
const CAMPAIGN_H =
  'Advertiser account ID,Advertiser account name,Manager accounts,Ad product,Campaign ID,Campaign name,Global Campaign ID,Budget currency,Day of Month,Month,Year,Impressions,Viewable impressions,Clicks,CTR,Viewable CTR (vCTR),Total cost,Purchases,Purchases (new to brand),Cost per purchase,Cost per purchase (new to brand),Sales,Long-term sales,ROAS,Long-term ROAS';
const ADV_H =
  'Budget currency,Advertiser account ID,Advertiser account name,Portfolio ID,Portfolio name,Campaign ID,Campaign name,Ad group ID,Ad group name,Advertised product ID,Advertised product name,Advertised product parent ID,Advertised product brand,Advertised product category,Advertised product subcategory,Advertised product group,Advertised product SKU,Advertised product marketplace,Day of Month,Month,Year,Impressions,Clicks,CTR,Total cost,Purchases,Sales,Units sold';
const PL_H =
  'Budget currency,Advertiser account ID,Advertiser account name,Portfolio ID,Portfolio name,Campaign ID,Campaign name,Ad group ID,Ad group name,Placement name,Placement classification,Site or app,Placement size,Day of Month,Month,Year,Impressions,Clicks,CTR,Total cost,Purchases,Sales,Units sold';
const STR_H =
  'Budget currency,Advertiser account ID,Advertiser account name,Portfolio ID,Portfolio name,Campaign ID,Campaign name,Ad group ID,Ad group name,Search term,Day of Month,Month,Year,Impressions,Clicks,CTR,Total cost,Purchases,Sales,Units sold';
const h = (s: string) => s.split(',');

test('warehouse ad exports are recognised by their columns', () => {
  assert.equal(detectWarehouseAdKind(h(CAMPAIGN_H)), 'campaign');
  assert.equal(detectWarehouseAdKind(h(ADV_H)), 'advertised');
  assert.equal(detectWarehouseAdKind(h(PL_H)), 'placement');
  assert.equal(detectWarehouseAdKind(h(STR_H)), 'search_term');
  assert.equal(
    detectWarehouseAdKind(['Date', 'Campaign Name', 'Impressions', 'Spend']),
    null,
    'classic exports are not warehouse'
  );
});

test('dates, channels, placements, targeting tokens', () => {
  assert.equal(rowDate({ 'Day of Month': '7', Month: '4', Year: '2026' }), '2026-04-07');
  assert.equal(rowDate({ 'Day of Month': '31', Month: '4', Year: '2026' }), null);
  assert.equal(channelFromAdProduct('Sponsored Products'), 'sp');
  assert.equal(channelFromAdProduct('Sponsored Brands'), 'sb');
  assert.equal(channelFromAdProduct('Sponsored Display'), 'sd');
  assert.equal(
    channelFromCampaignName('RB/SB/KT/Date Palm Jaggery Powder/Intent - Mix & Branded/Phrase'),
    'sb'
  );
  assert.equal(channelFromCampaignName('RB/SP/Auto/Honey/Close'), 'sp');
  assert.equal(channelFromCampaignName('RB/SBV/Video'), 'sb');
  assert.equal(channelFromCampaignName('Ghee Spring Sale'), null);
  assert.equal(normalizePlacement(placementLabel('Top of Search on-Amazon')), 'TOS');
  assert.equal(normalizePlacement(placementLabel('Other on-Amazon')), 'ROS');
  assert.equal(normalizePlacement(placementLabel('Detail Page on-Amazon')), 'PDP');
  assert.equal(normalizePlacement(placementLabel('Homepage on-Amazon')), 'Homepage');
  assert.equal(normalizePlacement(placementLabel('')), 'Unknown');
  assert.equal(targetingFromCampaignName('RB/SP/KT/Ghee/Intent - A2/Generic/Exact'), 'KT');
  assert.equal(targetingFromCampaignName('RB/SP/PT/Chana Sattu Powder/Comp - Trageting'), 'PT');
  assert.equal(targetingFromCampaignName('RB/SP/Auto/Chana Sattu Powder'), 'AUTO');
});

test('advertised rows → classic columns split by channel; SB rows resolved by product name', () => {
  const rows = [
    {
      'Campaign name': 'RB/SP/PT/Sattu',
      'Advertised product ID': 'B07Z9ZX7DG',
      'Advertised product name': 'Sattu 1kg',
      'Day of Month': '11',
      Month: '4',
      Year: '2026',
      Impressions: '1957',
      Clicks: '14',
      'Total cost': '302.46',
      Sales: '0',
      'Units sold': '0',
    },
    {
      'Campaign name': 'RB/SB/KT/Sattu',
      'Advertised product ID': '',
      'Advertised product name': 'Sattu  1KG',
      'Day of Month': '15',
      Month: '4',
      Year: '2026',
      Impressions: '6413',
      Clicks: '18',
      'Total cost': '305.56',
      Sales: '1252.38',
      'Units sold': '5',
    },
    {
      'Campaign name': 'RB/SB/KT/Sattu',
      'Advertised product ID': '',
      'Advertised product name': 'Mystery',
      'Day of Month': '15',
      Month: '4',
      Year: '2026',
      'Total cost': '1',
    },
    {
      'Campaign name': 'Unknown thing',
      'Advertised product ID': 'B0X',
      'Day of Month': '15',
      Month: '4',
      Year: '2026',
    },
  ];
  const known = new Map([['rb/sp/pt/sattu', 'sp' as const]]);
  const out = toClassicByChannel(
    'advertised',
    rows,
    (n) => known.get(n.toLowerCase()) ?? channelFromCampaignName(n),
    buildTitleIndex([['Sattu 1kg', 'B07Z9ZX7DG']])
  );
  assert.equal(out.unknownChannel, 1);
  assert.equal(out.unresolvedAsin, 1);
  const sp = out.byChannel.get('sp')!;
  const sb = out.byChannel.get('sb')!;
  assert.deepEqual(sp.rows[0], {
    Date: '2026-04-11',
    'Campaign Name': 'RB/SP/PT/Sattu',
    'Ad Group Name': '',
    Impressions: '1957',
    Clicks: '14',
    Spend: '302.46',
    'Total Sales': '0',
    'Total Units': '0',
    'Advertised ASIN': 'B07Z9ZX7DG',
  });
  assert.deepEqual(
    sb.rows.map((r) => r['Advertised ASIN']),
    ['B07Z9ZX7DG', 'UNKNOWN']
  );
  assert.ok(sb.headers.includes('Advertised ASIN'));
});

test('campaign export: channel from "Ad product", orders stand in for units', () => {
  const out = toClassicByChannel(
    'campaign',
    [
      {
        'Ad product': 'Sponsored Brands',
        'Campaign name': 'X',
        'Day of Month': '28',
        Month: '4',
        Year: '2026',
        'Total cost': '281.8',
        Sales: '341.9',
        Purchases: '1',
      },
    ],
    () => null
  );
  const r = out.byChannel.get('sb')!.rows[0]!;
  assert.equal(r.Spend, '281.8');
  assert.equal(r['Total Orders (#)'], '1');
});

test('business report: day-of-month dates take month/year from the file name', () => {
  assert.deepEqual(warehouseNameDates('seller_central/adyaorganics_business_report_20260401_20260430.csv'), {
    from: '2026-04-01',
    to: '2026-04-30',
  });
  assert.deepEqual(warehouseNameDates('sqp/x_sqp_20260329_20260404.csv'), {
    from: '2026-03-29',
    to: '2026-04-04',
  });
  assert.ok(hasDayOfMonthDates(['Date', 'ASIN'], [{ Date: '1' }, { Date: '30' }]));
  assert.ok(!hasDayOfMonthDates(['Date'], [{ Date: '2026-04-01' }]));
  const { rows, outOfRange } = resolveDayOfMonth(
    [{ Date: '30' }, { Date: '31' }, { Date: '1' }, { Date: '2' }],
    { from: '2026-03-30', to: '2026-04-01' }
  );
  assert.deepEqual(
    rows.map((r) => r.Date),
    ['2026-03-30', '2026-03-31', '2026-04-01', '']
  );
  assert.equal(outOfRange, 1);
});

test('Windows-1252 CSV text becomes UTF-8 (en dash, curly quote) and UTF-8 passes through', () => {
  const cp = Buffer.from([
    ...Buffer.from('Title,ASIN\nRice '),
    0x96,
    ...Buffer.from(' 2 Kg,B0A\nkeya'),
    0x92,
    ...Buffer.from('s,B0B\n'),
  ]);
  const sheet = readWorkbook(toUtf8Csv(cp))[0]!;
  assert.equal(sheet.rows[0]!.Title, 'Rice – 2 Kg');
  assert.equal(sheet.rows[1]!.Title, 'keya’s');
  const utf = Buffer.from('Title,ASIN\nGhee ₹ 1L,B0C\n');
  assert.equal(toUtf8Csv(utf), utf);
});

test('sync order: mappers → campaign → business report → the rest', () => {
  const p = 'b/amazon/';
  const o = (name: string) => ({
    name: p + name,
    generation: '1',
    size: 1,
    updated: '2026-10-01T00:00:00.000Z',
  });
  assert.deepEqual(
    syncOrder(
      [
        o('str/s.csv'),
        o('advertised/a.csv'),
        o('seller_central/business_report/b.csv'),
        o('campaign/c.csv'),
        o('asin_mapper/m.csv'),
      ],
      p
    ).map((x) => x.name.slice(p.length)),
    [
      'asin_mapper/m.csv',
      'campaign/c.csv',
      'seller_central/business_report/b.csv',
      'advertised/a.csv',
      'str/s.csv',
    ]
  );
});
