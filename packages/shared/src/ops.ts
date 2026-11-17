/**
 * Amazon India Inventory / PO / Shipment module — shared types.
 *
 * A second Amazon pipeline, separate from the ads/sales one: it turns raw
 * Vendor Central (1P) and Seller Central / FBA (3P) operational exports into
 * PO, shipment, stock and warehouse views. It is multi-brand from the start —
 * every row is scoped by `brandId` (the ops brand registry, below), which is
 * this module's tenant key the way `profileId` is the ads module's.
 *
 * Phase 1 (this foundation) ships the brand registry, the FC warehouse master,
 * per-brand settings, file-type detection and the upload audit trail. The
 * per-file parsers (and the report views that read them) land in the Vendor
 * Central and Seller Central phases, so every file type is `inScope: false`
 * here — recognised on upload and logged as "parser pending", never dropped.
 */

/** The two Amazon selling channels this module covers. */
export type OpsChannel = 'vc' | 'sc';

/** Every raw operational export the ops pipeline can recognise (file signatures in detect.ts). */
export type OpsFileType =
  | 'vc_po'
  | 'vc_inventory'
  | 'vc_sales'
  | 'sc_ledger_summary'
  | 'sc_ledger_detail'
  | 'sc_fba_inventory'
  | 'sc_shipments'
  | 'sc_shipment_contents';

export const OPS_FILE_TYPES = {
  vc_po: { label: 'Vendor Central — PO Items Export', channel: 'vc', inScope: false },
  vc_inventory: { label: 'Vendor Central — Inventory (Retail Analytics)', channel: 'vc', inScope: false },
  vc_sales: { label: 'Vendor Central — Sales (Retail Analytics)', channel: 'vc', inScope: false },
  sc_ledger_summary: { label: 'Seller Central — Inventory Ledger (Summary)', channel: 'sc', inScope: true },
  sc_ledger_detail: { label: 'Seller Central — Inventory Ledger (Detailed)', channel: 'sc', inScope: true },
  sc_fba_inventory: { label: 'Seller Central — FBA Inventory', channel: 'sc', inScope: true },
  sc_shipments: { label: 'Seller Central — FBA Shipments', channel: 'sc', inScope: true },
  sc_shipment_contents: { label: 'Seller Central — Shipment Contents', channel: 'sc', inScope: true },
} as const satisfies Record<OpsFileType, { label: string; channel: OpsChannel; inScope: boolean }>;

/** A code's warehouse network: regular FCs vs Amazon-Now quick-commerce nodes. */
export type WarehouseNetwork = 'Core' | 'Amazon Now';

/** A brand in the ops registry. `id` is a short slug and the tenant key on every ops table. */
export interface OpsBrand {
  id: string;
  name: string;
  logoUrl: string | null;
  /** Vendor Central vendor code(s) — a brand may have several. */
  vendorCodes: string[];
  /** Seller Central seller / merchant ID(s). */
  sellerIds: string[];
  marketplace: string;
  active: boolean;
}

/** Which channels a brand actually uses, recomputed after every upload (drives adaptive nav). */
export interface OpsBrandChannels {
  brandId: string;
  hasVendorCentral: boolean;
  hasSellerCentral: boolean;
  lastVcUpload: string | null;
  lastScUpload: string | null;
}

export interface OpsBrandWithChannels extends OpsBrand {
  channels: OpsBrandChannels;
}

/** Amazon's FC network — shared by every brand and both channels (a code means the same place for all). */
export interface OpsWarehouse {
  code: string;
  network: WarehouseNetwork;
  city: string | null;
  state: string | null;
  /** A code first seen in an upload, inserted automatically and awaiting city/state review. */
  needsReview: boolean;
}

/** Per-brand thresholds and metric choices; defaults applied when a brand has not set its own. */
export interface OpsBrandSettings {
  brandId: string;
  criticalDays: number;
  excessDays: number;
  dueSoonDays: number;
  vcSalesMetric: string;
  vcRevenueMetric: string;
  stuckReceivingDays: number;
  workingTooLongDays: number;
  inTransitTooLongDays: number;
  // Health thresholds (percentages, except noPoAlertDays which is days) — §1.4 / §5.3.
  fillGood: number;
  fillBad: number;
  notAcceptedBad: number;
  demandChangeAlert: number;
  noPoAlertDays: number;
  returnRateBad: number;
  agedShareBad: number;
}

/** Global defaults (brand_settings §1.4). */
export const OPS_SETTINGS_DEFAULTS: Omit<OpsBrandSettings, 'brandId'> = {
  criticalDays: 12,
  excessDays: 60,
  dueSoonDays: 3,
  vcSalesMetric: 'Shipped Units',
  vcRevenueMetric: 'Shipped Revenue',
  stuckReceivingDays: 14,
  workingTooLongDays: 5,
  inTransitTooLongDays: 10,
  fillGood: 85,
  fillBad: 60,
  notAcceptedBad: 20,
  demandChangeAlert: 30,
  noPoAlertDays: 21,
  returnRateBad: 5,
  agedShareBad: 20,
};

/** Adaptive navigation flags for a brand: which modules to show. */
export interface OpsNav {
  brandId: string;
  hasVendorCentral: boolean;
  hasSellerCentral: boolean;
  /** Combined view only when the brand uses both channels. */
  showCombined: boolean;
}

export type OpsUploadStatus = 'recognized' | 'stored' | 'skipped' | 'error';

/** One file's outcome from an ops upload (Phase 1: detect + log; facts stored once parsers land). */
export interface OpsUploadResult {
  filename: string;
  fileType: OpsFileType | null;
  channel: OpsChannel | null;
  status: OpsUploadStatus;
  rows?: number;
  headersFound?: number;
  dateFrom?: string | null;
  dateTo?: string | null;
  /** Set when the file carries an identifier that does not match the selected brand. */
  identifierWarning?: string | null;
  message?: string;
  warnings?: string[];
}

export interface OpsUploadResponse {
  brandId: string;
  files: OpsUploadResult[];
}

export interface OpsUploadLogEntry {
  id: string;
  filename: string;
  fileType: string | null;
  channel: string | null;
  status: string;
  rows: number;
  dateFrom: string | null;
  dateTo: string | null;
  message: string | null;
  createdAt: string;
}
