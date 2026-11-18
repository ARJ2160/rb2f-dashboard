import { inArray } from 'drizzle-orm';
import type { WarehouseNetwork } from '@dash/shared';

import type { Tx } from '../db/client';
import { dimWarehouse } from '../db/schema';

/**
 * Amazon's FC network master. One row per FC code, shared by every brand and
 * both channels. Codes are seeded (Amazon-Now list + the city/state we know)
 * and super-admins edit the rest; any new code seen in an upload is inserted
 * automatically by `ensureWarehouses` and flagged for review.
 */

/** Known Amazon-Now (quick-commerce) node codes — super-admins can extend this. */
export const AMAZON_NOW_CODES = [
  'HAD1',
  'HBA4',
  'HBL4',
  'HCC6',
  'HCI2',
  'HDL2',
  'HHS1',
  'HHS6',
  'HHY7',
  'HKA2',
  'HKR2',
  'HLK1',
  'HMU5',
  'HMV4',
  'HNR4',
  'HPN6',
] as const;

const AMAZON_NOW = new Set<string>(AMAZON_NOW_CODES);

/** City/state seed for codes we know; the rest are filled in once and then apply to every brand. */
export const WAREHOUSE_GEO_SEED: Record<string, { city: string; state: string }> = {
  HHS1: { city: 'Gurgaon', state: 'Haryana' },
};

export const normalizeFcCode = (raw: unknown): string =>
  String(raw ?? '')
    .trim()
    .toUpperCase();

/** Default rule: a code in the Amazon-Now list is 'Amazon Now'; any other code is 'Core'. */
export const classifyWarehouse = (code: string): WarehouseNetwork =>
  AMAZON_NOW.has(normalizeFcCode(code)) ? 'Amazon Now' : 'Core';

/** The rows the first migration seeds into dim_warehouse. */
export function seedWarehouseRows(): Array<{
  code: string;
  network: WarehouseNetwork;
  city: string | null;
  state: string | null;
  needsReview: boolean;
}> {
  return AMAZON_NOW_CODES.map((code) => {
    const geo = WAREHOUSE_GEO_SEED[code];
    return {
      code,
      network: 'Amazon Now' as const,
      city: geo?.city ?? null,
      state: geo?.state ?? null,
      // Seeded codes with no geo yet still want a review nudge, except where we know the city.
      needsReview: !geo,
    };
  });
}

/**
 * Insert any FC code seen in an upload that we do not have yet (network by the
 * default rule, blank city/state, flagged for review). Returns the codes newly
 * inserted. Existing codes are never touched — a super-admin's edits stick.
 */
export async function ensureWarehouses(tx: Tx, codes: Iterable<string>): Promise<string[]> {
  const wanted = [...new Set([...codes].map(normalizeFcCode).filter(Boolean))];
  if (wanted.length === 0) return [];

  const existing = new Set(
    (
      await tx
        .select({ code: dimWarehouse.code })
        .from(dimWarehouse)
        .where(inArray(dimWarehouse.code, wanted))
    ).map((r) => r.code)
  );
  const fresh = wanted.filter((c) => !existing.has(c));
  if (fresh.length === 0) return [];

  await tx.insert(dimWarehouse).values(
    fresh.map((code) => {
      const geo = WAREHOUSE_GEO_SEED[code];
      return {
        code,
        network: classifyWarehouse(code),
        city: geo?.city ?? null,
        state: geo?.state ?? null,
        needsReview: true,
      };
    })
  );
  return fresh;
}
