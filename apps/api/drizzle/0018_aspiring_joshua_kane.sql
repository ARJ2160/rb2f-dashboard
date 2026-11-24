CREATE TABLE "app_users" (
	"email" text PRIMARY KEY NOT NULL,
	"role" text DEFAULT 'viewer' NOT NULL,
	"scope" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "zp_ad_campaign" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"channel" text NOT NULL,
	"campaign_name" text NOT NULL,
	"campaign_type" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"brand_id" text DEFAULT '' NOT NULL,
	"brand_name" text DEFAULT '' NOT NULL,
	"daily_budget" double precision DEFAULT 0 NOT NULL,
	"unique_reach" double precision DEFAULT 0 NOT NULL,
	"unique_considerations" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"asales" double precision DEFAULT 0 NOT NULL,
	"aunits" double precision DEFAULT 0 NOT NULL,
	"atc" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"same_skus" double precision DEFAULT 0 NOT NULL,
	"other_skus" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "zp_ad_campaign_pk" PRIMARY KEY("profile_id","period_from","period_to","channel","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "zp_ad_keyword" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"channel" text NOT NULL,
	"keyword" text NOT NULL,
	"match_type" text DEFAULT '' NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"asales" double precision DEFAULT 0 NOT NULL,
	"aunits" double precision DEFAULT 0 NOT NULL,
	"atc" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"same_skus" double precision DEFAULT 0 NOT NULL,
	"other_skus" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "zp_ad_keyword_pk" PRIMARY KEY("profile_id","period_from","period_to","channel","campaign_id","keyword","match_type")
);
--> statement-breakpoint
CREATE TABLE "zp_ad_product" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"channel" text NOT NULL,
	"product_id" text NOT NULL,
	"product_name" text DEFAULT '' NOT NULL,
	"report_category" text DEFAULT '' NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"asales" double precision DEFAULT 0 NOT NULL,
	"aunits" double precision DEFAULT 0 NOT NULL,
	"atc" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"same_skus" double precision DEFAULT 0 NOT NULL,
	"other_skus" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "zp_ad_product_pk" PRIMARY KEY("profile_id","period_from","period_to","channel","campaign_id","product_id")
);
--> statement-breakpoint
CREATE TABLE "zp_campaign_map" (
	"profile_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	CONSTRAINT "zp_campaign_map_pk" PRIMARY KEY("profile_id","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "zp_inventory" (
	"profile_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"city" text NOT NULL,
	"sku_code" text NOT NULL,
	"ean" text DEFAULT '' NOT NULL,
	"sku_name" text DEFAULT '' NOT NULL,
	"report_category" text DEFAULT '' NOT NULL,
	"sub_category" text DEFAULT '' NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"manufacturer_name" text DEFAULT '' NOT NULL,
	"manufacturer_id" text DEFAULT '' NOT NULL,
	"units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "zp_inventory_pk" PRIMARY KEY("profile_id","snapshot_date","city","sku_code")
);
--> statement-breakpoint
CREATE TABLE "zp_sales" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"city" text NOT NULL,
	"sku_id" text NOT NULL,
	"sku_name" text DEFAULT '' NOT NULL,
	"brand" text DEFAULT '' NOT NULL,
	"manufacturer_id" text DEFAULT '' NOT NULL,
	"manufacturer_name" text DEFAULT '' NOT NULL,
	"report_category" text DEFAULT '' NOT NULL,
	"units" double precision DEFAULT 0 NOT NULL,
	"gmv" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "zp_sales_pk" PRIMARY KEY("profile_id","date","city","sku_id")
);
--> statement-breakpoint
CREATE TABLE "zp_sku_map" (
	"profile_id" text NOT NULL,
	"sku_id" text NOT NULL,
	"sku_name" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	CONSTRAINT "zp_sku_map_pk" PRIMARY KEY("profile_id","sku_id")
);
--> statement-breakpoint
CREATE INDEX "zp_ad_campaign_period_idx" ON "zp_ad_campaign" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "zp_ad_keyword_period_idx" ON "zp_ad_keyword" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "zp_ad_product_period_idx" ON "zp_ad_product" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "zp_inventory_snap_idx" ON "zp_inventory" USING btree ("profile_id","snapshot_date");--> statement-breakpoint
CREATE INDEX "zp_sales_date_idx" ON "zp_sales" USING btree ("profile_id","date");