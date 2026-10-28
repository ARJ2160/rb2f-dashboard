import type { HarvestChannel } from '@dash/shared';

const join = (sp: boolean, sb: boolean): HarvestChannel | null => (sp && sb ? 'SP & SB' : sp ? 'SP' : sb ? 'SB' : null);

/**
 * Keyword harvesting rule: a search term qualifies when it has at least
 * `minOrders` orders across SP + SB in the window and is NOT already a manual
 * target in at least one of SP / SB. It is harvested into the channel(s) it's
 * missing from; `performingIn` says where those orders came from.
 */
export function decideHarvest(t: {
  orders: number;
  spOrders: number;
  sbOrders: number;
  manualSp: boolean;
  manualSb: boolean;
  minOrders: number;
}): { performingIn: HarvestChannel; harvestInto: HarvestChannel } | null {
  if (t.orders < t.minOrders) return null;
  const harvestInto = join(!t.manualSp, !t.manualSb);
  const performingIn = join(t.spOrders > 0, t.sbOrders > 0);
  return harvestInto && performingIn ? { performingIn, harvestInto } : null;
}

/** Customer searched a product ID ("b0abc12345") — harvest as an ASIN target, not a keyword. */
export const isAsinTerm = (term: string) => /^b0[a-z0-9]{8}$/i.test(term);
