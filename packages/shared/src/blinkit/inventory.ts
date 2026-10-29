/* Days of Cover (DOC) per item × feeder warehouse.

   Run rate (DRR)  = units sold in the last 7 days ÷ 7
                     ("Last 7 days" column of Blinkit's Inventory report — it is
                      reported per facility, so it is exact at feeder level)
   DOC             = Total sellable ÷ DRR
   DOC (+incoming) = (Total sellable + Incoming scheduled inventory) ÷ DRR

   Bands are configurable via DOC_BANDS env / query (days). */

export interface DocBands { critical: number; low: number; excess: number }
export const DEFAULT_DOC_BANDS: DocBands = { critical: 7, low: 15, excess: 45 };

export type DocStatus = 'stock-out' | 'critical' | 'low' | 'healthy' | 'excess' | 'no-sales' | 'inactive';

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  'stock-out': 'Stock-out',
  critical: 'Critical',
  low: 'Low',
  healthy: 'Healthy',
  excess: 'Excess',
  'no-sales': 'No sales L7D',
  inactive: 'Inactive',
};

export function runRate(sold7d: number): number {
  return Math.max(0, sold7d) / 7;
}

export function daysOfCover(stock: number, drr: number): number | null {
  if (drr <= 0) return null; // undefined: nothing sold in 7 days
  return Math.max(0, stock) / drr;
}

export function docStatus(
  sellable: number, sold7d: number, sold30d: number, bands: DocBands = DEFAULT_DOC_BANDS,
): DocStatus {
  const drr = runRate(sold7d);
  if (sellable <= 0) return sold30d > 0 || sold7d > 0 ? 'stock-out' : 'inactive';
  if (drr <= 0) return 'no-sales';
  const doc = sellable / drr;
  if (doc < bands.critical) return 'critical';
  if (doc < bands.low) return 'low';
  if (doc > bands.excess) return 'excess';
  return 'healthy';
}

/** "Bengaluru B5 - Feeder" → Bengaluru, "Kundli Feeder" → Delhi NCR … */
const FEEDER_CITY_OVERRIDES: Record<string, string> = {
  kundli: 'Delhi NCR', farukhnagar: 'Delhi NCR', faridabad: 'Delhi NCR', noida: 'Delhi NCR', gurgaon: 'Delhi NCR',
  rajpura: 'Punjab (Rajpura)', bengaluru: 'Bengaluru', mumbai: 'Mumbai', pune: 'Pune', hyderabad: 'Hyderabad',
  kolkata: 'Kolkata', chennai: 'Chennai', ahmedabad: 'Ahmedabad', lucknow: 'Lucknow', nagpur: 'Nagpur',
  jaipur: 'Jaipur', coimbatore: 'Coimbatore', surat: 'Surat',
};
export function feederCity(facilityName: string): string {
  const first = String(facilityName).trim().split(/[\s-]+/)[0]?.toLowerCase() ?? '';
  return FEEDER_CITY_OVERRIDES[first] ?? (first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Unknown');
}
