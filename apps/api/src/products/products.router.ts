import { Router } from 'express';
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '../db/client';
import { profileIdSchema } from '../lib/params';

/**
 * Product lookup — /api/products/*. Backs the ASIN hover preview: given a
 * profile + ASIN, returns the display title, mapper category and selling price
 * we already hold in the `products` table. No external calls; the product
 * image is loaded client-side from Amazon's public image host by ASIN.
 */
export const productsRouter = Router();

const ASIN_RE = /^[A-Z0-9]{10}$/;
const asinSchema = z.string().trim().toUpperCase().regex(ASIN_RE, 'Expected a 10-character ASIN');

export interface ProductCard {
  asin: string;
  title: string | null;
  category: string | null;
  sellingPrice: number | null;
}

type Raw = Record<string, unknown>;
const sOrNull = (v: unknown) => (v == null || v === '' ? null : String(v));
const nOrNull = (v: unknown) => (v == null || v === '' ? null : Number(v));

/** GET /api/products/:asin?profileId=… — one product card, or 404 when unknown. */
productsRouter.get('/:asin', async (req, res) => {
  const profileId = profileIdSchema.parse(req.query.profileId);
  const asin = asinSchema.parse(req.params.asin);

  const rows = await db.execute<Raw>(sql`
    select asin,
           coalesce(mapper_title, report_title) as title,
           mapper_category                      as category,
           selling_price
    from products
    where profile_id = ${profileId} and asin = ${asin}
    limit 1`);

  const row = rows[0];
  if (!row) {
    res.status(404).json({ error: `No product found for ASIN ${asin}.` });
    return;
  }

  const card: ProductCard = {
    asin: String(row.asin),
    title: sOrNull(row.title),
    category: sOrNull(row.category),
    sellingPrice: nOrNull(row.selling_price),
  };
  res.json(card);
});
