import { blank, type Sums } from '@dash/shared/blinkit';

import { sqlClient } from '../../db/client';

/* SQL helpers for the Blinkit reports. Plain parameterised SQL ($1, $2 …)
   through the shared postgres.js client; ads sums always come back in the same
   column order so one mapper turns a row into the shared Sums shape. */

export const ADS_SUMS = `
  sum(impressions) impr, sum(direct_atc + indirect_atc) atc, sum(direct_qty + indirect_qty) aunits,
  sum(direct_sales + indirect_sales) asales, sum(direct_sales) dsales, sum(spend) spend,
  sum(new_users) nu, sum(mvp_weighted) mvpw, sum(mvp_impr) mvpi`;

type Raw = Record<string, unknown>;

export function adsRow(r: Raw): Sums {
  const a = blank();
  for (const k of ['impr', 'atc', 'aunits', 'asales', 'dsales', 'spend', 'nu', 'mvpw', 'mvpi'] as const) a[k] = Number(r[k] ?? 0);
  return a;
}
export function salesRow(r: Raw): Sums {
  const a = blank();
  a.rev = Number(r.rev ?? 0);
  a.units = Number(r.units ?? 0);
  a.orders = Number(r.orders ?? 0);
  return a;
}

/** `and <col> = any($n::text[])` — or nothing when ids is null (no filter). */
export const inList = (col: string, idx: number, ids: string[] | null) => (ids ? ` and ${col} = any($${idx}::text[])` : '');

/** Run parameterised SQL; numeric / bigint come back as strings, so callers wrap with Number(). */
export async function q<T = Raw>(text: string, params: unknown[]): Promise<T[]> {
  // postgres.js serialises JS arrays for the ::text[] casts used by inList.
  const rows = await sqlClient.unsafe(text, params as never[]);
  return rows as unknown as T[];
}
