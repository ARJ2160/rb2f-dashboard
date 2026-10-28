-- Real order counts for search terms (keyword harvesting); old rows stay null and fall back to ad_units.
ALTER TABLE "daily_search_terms" ADD COLUMN "ad_orders" integer;
