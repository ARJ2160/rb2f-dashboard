CREATE TABLE "im_sales" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"city" text NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"store_id" text DEFAULT '' NOT NULL,
	"item_code" text NOT NULL,
	"combo_item_code" text DEFAULT '' NOT NULL,
	"product_name" text DEFAULT '' NOT NULL,
	"variant" text DEFAULT '' NOT NULL,
	"l1_category" text DEFAULT '' NOT NULL,
	"l3_category" text DEFAULT '' NOT NULL,
	"mrp" double precision DEFAULT 0 NOT NULL,
	"units" double precision DEFAULT 0 NOT NULL,
	"gmv" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "im_sales_pk" PRIMARY KEY("profile_id","date","city","area","store_id","item_code","combo_item_code")
);
--> statement-breakpoint
CREATE INDEX "im_sales_date_idx" ON "im_sales" USING btree ("profile_id","date");
--> statement-breakpoint
CREATE TABLE "im_ads" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"campaign_id" text NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"ad_type" text NOT NULL,
	"keyword" text DEFAULT '' NOT NULL,
	"match_type" text DEFAULT '' NOT NULL,
	"product_name" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"a2c" double precision DEFAULT 0 NOT NULL,
	"conversions" double precision DEFAULT 0 NOT NULL,
	"gmv" double precision DEFAULT 0 NOT NULL,
	"direct_gmv_7" double precision DEFAULT 0 NOT NULL,
	"direct_gmv_14" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"branded_clicks" double precision DEFAULT 0 NOT NULL,
	"rank_weighted" double precision DEFAULT 0 NOT NULL,
	"rank_impr" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "im_ads_pk" PRIMARY KEY("profile_id","date","campaign_id","ad_type","keyword","match_type","product_name","city")
);
--> statement-breakpoint
CREATE INDEX "im_ads_date_idx" ON "im_ads" USING btree ("profile_id","date");
--> statement-breakpoint
CREATE TABLE "im_sku_map" (
	"profile_id" text NOT NULL,
	"key" text NOT NULL,
	"product_name" text DEFAULT '' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"price" double precision,
	CONSTRAINT "im_sku_map_pk" PRIMARY KEY("profile_id","key")
);
