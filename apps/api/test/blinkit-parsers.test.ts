import assert from 'node:assert/strict';
import { test } from 'node:test';

import { idStr, inferDateOrder, num, toISODate } from '../src/blinkit/ingestion/clean';
import { detectReport } from '../src/blinkit/ingestion/detect-report';
import { parseAds } from '../src/blinkit/ingestion/parsers/ads';
import { parseInventory } from '../src/blinkit/ingestion/parsers/inventory';
import { parseCampaignMapper, parseSkuMapper } from '../src/blinkit/ingestion/parsers/mappers';
import { parseSales } from '../src/blinkit/ingestion/parsers/sales';
import { sheetFromGrid } from '../src/blinkit/ingestion/sheet-grid';
import { blinkitSyncOrder } from '../src/gcs/paths';

test('blinkit cleaning: day-first dates, Excel serials, ₹ numbers, float IDs', () => {
  assert.equal(toISODate('01-10-2026'), '2026-10-01');
  assert.equal(toISODate('2026-10-17'), '2026-10-17');
  assert.equal(toISODate(46296), '2026-10-01');
  assert.equal(toISODate('17 Oct 2026'), '2026-10-17');
  assert.equal(num('₹1,234.5'), 1234.5);
  assert.equal(num('--'), 0);
  assert.equal(idStr(10205042.0), '10205042');
  assert.equal(idStr('480252.0'), '480252');
});

const SALES = ['Order Id', 'Order Date', 'Item Id', 'Product Name', 'Customer City', 'Customer State', 'Order Status', 'Quantity', 'Selling Price (Rs)', 'Total Gross Bill Amount'];

test('blinkit sales: detected by columns, duplicate lines dropped, cancellations excluded, city normalised', () => {
  const s = sheetFromGrid(
    [
      SALES,
      [1, '2026-10-17', 10205890, 'Honey', 'Bangalore', 'Karnataka', 'DELIVERED', 1, 309, 309],
      [1, '2026-10-17', 10205890, 'Honey', 'Bangalore', 'Karnataka', 'DELIVERED', 1, 309, 309],
      [2, '2026-10-18', 10205890, 'Honey', 'Delhi', 'Delhi', 'CANCELLED', 2, 309, 618],
      [3, '2026-10-18', 10205053, 'Jam', 'Delhi', 'Delhi', 'DELIVERED', 2, 299, 598],
    ],
    'sales/Total_Sales.xlsx',
    'Sales Summary'
  );
  assert.equal(detectReport(s), 'bk_sales');
  const p = parseSales(s);
  assert.equal(p.records.length, 2);
  assert.equal(p.records[0]!.customerCity, 'Bengaluru');
  assert.equal(p.records.reduce((a, r) => a + r.revenue, 0), 907);
  assert.deepEqual(p.dates, ['2026-10-17', '2026-10-18']);
});

test('blinkit ads: PL / PR / BL by columns; duplicate keys summed; Most Viewed Position impression-weighted', () => {
  const pl = sheetFromGrid(
    [
      ['Date', 'Campaign ID', 'Campaign Name', 'Targeting Type', 'Targeting Value', 'Match Type', 'Most Viewed Position', 'Pacing Type', 'CPM', 'Impressions', 'Direct ATC', 'Indirect ATC', 'Direct Quantities Sold', 'Indirect Quantities Sold', 'Direct Sales', 'Indirect Sales', 'New Users Acquired', 'Estimated Budget Consumed'],
      ['01-10-2026', 480252, 'Jam | MxB | SP | ROC | H', 'Keyword', 'Jam', 'EXACT', 5, 'DAILY', 346, 1000, 16, 1, 8, 1, 2392, 100, 7, 509.6],
      ['01-10-2026', 480252, 'Jam | MxB | SP | ROC | H', 'Keyword', 'jam', 'EXACT', 1, 'DAILY', 346, 1000, 0, 0, 0, 0, 0, 0, 0, 10],
    ],
    'ads/Report.xls',
    'PRODUCT_LISTING'
  );
  assert.equal(detectReport(pl), 'bk_ads_product_listing');
  assert.equal(detectReport(sheetFromGrid([['Date', 'Campaign ID', 'Campaign Name', 'Targeting Type', 'Impressions', 'Reach', 'Unique Clicks', 'Estimated Budget Consumed']], 'x', 'BANNER_LISTING')), 'bk_ads_banner_listing');
  assert.equal(detectReport(sheetFromGrid([['Date', 'Campaign ID', 'Campaign Name', 'Targeting Type', 'Impressions', 'Direct ATC', 'Estimated Budget Consumed']], 'x', 'PRODUCT_RECOMMENDATION')), 'bk_ads_product_reco');
  const r = parseAds(pl, 'PL').records;
  assert.equal(r.length, 1);
  assert.ok(Math.abs(r[0]!.spend - 519.6) < 1e-9);
  assert.equal(r[0]!.mvpWeighted / r[0]!.mvpImpr, 3);
  assert.equal(r[0]!.directSales + r[0]!.indirectSales, 2492);
});

