CREATE TABLE "my_ad_campaign" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "my_ad_campaign_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "my_ad_placement" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"placement" text NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "my_ad_placement_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","placement")
);
--> statement-breakpoint
CREATE TABLE "my_ad_product" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"style_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "my_ad_product_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","style_id")
);
--> statement-breakpoint
CREATE TABLE "my_ad_search_term" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"search_term" text NOT NULL,
	"match_type" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "my_ad_search_term_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","search_term","match_type")
);
--> statement-breakpoint
CREATE TABLE "my_ad_targeting" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"target_type" text NOT NULL,
	"target" text NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "my_ad_targeting_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","target_type","target")
);
--> statement-breakpoint
CREATE TABLE "my_campaign_map" (
	"profile_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	CONSTRAINT "my_campaign_map_pk" PRIMARY KEY("profile_id","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "my_daily_style_sales" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"style_id" text NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"revenue" double precision DEFAULT 0 NOT NULL,
	"units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "my_daily_style_sales_pk" PRIMARY KEY("profile_id","date","style_id","state")
);
--> statement-breakpoint
CREATE TABLE "my_style_map" (
	"profile_id" text NOT NULL,
	"style_id" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"selling_price" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "my_style_map_pk" PRIMARY KEY("profile_id","style_id")
);
--> statement-breakpoint
CREATE TABLE "my_top_search_terms" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"term" text NOT NULL,
	"volume" double precision DEFAULT 0 NOT NULL,
	"your_impressions" double precision DEFAULT 0 NOT NULL,
	"your_clicks" double precision DEFAULT 0 NOT NULL,
	"rank" double precision,
	CONSTRAINT "my_top_search_terms_pk" PRIMARY KEY("profile_id","period_from","period_to","term")
);
--> statement-breakpoint
CREATE TABLE "nk_ad_campaign" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "nk_ad_campaign_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "nk_ad_placement" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"placement" text NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "nk_ad_placement_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","placement")
);
--> statement-breakpoint
CREATE TABLE "nk_ad_search_term" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"search_term" text NOT NULL,
	"match_type" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "nk_ad_search_term_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","search_term","match_type")
);
--> statement-breakpoint
CREATE TABLE "nk_ad_sku" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"sku" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "nk_ad_sku_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","sku")
);
--> statement-breakpoint
CREATE TABLE "nk_campaign_map" (
	"profile_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	CONSTRAINT "nk_campaign_map_pk" PRIMARY KEY("profile_id","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "nk_daily_sku_sales" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"sku" text NOT NULL,
	"source" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"revenue" double precision DEFAULT 0 NOT NULL,
	"units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "nk_daily_sku_sales_pk" PRIMARY KEY("profile_id","date","sku","source")
);
--> statement-breakpoint
CREATE TABLE "nk_sku_map" (
	"profile_id" text NOT NULL,
	"sku" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"selling_price" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "nk_sku_map_pk" PRIMARY KEY("profile_id","sku")
);
--> statement-breakpoint
CREATE TABLE "nk_sku_sov" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"sku" text NOT NULL,
	"sov" double precision DEFAULT 0 NOT NULL,
	"rank" double precision,
	CONSTRAINT "nk_sku_sov_pk" PRIMARY KEY("profile_id","period_from","period_to","sku")
);
--> statement-breakpoint
CREATE TABLE "fc_ad_category" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"category" text NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "fc_ad_category_pk" PRIMARY KEY("profile_id","period_from","period_to","category")
);
--> statement-breakpoint
CREATE TABLE "fc_ad_keyword" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"keyword" text NOT NULL,
	"match_type" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "fc_ad_keyword_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","keyword","match_type")
);
--> statement-breakpoint
CREATE TABLE "fc_ad_product" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"sku" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "fc_ad_product_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","sku")
);
--> statement-breakpoint
CREATE TABLE "fc_campaign_map" (
	"profile_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	CONSTRAINT "fc_campaign_map_pk" PRIMARY KEY("profile_id","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "fc_daily_sku_sales" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"sku" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"revenue" double precision DEFAULT 0 NOT NULL,
	"units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "fc_daily_sku_sales_pk" PRIMARY KEY("profile_id","date","sku")
);
--> statement-breakpoint
CREATE TABLE "fc_sku_map" (
	"profile_id" text NOT NULL,
	"sku" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"selling_price" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "fc_sku_map_pk" PRIMARY KEY("profile_id","sku")
);
--> statement-breakpoint
CREATE TABLE "me_daily_sku_sales" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"sku" text NOT NULL,
	"state" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"revenue" double precision DEFAULT 0 NOT NULL,
	"units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "me_daily_sku_sales_pk" PRIMARY KEY("profile_id","date","sku","state")
);
--> statement-breakpoint
CREATE TABLE "me_manual_ads" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"campaign" text DEFAULT '' NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "me_manual_ads_pk" PRIMARY KEY("profile_id","date","campaign")
);
--> statement-breakpoint
CREATE TABLE "me_order_agg" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"sku" text NOT NULL,
	"delivered_units" double precision DEFAULT 0 NOT NULL,
	"returned_units" double precision DEFAULT 0 NOT NULL,
	"rto_units" double precision DEFAULT 0 NOT NULL,
	"cancelled_units" double precision DEFAULT 0 NOT NULL,
	"net_revenue" double precision DEFAULT 0 NOT NULL,
	"net_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "me_order_agg_pk" PRIMARY KEY("profile_id","date","sku")
);
--> statement-breakpoint
CREATE TABLE "me_sku_map" (
	"profile_id" text NOT NULL,
	"sku" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"selling_price" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "me_sku_map_pk" PRIMARY KEY("profile_id","sku")
);
--> statement-breakpoint
CREATE INDEX "my_ad_campaign_period_idx" ON "my_ad_campaign" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "my_ad_placement_period_idx" ON "my_ad_placement" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "my_ad_product_period_idx" ON "my_ad_product" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "my_ad_search_term_period_idx" ON "my_ad_search_term" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "my_ad_targeting_period_idx" ON "my_ad_targeting" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "my_daily_style_sales_date_idx" ON "my_daily_style_sales" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "my_top_search_terms_period_idx" ON "my_top_search_terms" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "nk_ad_campaign_period_idx" ON "nk_ad_campaign" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "nk_ad_placement_period_idx" ON "nk_ad_placement" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "nk_ad_search_term_period_idx" ON "nk_ad_search_term" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "nk_ad_sku_period_idx" ON "nk_ad_sku" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "nk_daily_sku_sales_date_idx" ON "nk_daily_sku_sales" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "nk_sku_sov_period_idx" ON "nk_sku_sov" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "fc_ad_category_period_idx" ON "fc_ad_category" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "fc_ad_keyword_period_idx" ON "fc_ad_keyword" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "fc_ad_product_period_idx" ON "fc_ad_product" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "fc_daily_sku_sales_date_idx" ON "fc_daily_sku_sales" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "me_daily_sku_sales_date_idx" ON "me_daily_sku_sales" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "me_manual_ads_date_idx" ON "me_manual_ads" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "me_order_agg_date_idx" ON "me_order_agg" USING btree ("profile_id","date");