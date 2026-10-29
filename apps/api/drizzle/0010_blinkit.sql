CREATE TABLE "bk_sales_lines" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"order_id" text NOT NULL,
	"item_id" text NOT NULL,
	"product_name" text DEFAULT '' NOT NULL,
	"customer_city" text DEFAULT '' NOT NULL,
	"customer_state" text DEFAULT '' NOT NULL,
	"supply_city" text DEFAULT '' NOT NULL,
	"supply_state" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"quantity" double precision DEFAULT 0 NOT NULL,
	"mrp" double precision DEFAULT 0 NOT NULL,
	"selling_price" double precision DEFAULT 0 NOT NULL,
	"revenue" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "bk_sales_lines_profile_id_order_id_item_id_pk" PRIMARY KEY("profile_id","order_id","item_id")
);
--> statement-breakpoint
CREATE INDEX "bk_sales_date_idx" ON "bk_sales_lines" USING btree ("profile_id","date");
--> statement-breakpoint
CREATE TABLE "bk_daily_ads" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"ad_type" text NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"targeting_type" text DEFAULT '' NOT NULL,
	"targeting_value" text DEFAULT '' NOT NULL,
	"match_type" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"direct_atc" double precision DEFAULT 0 NOT NULL,
	"indirect_atc" double precision DEFAULT 0 NOT NULL,
	"direct_qty" double precision DEFAULT 0 NOT NULL,
	"indirect_qty" double precision DEFAULT 0 NOT NULL,
	"direct_sales" double precision DEFAULT 0 NOT NULL,
	"indirect_sales" double precision DEFAULT 0 NOT NULL,
	"new_users" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"mvp_weighted" double precision DEFAULT 0 NOT NULL,
	"mvp_impr" double precision DEFAULT 0 NOT NULL,
	"reach" double precision DEFAULT 0 NOT NULL,
	"unique_clicks" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "bk_daily_ads_pk" PRIMARY KEY("profile_id","date","ad_type","campaign_id","targeting_type","targeting_value","match_type")
);
--> statement-breakpoint
CREATE INDEX "bk_ads_date_idx" ON "bk_daily_ads" USING btree ("profile_id","date");
--> statement-breakpoint
CREATE TABLE "bk_inventory" (
	"profile_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"item_id" text NOT NULL,
	"facility_id" text NOT NULL,
	"item_name" text DEFAULT '' NOT NULL,
	"facility_name" text DEFAULT '' NOT NULL,
	"uom" text DEFAULT '' NOT NULL,
	"net_scheduled" double precision DEFAULT 0 NOT NULL,
	"incoming" double precision DEFAULT 0 NOT NULL,
	"recalled" double precision DEFAULT 0 NOT NULL,
	"sellable" double precision DEFAULT 0 NOT NULL,
	"warehouse" double precision DEFAULT 0 NOT NULL,
	"in_between" double precision DEFAULT 0 NOT NULL,
	"darkstore" double precision DEFAULT 0 NOT NULL,
	"unsellable" double precision DEFAULT 0 NOT NULL,
	"damaged" double precision DEFAULT 0 NOT NULL,
	"lost" double precision DEFAULT 0 NOT NULL,
	"expired" double precision DEFAULT 0 NOT NULL,
	"near_expiry" double precision DEFAULT 0 NOT NULL,
	"sold_7d" double precision DEFAULT 0 NOT NULL,
	"sold_15d" double precision DEFAULT 0 NOT NULL,
	"sold_30d" double precision DEFAULT 0 NOT NULL,
	"generated_at" text DEFAULT '' NOT NULL,
	CONSTRAINT "bk_inventory_pk" PRIMARY KEY("profile_id","snapshot_date","item_id","facility_id")
);
--> statement-breakpoint
CREATE TABLE "bk_sku_map" (
	"profile_id" text NOT NULL,
	"key" text NOT NULL,
	"product_name" text DEFAULT '' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"price" double precision,
	CONSTRAINT "bk_sku_map_profile_id_key_pk" PRIMARY KEY("profile_id","key")
);
--> statement-breakpoint
CREATE TABLE "bk_campaign_map" (
	"profile_id" text NOT NULL,
	"source" text NOT NULL,
	"key" text NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"targeting" text DEFAULT '' NOT NULL,
	CONSTRAINT "bk_campaign_map_profile_id_source_key_pk" PRIMARY KEY("profile_id","source","key")
);