const INV_HEADER = ['Item ID', 'Item Name', 'Brand Name', 'UPC', 'UoM', 'Warehouse Facility ID', 'Warehouse Facility Name', 'Net scheduled inventory', 'Incoming scheduled inventory', 'Recalled inventory', 'Total sellable', 'Warehouse', 'In-between', 'Darkstore', 'Total unsellable', 'Damaged', 'Lost', 'Expired', 'Near Expiry', 'Last 7 days', 'Last 15 days', 'Last 30 days'];
const INV_ROW = [10205042, 'Tulsi Honey', 'Eatopia', 1, '500 g', 2010, 'Kundli Feeder', 24, 24, 0, 141, 38, 12, 91, 1, 1, 0, 0, 0, 22, 46, 78];

test('blinkit inventory: snapshot date from the "generated at" line, else the file name, else rejected', () => {
  const s = sheetFromGrid([['This sheet was generated at 2026-10-27 19:11:17'], ['Product details', null, 'Warehouse details'], INV_HEADER, INV_ROW], 'inventory/InventoryData.xlsx', 'Stock On Hand');
  assert.equal(detectReport(s), 'bk_inventory');
  const p = parseInventory(s);
  assert.deepEqual(p.dates, ['2026-10-27']);
  assert.equal(p.records[0]!.sellable, 141);
  assert.equal(p.records[0]!.sold7d, 22);
  assert.deepEqual(parseInventory(sheetFromGrid([INV_HEADER, INV_ROW], 'InventoryData - 2026-10-28T091120.750.xlsx', 's')).dates, ['2026-10-28']);
  assert.equal(parseInventory(sheetFromGrid([INV_HEADER, INV_ROW], 'master.xlsx', 'SOH Dump')).records.length, 0);
});

test('blinkit mappers: simple campaign mapper with City, side-by-side ID blocks, SKU mapper ignores campaign rows', () => {
  const simple = sheetFromGrid([['Campaign Name', 'Category', 'SKU', 'City'], ['Jam | Pune', 'Jam', 'Mixedberry Jam', 'Pune']], 'campaign_mapper.csv', 'Sheet1');
  assert.equal(detectReport(simple), 'bk_campaign_mapper');
  assert.equal(parseCampaignMapper(simple).records[0]!.city, 'Pune');
  const blocks = sheetFromGrid(
    [
      ['Campaign ID (Product Listing)', 'Campaign Name', 'City', 'Product', null, 'Campaign ID (Product Recommedation)', 'Campaign Name', 'City', 'Product'],
      [282935, 'Jam/Kwr/Slow KW/Pune', 'Pune', 'Jam', null, 283581, 'Jam/Reco/Mumbai', 'Mumbai', 'Jam'],
    ],
    'master.xlsx',
    'City & Product Mapper'
  );
  assert.deepEqual(parseCampaignMapper(blocks).records.map((r) => [r.key, r.city]), [['id:282935', 'Pune'], ['id:283581', 'Mumbai']]);
  const sku = sheetFromGrid([['Product Name', 'SKU', 'Category', 'Price'], ['Eatopia Tomato Ketchup', 'Ketchup', 'Ketchup', null], ['Ketchup | SP | H | N 1', 'Ketchup', 'Ketchup', null]], 'm', 'SKU Mapper');
  assert.equal(detectReport(sku), 'bk_sku_mapper');
  assert.equal(parseSkuMapper(sku).records.length, 1);
});

test('blinkit GCS sync order: mappers → ads → sales → inventory', () => {
  const prefix = 'eatopia/blinkit/';
  const o = (name: string, updated = '2026-10-28') => ({ name: prefix + name, generation: '1', size: 1, updated });
  const sorted = blinkitSyncOrder([o('inventory/i.xlsx'), o('sales/s.xlsx'), o('ads/a.xls'), o('sku_mapper/m.csv'), o('campaign_mapper/c.csv')], prefix);
  assert.deepEqual(sorted.map((x) => x.name.slice(prefix.length).split('/')[0]), ['campaign_mapper', 'sku_mapper', 'ads', 'sales', 'inventory']);
});

