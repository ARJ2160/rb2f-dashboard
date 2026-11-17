import type { OpsBrandSettings } from '@dash/shared';
import { OPS_SETTINGS_DEFAULTS } from '@dash/shared';
import { eq, sql } from 'drizzle-orm';

import { db } from '../db/client';
import { brandSettings } from '../db/schema';

/** Per-brand thresholds, with the global defaults filled in when a brand has no row yet. */

const toSettings = (brandId: string, r: typeof brandSettings.$inferSelect | undefined): OpsBrandSettings => ({
  brandId,
  criticalDays: r?.criticalDays ?? OPS_SETTINGS_DEFAULTS.criticalDays,
  excessDays: r?.excessDays ?? OPS_SETTINGS_DEFAULTS.excessDays,
  dueSoonDays: r?.dueSoonDays ?? OPS_SETTINGS_DEFAULTS.dueSoonDays,
  vcSalesMetric: r?.vcSalesMetric ?? OPS_SETTINGS_DEFAULTS.vcSalesMetric,
  vcRevenueMetric: r?.vcRevenueMetric ?? OPS_SETTINGS_DEFAULTS.vcRevenueMetric,
  stuckReceivingDays: r?.stuckReceivingDays ?? OPS_SETTINGS_DEFAULTS.stuckReceivingDays,
  workingTooLongDays: r?.workingTooLongDays ?? OPS_SETTINGS_DEFAULTS.workingTooLongDays,
  inTransitTooLongDays: r?.inTransitTooLongDays ?? OPS_SETTINGS_DEFAULTS.inTransitTooLongDays,
  fillGood: r?.fillGood ?? OPS_SETTINGS_DEFAULTS.fillGood,
  fillBad: r?.fillBad ?? OPS_SETTINGS_DEFAULTS.fillBad,
  notAcceptedBad: r?.notAcceptedBad ?? OPS_SETTINGS_DEFAULTS.notAcceptedBad,
  demandChangeAlert: r?.demandChangeAlert ?? OPS_SETTINGS_DEFAULTS.demandChangeAlert,
  noPoAlertDays: r?.noPoAlertDays ?? OPS_SETTINGS_DEFAULTS.noPoAlertDays,
  returnRateBad: r?.returnRateBad ?? OPS_SETTINGS_DEFAULTS.returnRateBad,
  agedShareBad: r?.agedShareBad ?? OPS_SETTINGS_DEFAULTS.agedShareBad,
});

export async function getBrandSettings(brandId: string): Promise<OpsBrandSettings> {
  const [row] = await db.select().from(brandSettings).where(eq(brandSettings.brandId, brandId)).limit(1);
  return toSettings(brandId, row);
}

export type SettingsPatch = Partial<Omit<OpsBrandSettings, 'brandId'>>;

export async function upsertBrandSettings(brandId: string, patch: SettingsPatch): Promise<OpsBrandSettings> {
  const base = await getBrandSettings(brandId);
  const merged = { ...base, ...patch, brandId };
  await db
    .insert(brandSettings)
    .values({ ...merged, updatedAt: sql`now()` })
    .onConflictDoUpdate({
      target: brandSettings.brandId,
      set: {
        criticalDays: merged.criticalDays,
        excessDays: merged.excessDays,
        dueSoonDays: merged.dueSoonDays,
        vcSalesMetric: merged.vcSalesMetric,
        vcRevenueMetric: merged.vcRevenueMetric,
        stuckReceivingDays: merged.stuckReceivingDays,
        workingTooLongDays: merged.workingTooLongDays,
        inTransitTooLongDays: merged.inTransitTooLongDays,
        fillGood: merged.fillGood,
        fillBad: merged.fillBad,
        notAcceptedBad: merged.notAcceptedBad,
        demandChangeAlert: merged.demandChangeAlert,
        noPoAlertDays: merged.noPoAlertDays,
        returnRateBad: merged.returnRateBad,
        agedShareBad: merged.agedShareBad,
        updatedAt: sql`now()`,
      },
    });
  return merged;
}
