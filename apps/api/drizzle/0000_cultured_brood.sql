CREATE TABLE "daily_asin_sales" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"asin" text NOT NULL,
	"source" text NOT NULL,
	"sales" numeric(14, 2) DEFAULT 0 NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"order_items" integer,
	"sessions" integer,
	"page_views" integer,
	"upload_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_asin_sales_profile_id_date_asin_source_pk" PRIMARY KEY("profile_id","date","asin","source")
);
--> statement-breakpoint
CREATE TABLE "daily_campaign_ads" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"channel" text NOT NULL,
	"campaign_name" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"spend" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_sales" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_units" integer DEFAULT 0 NOT NULL,
	"upload_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_campaign_ads_profile_id_date_channel_campaign_name_pk" PRIMARY KEY("profile_id","date","channel","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "products" (
	"profile_id" text NOT NULL,
	"asin" text NOT NULL,
	"mapper_category" text,
	"mapper_title" text,
	"report_title" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_profile_id_asin_pk" PRIMARY KEY("profile_id","asin")
);
--> statement-breakpoint
CREATE TABLE "uploads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"profile_id" text NOT NULL,
	"filename" text NOT NULL,
	"sheet" text,
	"report_type" text,
	"status" text NOT NULL,
	"date_from" date,
	"date_to" date,
	"rows_read" integer DEFAULT 0 NOT NULL,
	"rows_stored" integer DEFAULT 0 NOT NULL,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "daily_asin_sales_profile_date_idx" ON "daily_asin_sales" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "daily_campaign_ads_profile_date_idx" ON "daily_campaign_ads" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "uploads_profile_created_idx" ON "uploads" USING btree ("profile_id","created_at");