// ── Warehouse layout: eatopia/blinkit/{ads_sales/*, campaign_mapper, sku_mapper, total_sales} ──

test('blinkit dates: M/D/YYYY in total_sales is inferred per column; ambiguous columns use the file-name range', () => {
  assert.equal(inferDateOrder(['2/1/2026', '2/13/2026']), 'mdy');
  assert.equal(inferDateOrder(['13-02-2026', '01-02-2026']), 'dmy');
  // Only ambiguous values: the _YYYYMMDD_YYYYMMDD range in the name decides (all of Feb → M/D).
  assert.equal(inferDateOrder(['2/1/2026', '2/3/2026', '2/12/2026'], 'eatopia_total_sales_20260201_20260628.csv'), 'mdy');
  assert.equal(toISODate('2/13/2026', 'mdy'), '2026-02-13');
  assert.equal(toISODate('13/2/2026', 'mdy'), null);
});

test('blinkit total_sales: S.No. keeps two genuine lines of one order × item; true repeats still dropped', () => {
  const H = ['S.No.', 'Order Id', 'Order Date', 'Item Id', 'Product Name', 'Customer City', 'Customer State', 'Order Status', 'Quantity', 'Selling Price (Rs)', 'Total Gross Bill Amount'];
  const s = sheetFromGrid(
    [
      H,
      [1, 'A1', '2/1/2026', 10205890, 'Honey', 'Bangalore', 'Karnataka', 'DELIVERED', 1, 309, 309],
      [2, 'A1', '2/1/2026', 10205890, 'Honey', 'Bangalore', 'Karnataka', 'DELIVERED', 1, 309, 309],
      [2, 'A1', '2/1/2026', 10205890, 'Honey', 'Bangalore', 'Karnataka', 'DELIVERED', 1, 309, 309],
      [3, 'A2', '2/13/2026', 10205053, 'Jam', 'Delhi', 'Delhi', 'DELIVERED', 2, 299, 598],
    ],
    'total_sales/eatopia_total_sales_20260201_20260628.csv',
    'Sheet1'
  );
  assert.equal(detectReport(s), 'bk_sales');
  const p = parseSales(s);
  assert.equal(p.records.length, 2);
  assert.equal(p.records.find((r) => r.orderId === 'A1')!.quantity, 2);
  assert.equal(p.records.reduce((a, r) => a + r.revenue, 0), 1216);
  assert.deepEqual(p.dates, ['2026-02-01', '2026-02-13']);
});

test('blinkit campaign mapper: an unlabelled column right after "Campaign Name" is read as its category', () => {
  const s = sheetFromGrid(
    [
      ['Campaign Name', null, null, 'Campaign Name', 'Category', 'Targeting Type'],
      ['Jam Kwr/Hyd', 'Jam', null, 'Branded', 'Branded', 'Keyword'],
      ['RB/Kids Honey/ PNQ', 'Honey', null, null, null, null],
    ],
    'campaign_mapper/eatopia_campaign_mapper.csv',
    'Sheet1'
  );
  assert.equal(detectReport(s), 'bk_campaign_mapper');
  const byName = new Map(parseCampaignMapper(s).records.map((r) => [r.campaignName, r.category]));
  assert.equal(byName.get('Jam Kwr/Hyd'), 'Jam');
  assert.equal(byName.get('RB/Kids Honey/ PNQ'), 'Honey');
  assert.equal(byName.get('Branded'), 'Branded');
});

test('blinkit GCS sync order: warehouse folders (ads_sales/*, total_sales) rank as ads then sales', () => {
  const prefix = 'eatopia/blinkit/';
  const o = (name: string) => ({ name: prefix + name, generation: '1', size: 1, updated: '2026-10-28' });
  const sorted = blinkitSyncOrder(
    [o('total_sales/s.csv'), o('ads_sales/product_listing/p.csv'), o('sku_mapper/m.csv'), o('ads_sales/banner_listing/b.csv'), o('campaign_mapper/c.csv'), o('ads_sales/product_recommendation/r.csv')],
    prefix
  );
  assert.deepEqual(sorted.map((x) => x.name.slice(prefix.length).split('/')[0]), ['campaign_mapper', 'sku_mapper', 'ads_sales', 'ads_sales', 'ads_sales', 'total_sales']);
});
