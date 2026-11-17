ALTER TABLE "brand_settings" ADD COLUMN IF NOT EXISTS "fill_good" integer DEFAULT 85 NOT NULL;
--> statement-breakpoint
ALTER TABLE "brand_settings" ADD COLUMN IF NOT EXISTS "fill_bad" integer DEFAULT 60 NOT NULL;
--> statement-breakpoint
ALTER TABLE "brand_settings" ADD COLUMN IF NOT EXISTS "not_accepted_bad" integer DEFAULT 20 NOT NULL;
--> statement-breakpoint
ALTER TABLE "brand_settings" ADD COLUMN IF NOT EXISTS "demand_change_alert" integer DEFAULT 30 NOT NULL;
--> statement-breakpoint
ALTER TABLE "brand_settings" ADD COLUMN IF NOT EXISTS "no_po_alert_days" integer DEFAULT 21 NOT NULL;
--> statement-breakpoint
ALTER TABLE "brand_settings" ADD COLUMN IF NOT EXISTS "return_rate_bad" integer DEFAULT 5 NOT NULL;
--> statement-breakpoint
ALTER TABLE "brand_settings" ADD COLUMN IF NOT EXISTS "aged_share_bad" integer DEFAULT 20 NOT NULL;
