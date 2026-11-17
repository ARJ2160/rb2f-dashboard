/** Seller Central view response shapes (§4.4 / §5.3). The frontend renders these; it never recomputes metrics. */

export type ScHealth = 'not_working' | 'needs_attention' | 'working';
export interface HealthCell {
  status: ScHealth;
  reasons: string[];
}
export interface ScHealthCounts {
  not_working: number;
  needs_attention: number;
  working: number;
}

export interface ScDispositionUnits {
  disposition: string;
  units: number;
}

export interface ScSkuRow {
  msku: string;
  asin: string;
  fnsku: string;
  product: string;
  /** ASIN mapper category (products.mapper_category), 'Unmapped', or null when the row has no ASIN. Display only. */
  category: string | null;
  sellable: number;
  unsellable: number;
  fcsInStock: number;
  fcsStockedOut: number;
  sold7: number;
  sold30: number;
  returns30: number;
  returnRatePct: number | null;
  drr7: number | null;
  drr30: number | null;
  drrInStock: number | null;
  daysOnHand: number | null;
  inbound: number;
  daysOfCoverInclInbound: number | null;
  receipts30: number;
  lossDamaged30: number;
  demandTrendPct: number | null;
  stockFlag: string;
  health: HealthCell;
}

export interface ScWarehouseRow {
  fc: string;
  city: string | null;
  state: string | null;
  sellable: number;
  unsellable: number;
  skusInStock: number;
  skusStockedOut: number;
  sold7: number;
  sold30: number;
  shareOfNationalPct: number | null;
  drr: number | null;
  daysOnHand: number | null;
  receipts30: number;
  transfersInOut: number;
  lossDamaged30: number;
  unitsExpected: number;
  unitsLocated: number;
  inbound: number;
  unitsShort: number;
  fillRateClosedPct: number | null;
  health: HealthCell;
}

export interface ScShipmentRow {
  shipmentId: string;
  name: string;
  status: string;
  created: string | null;
  lastUpdated: string | null;
  destFc: string;
  city: string | null;
  skus: number;
  unitsExpected: number;
  unitsLocated: number;
  shortfall: number;
  fillRatePct: number | null;
  daysSinceCreated: number | null;
  shipmentFlag: string;
  health: HealthCell;
}

export interface ScSkuWarehouseRow {
  msku: string;
  asin: string;
  product: string;
  /** ASIN mapper category, 'Unmapped', or null when the row has no ASIN. Display only. */
  category: string | null;
  fc: string;
  sellable: number;
  unsellable: number;
  sold7: number;
  sold30: number;
  inStockDays: number;
  drrInStock: number | null;
  daysOnHand: number | null;
  shareOfSkuNationalPct: number | null;
  receipts30: number;
  transfers: number;
  lossDamaged: number;
  flag: string;
  health: HealthCell;
}

export interface ScShipmentStatusAgg {
  status: string;
  count: number;
  unitsExpected: number;
  unitsLocated: number;
}

export interface ScSummary {
  asOf: string | null;
  numLedgerDates: number;
  sellable: number;
  unsellable: number;
  unsellableByType: ScDispositionUnits[];
  skusInStock: number;
  fcsHoldingStock: number;
  sold7: number;
  sold30: number;
  returns30: number;
  receipts30: number;
  lossDamaged30: number;
  nationalDrr: number | null;
  daysOnHand: number | null;
  skusByFlag: Record<string, number>;
  shipmentsByStatus: ScShipmentStatusAgg[];
  inboundUnits: number;
  unitsShortClosed: number;
  flaggedShipments: number;
  health: ScHealthCounts;
}

export interface ScDailyTrendPoint {
  date: string;
  sellable: number;
  sold: number;
  receipts: number;
  returns: number;
  lossDamaged: number;
}
export interface ScWeeklyShipmentPoint {
  weekStart: string;
  count: number;
  unitsExpected: number;
  unitsLocated: number;
}
export interface ScTrend {
  daily: ScDailyTrendPoint[];
  weeklyShipments: ScWeeklyShipmentPoint[];
}

/** Every Seller Central view in one payload (the /api/ops/sc/all response). */
export interface ScAllResponse {
  summary: ScSummary;
  skus: ScSkuRow[];
  warehouses: ScWarehouseRow[];
  shipments: ScShipmentRow[];
  skuWarehouse: ScSkuWarehouseRow[];
  trend: ScTrend;
}
