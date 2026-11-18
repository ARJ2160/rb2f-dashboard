import type { IdentifierSniff } from './detect';
import type { OpsBrand, OpsBrandChannels, OpsBrandWithChannels, OpsNav } from '@dash/shared';
import { and, desc, eq, inArray, max, sql } from 'drizzle-orm';

import { db, type Tx } from '../db/client';
import { brandChannels, brands, importBatches } from '../db/schema';

/** Ops brand registry + channel recompute (the adaptive-nav source of truth). */

const toBrand = (r: typeof brands.$inferSelect): OpsBrand => ({
  id: r.id,
  name: r.name,
  logoUrl: r.logoUrl,
  vendorCodes: r.vendorCodes ?? [],
  sellerIds: r.sellerIds ?? [],
  marketplace: r.marketplace,
  active: r.active,
});

const emptyChannels = (brandId: string): OpsBrandChannels => ({
  brandId,
  hasVendorCentral: false,
  hasSellerCentral: false,
  lastVcUpload: null,
  lastScUpload: null,
});

const toChannels = (r: typeof brandChannels.$inferSelect): OpsBrandChannels => ({
  brandId: r.brandId,
  hasVendorCentral: r.hasVendorCentral,
  hasSellerCentral: r.hasSellerCentral,
  lastVcUpload: r.lastVcUpload,
  lastScUpload: r.lastScUpload,
});

export async function listBrands(): Promise<OpsBrand[]> {
  const rows = await db.select().from(brands).orderBy(brands.name);
  return rows.map(toBrand);
}

export async function getBrand(id: string): Promise<OpsBrand | null> {
  const [row] = await db.select().from(brands).where(eq(brands.id, id)).limit(1);
  return row ? toBrand(row) : null;
}

export async function getBrandChannels(id: string): Promise<OpsBrandChannels> {
  const [row] = await db.select().from(brandChannels).where(eq(brandChannels.brandId, id)).limit(1);
  return row ? toChannels(row) : emptyChannels(id);
}

export async function getBrandWithChannels(id: string): Promise<OpsBrandWithChannels | null> {
  const brand = await getBrand(id);
  if (!brand) return null;
  return { ...brand, channels: await getBrandChannels(id) };
}

export interface BrandInput {
  id: string;
  name: string;
  logoUrl?: string | null;
  vendorCodes?: string[];
  sellerIds?: string[];
  marketplace?: string;
  active?: boolean;
}

export async function createBrand(input: BrandInput): Promise<OpsBrand> {
  const [row] = await db
    .insert(brands)
    .values({
      id: input.id,
      name: input.name,
      logoUrl: input.logoUrl ?? null,
      vendorCodes: input.vendorCodes ?? [],
      sellerIds: input.sellerIds ?? [],
      marketplace: input.marketplace ?? 'Amazon.in',
      active: input.active ?? true,
    })
    .returning();
  return toBrand(row!);
}

export async function updateBrand(
  id: string,
  patch: Partial<Omit<BrandInput, 'id'>>
): Promise<OpsBrand | null> {
  const set: Partial<typeof brands.$inferInsert> = {};
  if (patch.name !== undefined) set.name = patch.name;
  if (patch.logoUrl !== undefined) set.logoUrl = patch.logoUrl;
  if (patch.vendorCodes !== undefined) set.vendorCodes = patch.vendorCodes;
  if (patch.sellerIds !== undefined) set.sellerIds = patch.sellerIds;
  if (patch.marketplace !== undefined) set.marketplace = patch.marketplace;
  if (patch.active !== undefined) set.active = patch.active;
  if (Object.keys(set).length === 0) return getBrand(id);
  const [row] = await db.update(brands).set(set).where(eq(brands.id, id)).returning();
  return row ? toBrand(row) : null;
}

/**
 * Recompute a brand's channels from its upload history. A channel is "in use"
 * once the brand has a recognised upload for it; the last-upload dates track
 * staleness. Called after every upload (§1.1).
 */
export async function recomputeBrandChannels(tx: Tx, brandId: string): Promise<OpsBrandChannels> {
  const agg = await tx
    .select({
      channel: importBatches.channel,
      last: max(importBatches.createdAt),
    })
    .from(importBatches)
    .where(and(eq(importBatches.brandId, brandId), inArray(importBatches.status, ['recognized', 'stored'])))
    .groupBy(importBatches.channel);

  const dateOf = (ts: Date | null) => (ts ? ts.toISOString().slice(0, 10) : null);
  const vc = agg.find((a) => a.channel === 'vc');
  const sc = agg.find((a) => a.channel === 'sc');
  const next: OpsBrandChannels = {
    brandId,
    hasVendorCentral: !!vc,
    hasSellerCentral: !!sc,
    lastVcUpload: dateOf(vc?.last ?? null),
    lastScUpload: dateOf(sc?.last ?? null),
  };

  await tx
    .insert(brandChannels)
    .values({
      brandId,
      hasVendorCentral: next.hasVendorCentral,
      hasSellerCentral: next.hasSellerCentral,
      lastVcUpload: next.lastVcUpload,
      lastScUpload: next.lastScUpload,
      updatedAt: sql`now()`,
    })
    .onConflictDoUpdate({
      target: brandChannels.brandId,
      set: {
        hasVendorCentral: next.hasVendorCentral,
        hasSellerCentral: next.hasSellerCentral,
        lastVcUpload: next.lastVcUpload,
        lastScUpload: next.lastScUpload,
        updatedAt: sql`now()`,
      },
    });
  return next;
}

export function navFromChannels(c: OpsBrandChannels): OpsNav {
  return {
    brandId: c.brandId,
    hasVendorCentral: c.hasVendorCentral,
    hasSellerCentral: c.hasSellerCentral,
    showCombined: c.hasVendorCentral && c.hasSellerCentral,
  };
}

/**
 * Compare a file's identifier against the selected brand's identifiers and
 * return a warning when it clearly belongs to another brand (§1.1). Only warns
 * when there is something to compare against and nothing matches.
 */
export function identifierWarning(brand: OpsBrand, sniff: IdentifierSniff | null): string | null {
  if (!sniff) return null;
  const needle = sniff.value.trim().toLowerCase();
  if (!needle) return null;

  const pools: Record<IdentifierSniff['kind'], string[]> = {
    vendorCode: brand.vendorCodes,
    sellerId: brand.sellerIds,
    businesses: [brand.name, ...brand.vendorCodes, ...brand.sellerIds],
  };
  const pool = pools[sniff.kind].map((v) => v.trim().toLowerCase()).filter(Boolean);
  if (pool.length === 0) return null;

  const matches = pool.some((v) => v === needle || v.includes(needle) || needle.includes(v));
  if (matches) return null;
  const label =
    sniff.kind === 'vendorCode' ? 'vendor code' : sniff.kind === 'sellerId' ? 'seller ID' : 'business';
  return `File ${label} "${sniff.value}" does not match brand "${brand.name}" — check you picked the right brand.`;
}
