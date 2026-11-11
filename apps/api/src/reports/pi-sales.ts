import { sql } from 'drizzle-orm';

import { db } from '../db/client';

/**
 * Amazon Pi is the sole sales source for a profile whenever it has any
 * city-level sales rows in the range. DSR / DUR / Category / the map then read
 * gross Pi sales instead of Seller + Vendor (the business rule: "if Pi is
 * available, use only Pi").
 */
export async function piActive(profileId: string, from: string, to: string): Promise<boolean> {
  try {
    const rows = await db.execute<{ one: number }>(sql`
      select 1 as one from daily_pi_city_sales
      where profile_id = ${profileId} and date between ${from} and ${to} limit 1`);
    return rows.length > 0;
  } catch {
    // Table not migrated yet → degrade to Seller + Vendor instead of 500-ing the report.
    return false;
  }
}
