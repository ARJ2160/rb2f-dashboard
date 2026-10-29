import type { BkReportType } from '@dash/shared/blinkit';
import { normKey } from '@dash/shared/blinkit';
import type { SheetData } from './sheet-grid';

/** Report type from COLUMNS first; sheet / file name only breaks ties. */
export function detectReport(s: SheetData): BkReportType {
  const h = new Set(s.headers);
  const has = (...c: string[]) => c.every((x) => h.has(x));
  const any = (...c: string[]) => c.some((x) => h.has(x));

  if (has('order id', 'item id') && any('total gross bill amount', 'quantity')) return 'bk_sales';
  if (has('item id', 'warehouse facility id') && any('total sellable', 'last 7 days')) return 'bk_inventory';
  if (has('campaign id', 'estimated budget consumed')) {
    if (any('reach', 'unique clicks') && !h.has('direct atc')) return 'bk_ads_banner_listing';
    if (h.has('targeting value')) return 'bk_ads_product_listing';
    if (h.has('direct atc')) return 'bk_ads_product_reco';
  }
  const hasCampaign = s.headers.some((x) => x.startsWith('campaign name') || x.startsWith('campaign id'));
  if (hasCampaign && !h.has('impressions') && any('category', 'city', 'sku', 'product'))
    return 'bk_campaign_mapper';
  if (any('product name', 'item name') && h.has('sku') && !h.has('order id')) return 'bk_sku_mapper';
  if (h.has('item id') && h.has('sku') && !h.has('order id')) return 'bk_sku_mapper';

  // name fallbacks (headers already ruled out everything else)
  const n = normKey(s.sheetName + ' ' + s.fileName);
  if (/sku mapper/.test(n) && h.has('sku')) return 'bk_sku_mapper';
  if (/campaign mapper/.test(n) && hasCampaign) return 'bk_campaign_mapper';
  return 'unknown';
}
