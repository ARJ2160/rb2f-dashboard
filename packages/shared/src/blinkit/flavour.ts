import type { MetricKey } from './metrics';

/* Quick-commerce "flavours". Blinkit and Swiggy Instamart share one API shape
   (/api/blinkit/* and /api/instamart/* return the same response types) and one
   set of dashboard views; a flavour says what differs: which metrics exist,
   what they are called, the ad types and whether there is an inventory feed. */

export type QcMarket = 'blinkit' | 'instamart';

export interface QcFlavour {
  id: QcMarket;
  label: string;
  /** API mount point */
  apiBase: string;
  /** Logo / GCS marketplace id */
  logo: 'blinkit' | 'swiggy_instamart';
  /** Metrics the reports don't carry for this marketplace — hidden everywhere. */
  hidden: MetricKey[];
  /** Label overrides (e.g. "Avg Ad Rank" instead of "Most Viewed Pos"). */
  labels: Partial<Record<MetricKey, string>>;
  /** Ad-type codes in the order the overview / keyword filters show them. */
  adTypes: Array<{ value: string; label: string }>;
  /** Has an inventory feed (Inventory · DOC tab). */
  inventory: boolean;
  /** Ad reports carry a city on every row (Instamart) vs. only via the campaign mapper (Blinkit). */
  nativeAdCity: boolean;
  /** "Sales report" wording for notes. */
  salesSource: string;
}

export const QC_FLAVOURS: Record<QcMarket, QcFlavour> = {
  blinkit: {
    id: 'blinkit',
    label: 'Blinkit',
    apiBase: '/api/blinkit',
    logo: 'blinkit',
    hidden: ['clicks', 'ctr', 'cpc'],
    labels: {},
    adTypes: [
      { value: 'PL', label: 'Product Listing' },
      { value: 'PR', label: 'Product Recommendation' },
      { value: 'BL', label: 'Banner Listing' },
    ],
    inventory: true,
    nativeAdCity: false,
    salesSource: 'Blinkit Sales report',
  },
  instamart: {
    id: 'instamart',
    label: 'Swiggy Instamart',
    apiBase: '/api/instamart',
    logo: 'swiggy_instamart',
    // The Instamart sales export is aggregated per day × store × item — no order IDs, so no order counts / AOV; no "new users" in ads.
    hidden: ['orders', 'aov', 'nu'],
    labels: {
      rev: 'Revenue (GMV)',
      mvp: 'Avg Ad Rank',
      aunits: 'Ad Conversions',
      dsales: 'Direct GMV (7d)',
      cvr: 'Conversion % (conv. ÷ ATC)',
    },
    adTypes: [
      { value: 'KW', label: 'Keyword Based Ads' },
      { value: 'SIB', label: 'Search Inline Banner' },
      { value: 'AS', label: 'Auto Suggest' },
    ],
    inventory: false,
    nativeAdCity: true,
    salesSource: 'Instamart Sales report',
  },
};

export const IM_AD_TYPE_LABEL: Record<string, string> = Object.fromEntries(QC_FLAVOURS.instamart.adTypes.map((t) => [t.value, t.label]));

/** Report types the Instamart ingest recognises (GCS sync / upload results). */
export type ImReportType = 'im_sales' | 'im_ads' | 'im_sku_mapper' | 'unknown';
export const IM_REPORT_LABEL: Record<ImReportType, string> = {
  im_sales: 'Instamart Sales',
  im_ads: 'Instamart Ads',
  im_sku_mapper: 'Instamart SKU mapper',
  unknown: 'Not recognised',
};
