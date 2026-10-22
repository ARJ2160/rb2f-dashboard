CREATE TABLE "campaign_attrs" (
	"profile_id" text NOT NULL,
	"campaign_key" text NOT NULL,
	"campaign_name" text NOT NULL,
	"channel" text NOT NULL,
	"is_video" boolean DEFAULT false NOT NULL,
	CONSTRAINT "campaign_attrs_profile_id_campaign_key_pk" PRIMARY KEY("profile_id","campaign_key")
);
--> statement-breakpoint
CREATE TABLE "campaign_dims" (
	"profile_id" text NOT NULL,
	"campaign_key" text NOT NULL,
	"campaign_name" text NOT NULL,
	"channel" text,
	"ad_type" text NOT NULL,
	"category" text NOT NULL,
	"category_source" text NOT NULL,
	"targeting" text NOT NULL,
	"branding" text NOT NULL,
	CONSTRAINT "campaign_dims_profile_id_campaign_key_pk" PRIMARY KEY("profile_id","campaign_key")
);
--> statement-breakpoint
CREATE TABLE "daily_asin_campaign_ads" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"channel" text NOT NULL,
	"campaign_name" text NOT NULL,
	"asin" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"spend" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_sales" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_units" integer DEFAULT 0 NOT NULL,
	"upload_id" uuid,
	CONSTRAINT "daily_asin_campaign_ads_profile_id_date_channel_campaign_name_asin_pk" PRIMARY KEY("profile_id","date","channel","campaign_name","asin")
);
--> statement-breakpoint
CREATE TABLE "daily_hourly_ads" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"hour" integer NOT NULL,
	"channel" text NOT NULL,
	"campaign_name" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"spend" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_sales" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_units" integer DEFAULT 0 NOT NULL,
	"upload_id" uuid,
	CONSTRAINT "daily_hourly_ads_profile_id_date_hour_channel_campaign_name_pk" PRIMARY KEY("profile_id","date","hour","channel","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "profile_settings" (
	"profile_id" text PRIMARY KEY NOT NULL,
	"brand_terms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "daily_asin_campaign_ads_profile_date_idx" ON "daily_asin_campaign_ads" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "daily_hourly_ads_profile_date_idx" ON "daily_hourly_ads" USING btree ("profile_id","date");