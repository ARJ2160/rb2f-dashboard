CREATE TABLE "daily_asin_ads" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"asin" text NOT NULL,
	"channel" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"spend" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_sales" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_units" integer DEFAULT 0 NOT NULL,
	"upload_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_asin_ads_profile_id_date_asin_channel_pk" PRIMARY KEY("profile_id","date","asin","channel")
);
--> statement-breakpoint
CREATE TABLE "sb_attributed_daily" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"campaign_name" text NOT NULL,
	"asin" text NOT NULL,
	"ad_sales" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_units" integer DEFAULT 0 NOT NULL,
	"upload_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sb_attributed_daily_profile_id_date_campaign_name_asin_pk" PRIMARY KEY("profile_id","date","campaign_name","asin")
);
--> statement-breakpoint
CREATE INDEX "daily_asin_ads_profile_date_idx" ON "daily_asin_ads" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "sb_attributed_daily_profile_date_idx" ON "sb_attributed_daily" USING btree ("profile_id","date");