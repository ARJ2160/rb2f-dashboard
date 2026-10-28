import type { AdChannel, SalesSource } from '@dash/shared';
import { and, eq, inArray, sql } from 'drizzle-orm';

import type { Tx } from '../db/client';
import {
  campaignMapper,
  dailyAsinAds,
  dailyAsinSales,
  dailyCampaignAds,
  dailyPlacements,
  dailySearchTerms,
  dailyStateSales,
  products,
  sbAttributedDaily,
  searchQueryPerformance,
} from '../db/schema';
import { campaignAttrs, dailyHourlyAds } from '../db/schema';
import type { CampaignAttr } from '../lib/ad-type';
import { campaignKeyOf, type CampaignMapperRecord } from './parsers/campaign-mapper';
import type { HourlyRecord } from './parsers/campaign';
import type { StateRecord } from './parsers/order-report';
import type { PlacementRecord } from './parsers/placement';
import type { SqpRecord } from './parsers/search-query-performance';
import type { SearchTermRecord } from './parsers/search-term';
import type { AsinAdRecord } from './parsers/advertised-product';
import type { SbAttributedRecord } from './parsers/sb-attributed';
import type { AdRecord, MapperRecord, SalesRecord } from './parsers/types';

const CHUNK = 1000;

function chunks<T>(arr: T[], size = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

const uniqueDates = (rows: { date: string }[]) => [...new Set(rows.map((r) => r.date))].sort();

/**
 * Replace-by-date: wipe this source's rows for exactly the dates the file
 * contains, then insert. Re-uploading a corrected export overwrites cleanly;
 * other dates and other sources are untouched.
 */
export async function storeSales(
  tx: Tx,
  profileId: string,
  uploadId: string,
  source: SalesSource,
  records: SalesRecord[]
): Promise<void> {
  const dates = uniqueDates(records);
  for (const d of chunks(dates)) {
    await tx
      .delete(dailyAsinSales)
      .where(and(eq(dailyAsinSales.profileId, profileId), eq(dailyAsinSales.source, source), inArray(dailyAsinSales.date, d)));
  }
  for (const c of chunks(records)) {
    await tx.insert(dailyAsinSales).values(
      c.map((r) => ({
        profileId,
        date: r.date,
        asin: r.asin,
        source,
        sales: r.sales,
        units: Math.round(r.units),
        orderItems: r.orderItems == null ? null : Math.round(r.orderItems),
        sessions: r.sessions == null ? null : Math.round(r.sessions),
        pageViews: r.pageViews == null ? null : Math.round(r.pageViews),
        unpricedUnits: r.unpricedUnits ? Math.round(r.unpricedUnits) : null,
        uploadId,
      }))
    );
  }

  // Remember product titles seen in reports (used when the mapper has none).
  const titled = new Map<string, string>();
  for (const r of records) if (r.asin && r.title) titled.set(r.asin, r.title);
  for (const c of chunks([...titled.entries()])) {
    await tx
      .insert(products)
      .values(c.map(([asin, title]) => ({ profileId, asin, reportTitle: title })))
      .onConflictDoUpdate({
        target: [products.profileId, products.asin],
        set: { reportTitle: sql`excluded.report_title`, updatedAt: sql`now()` },
      });
  }
}

export async function storeAds(
  tx: Tx,
  profileId: string,
  uploadId: string,
  channel: AdChannel,
  records: AdRecord[]
): Promise<void> {
  const dates = uniqueDates(records);
  for (const d of chunks(dates)) {
    await tx
      .delete(dailyCampaignAds)
      .where(
        and(eq(dailyCampaignAds.profileId, profileId), eq(dailyCampaignAds.channel, channel), inArray(dailyCampaignAds.date, d))
      );
  }
  for (const c of chunks(records)) {
    await tx.insert(dailyCampaignAds).values(
      c.map((r) => ({
        profileId,
        date: r.date,
        channel,
        campaignName: r.campaignName,
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        spend: r.spend,
        adSales: r.adSales,
        adUnits: Math.round(r.adUnits),
        uploadId,
      }))
    );
  }
}

/** SP / SD (and GCS-warehouse SB) Advertised Product → daily_asin_campaign_ads (replace-by-date per channel). */
export async function storeAsinAds(
  tx: Tx,
  profileId: string,
  uploadId: string,
  channel: AdChannel,
  records: AsinAdRecord[]
): Promise<void> {
  for (const d of chunks(uniqueDates(records))) {
    await tx
      .delete(dailyAsinAds)
      .where(and(eq(dailyAsinAds.profileId, profileId), eq(dailyAsinAds.channel, channel), inArray(dailyAsinAds.date, d)));
  }
  for (const c of chunks(records)) {
    await tx.insert(dailyAsinAds).values(
      c.map((r) => ({
        profileId,
        date: r.date,
        asin: r.asin,
        campaignName: r.campaignName,
        channel,
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        spend: r.spend,
        adSales: r.adSales,
        adUnits: Math.round(r.adUnits),
        uploadId,
      }))
    );
  }
}

/** SB Attributed Purchases → sb_attributed_daily (replace-by-date). */
export async function storeSbAttributed(tx: Tx, profileId: string, uploadId: string, records: SbAttributedRecord[]): Promise<void> {
  for (const d of chunks(uniqueDates(records))) {
    await tx
      .delete(sbAttributedDaily)
      .where(and(eq(sbAttributedDaily.profileId, profileId), inArray(sbAttributedDaily.date, d)));
  }
  for (const c of chunks(records)) {
    await tx.insert(sbAttributedDaily).values(
      c.map((r) => ({
        profileId,
        date: r.date,
        campaignName: r.campaignName,
        asin: r.asin,
        adSales: r.adSales,
        adUnits: Math.round(r.adUnits),
        uploadId,
      }))
    );
  }
}

/** SP/SB search terms and SD targeting → daily_search_terms (replace-by-date per channel). */
export async function storeSearchTerms(
  tx: Tx,
  profileId: string,
  uploadId: string,
  channel: 'sp' | 'sb' | 'sd',
  records: SearchTermRecord[]
): Promise<void> {
  for (const d of chunks(uniqueDates(records))) {
    await tx
      .delete(dailySearchTerms)
      .where(and(eq(dailySearchTerms.profileId, profileId), eq(dailySearchTerms.channel, channel), inArray(dailySearchTerms.date, d)));
  }
  for (const c of chunks(records)) {
    await tx.insert(dailySearchTerms).values(
      c.map((r) => ({
        profileId,
        date: r.date,
        channel,
        campaignName: r.campaignName,
        target: r.target,
        matchType: r.matchType,
        searchTerm: r.searchTerm,
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        spend: r.spend,
        adSales: r.adSales,
        adUnits: Math.round(r.adUnits),
        uploadId,
      }))
    );
  }
}

/** Search Query Performance → search_query_performance (re-uploading a period replaces it). */
export async function storeSearchQueryPerformance(
  tx: Tx,
  profileId: string,
  uploadId: string,
  period: { from: string; to: string },
  records: SqpRecord[]
): Promise<void> {
  const t = searchQueryPerformance;
  await tx
    .delete(t)
    .where(and(eq(t.profileId, profileId), eq(t.periodStart, period.from), eq(t.periodEnd, period.to)));
  for (const c of chunks(records)) {
    await tx.insert(t).values(c.map((r) => ({ ...r, profileId, uploadId })));
  }
}

/** SP/SB placement reports → daily_placements (replace-by-date per channel). */
export async function storePlacements(
  tx: Tx,
  profileId: string,
  uploadId: string,
  channel: 'sp' | 'sb',
  records: PlacementRecord[]
): Promise<void> {
  for (const d of chunks(uniqueDates(records))) {
    await tx
      .delete(dailyPlacements)
      .where(and(eq(dailyPlacements.profileId, profileId), eq(dailyPlacements.channel, channel), inArray(dailyPlacements.date, d)));
  }
  for (const c of chunks(records)) {
    await tx.insert(dailyPlacements).values(
      c.map((r) => ({
        profileId,
        date: r.date,
        channel,
        campaignName: r.campaignName,
        placement: r.placement,
        rawPlacement: r.rawPlacement,
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        spend: r.spend,
        adSales: r.adSales,
        adUnits: Math.round(r.adUnits),
        uploadId,
      }))
    );
  }
}

/** Order report (seller) / Vendor State view (vendor) → daily_state_sales (replace-by-date per source). */
export async function storeStateSales(
  tx: Tx,
  profileId: string,
  uploadId: string,
  source: SalesSource,
  records: StateRecord[]
): Promise<void> {
  for (const d of chunks(uniqueDates(records))) {
    await tx
      .delete(dailyStateSales)
      .where(and(eq(dailyStateSales.profileId, profileId), eq(dailyStateSales.source, source), inArray(dailyStateSales.date, d)));
  }
  for (const c of chunks(records)) {
    await tx.insert(dailyStateSales).values(
      c.map((r) => ({
        profileId,
        date: r.date,
        source,
        state: r.state,
        asin: r.asin,
        units: Math.round(r.units),
        sales: r.sales,
        orders: r.orders,
        unpricedUnits: r.unpricedUnits ? Math.round(r.unpricedUnits) : null,
        uploadId,
      }))
    );
  }
}

/** Campaign mapper upload replaces the previous mapping. */
export async function storeCampaignMapper(tx: Tx, profileId: string, records: CampaignMapperRecord[]): Promise<void> {
  await tx.delete(campaignMapper).where(eq(campaignMapper.profileId, profileId));
  for (const c of chunks(records)) {
    await tx.insert(campaignMapper).values(c.map((r) => ({ profileId, ...r })));
  }
}

/** Hour-of-day rows from campaign reports exported with Start Time (replace-by-date per channel). */
export async function storeHourly(tx: Tx, profileId: string, uploadId: string, channel: 'sp' | 'sb' | 'sd', records: HourlyRecord[]) {
  for (const d of chunks(uniqueDates(records))) {
    await tx
      .delete(dailyHourlyAds)
      .where(and(eq(dailyHourlyAds.profileId, profileId), eq(dailyHourlyAds.channel, channel), inArray(dailyHourlyAds.date, d)));
  }
  for (const c of chunks(records)) {
    await tx.insert(dailyHourlyAds).values(
      c.map((r) => ({
        profileId,
        date: r.date,
        hour: r.hour,
        channel,
        campaignName: r.campaignName,
        impressions: Math.round(r.impressions),
        clicks: Math.round(r.clicks),
        spend: r.spend,
        adSales: r.adSales,
        adUnits: Math.round(r.adUnits),
        uploadId,
      }))
    );
  }
}

/** Campaign signals (channel, video) — upserted; "video" sticks once seen. */
export async function storeCampaignAttrs(tx: Tx, profileId: string, attrs: CampaignAttr[]) {
  const byKey = new Map<string, CampaignAttr & { key: string }>();
  for (const a of attrs) {
    const key = campaignKeyOf(a.campaignName);
    const prev = byKey.get(key);
    byKey.set(key, { ...a, key, isVideo: a.isVideo || !!prev?.isVideo });
  }
  for (const c of chunks([...byKey.values()])) {
    await tx
      .insert(campaignAttrs)
      .values(c.map((a) => ({ profileId, campaignKey: a.key, campaignName: a.campaignName, channel: a.channel, isVideo: a.isVideo })))
      .onConflictDoUpdate({
        target: [campaignAttrs.profileId, campaignAttrs.campaignKey],
        set: { channel: sql`excluded.channel`, isVideo: sql`${campaignAttrs.isVideo} or excluded.is_video` },
      });
  }
}

/** A mapper upload is the current truth: it fully replaces the previous mapping for the profile. */
export async function storeAsinMapper(tx: Tx, profileId: string, records: MapperRecord[]): Promise<void> {
  // Seed brand terms (Branded search-term detection) the first time: the
  // mapper's Brand column, else the most common first word of product titles.
  // Users can edit them afterwards; an existing list is never overwritten.
  const brands = [...new Set(records.map((r) => r.brand?.trim().toLowerCase()).filter((b): b is string => !!b && b !== 'brand'))];
  let seed = brands;
  if (!seed.length) {
    const counts = new Map<string, number>();
    for (const r of records) {
      const w = r.title?.trim().split(/\s+/)[0]?.toLowerCase();
      if (w && w.length > 2) counts.set(w, (counts.get(w) ?? 0) + 1);
    }
    const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
    seed = top ? [top[0]] : [];
  }
  if (seed.length) {
    await tx.execute(sql`
      insert into profile_settings (profile_id, brand_terms) values (${profileId}, ${JSON.stringify(seed)}::jsonb)
      on conflict (profile_id) do update set brand_terms = excluded.brand_terms
      where profile_settings.brand_terms = '[]'::jsonb`);
  }

  await tx
    .update(products)
    .set({ mapperCategory: null, mapperTitle: null, sellingPrice: null, updatedAt: sql`now()` })
    .where(eq(products.profileId, profileId));
  for (const c of chunks(records)) {
    await tx
      .insert(products)
      .values(c.map((r) => ({
          profileId,
          asin: r.asin,
          mapperCategory: r.category,
          mapperTitle: r.title,
          sellingPrice: r.sellingPrice,
        })))
      .onConflictDoUpdate({
        target: [products.profileId, products.asin],
        set: {
          mapperCategory: sql`excluded.mapper_category`,
          mapperTitle: sql`excluded.mapper_title`,
          sellingPrice: sql`excluded.selling_price`,
          updatedAt: sql`now()`,
        },
      });
  }
}
