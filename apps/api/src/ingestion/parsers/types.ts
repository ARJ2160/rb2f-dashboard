import type { AdChannel, SalesSource } from '@dash/shared';

export interface ParseContext {
  /** Date range encoded in the filename / sheet name, if any. */
  nameDates: { from: string; to: string } | null;
  /** Metadata lines above the header row. */
  preamble: string[];
}

export interface SalesRecord {
  date: string;
  asin: string;
  source: SalesSource;
  sales: number;
  units: number;
  orderItems: number | null;
  sessions: number | null;
  pageViews: number | null;
  title: string | null;
  /**
   * Units whose revenue the report didn't give (Vendor Central shipped units
   * with ₹0 shipped revenue). Priced at query time as units × the ASIN
   * mapper's selling price, so a later mapper upload fixes revenue without
   * re-uploading the sales file. null/0 for every other source.
   */
  unpricedUnits: number | null;
}

export interface AdRecord {
  date: string;
  channel: AdChannel;
  campaignName: string;
  impressions: number;
  clicks: number;
  spend: number;
  adSales: number;
  adUnits: number;
}

export interface MapperRecord {
  asin: string;
  category: string | null;
  title: string | null;
  /** Regular selling price, used to value Vendor Central shipped units that came with ₹0 revenue. */
  sellingPrice: number | null;
  /** "Brand" column, when the mapper has one — seeds the profile's brand terms. */
  brand: string | null;
}

export interface ParseResult<T> {
  records: T[];
  rowsRead: number;
  warnings: string[];
  /** Set when nothing could be stored and the user must fix the file. */
  error?: string;
}

/** A file-level date only applies to rows when the file covers exactly one day. */
export function singleNameDate(ctx: ParseContext): string | null {
  return ctx.nameDates && ctx.nameDates.from === ctx.nameDates.to ? ctx.nameDates.from : null;
}
