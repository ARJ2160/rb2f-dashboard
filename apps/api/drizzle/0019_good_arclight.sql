CREATE TABLE "fk_ad_campaign" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text NOT NULL,
	"campaign_type" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "fk_ad_campaign_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "fk_ad_fsn" (
	"profile_id" text NOT NULL,
	"period_from" date NOT NULL,
	"period_to" date NOT NULL,
	"campaign_id" text DEFAULT '' NOT NULL,
	"campaign_name" text DEFAULT '' NOT NULL,
	"fsn" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"impressions" double precision DEFAULT 0 NOT NULL,
	"clicks" double precision DEFAULT 0 NOT NULL,
	"spend" double precision DEFAULT 0 NOT NULL,
	"ad_sales" double precision DEFAULT 0 NOT NULL,
	"ad_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "fk_ad_fsn_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","fsn")
);
--> statement-breakpoint
CREATE TABLE "fk_ad_keyword" (
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
	CONSTRAINT "fk_ad_keyword_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","keyword","match_type")
);
--> statement-breakpoint
CREATE TABLE "fk_ad_placement" (
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
	CONSTRAINT "fk_ad_placement_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","placement")
);
--> statement-breakpoint
CREATE TABLE "fk_ad_search_term" (
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
	CONSTRAINT "fk_ad_search_term_pk" PRIMARY KEY("profile_id","period_from","period_to","campaign_id","search_term","match_type")
);
--> statement-breakpoint
CREATE TABLE "fk_campaign_map" (
	"profile_id" text NOT NULL,
	"campaign_name" text NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"sku" text DEFAULT '' NOT NULL,
	"city" text DEFAULT '' NOT NULL,
	CONSTRAINT "fk_campaign_map_pk" PRIMARY KEY("profile_id","campaign_name")
);
--> statement-breakpoint
CREATE TABLE "fk_daily_fsn_returns" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"fsn" text NOT NULL,
	"returns_units" double precision DEFAULT 0 NOT NULL,
	"cancellations_units" double precision DEFAULT 0 NOT NULL,
	"net_revenue" double precision DEFAULT 0 NOT NULL,
	"net_units" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "fk_daily_fsn_returns_pk" PRIMARY KEY("profile_id","date","fsn")
);
--> statement-breakpoint
CREATE TABLE "fk_daily_fsn_sales" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"fsn" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"revenue_gross" double precision DEFAULT 0 NOT NULL,
	"units" double precision DEFAULT 0 NOT NULL,
	"impressions_total" double precision DEFAULT 0 NOT NULL,
	"clicks_total" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "fk_daily_fsn_sales_pk" PRIMARY KEY("profile_id","date","fsn")
);
--> statement-breakpoint
CREATE TABLE "fk_fsn_map" (
	"profile_id" text NOT NULL,
	"fsn" text NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"category" text DEFAULT '' NOT NULL,
	"selling_price" double precision DEFAULT 0 NOT NULL,
	CONSTRAINT "fk_fsn_map_pk" PRIMARY KEY("profile_id","fsn")
);
--> statement-breakpoint
CREATE INDEX "fk_ad_campaign_period_idx" ON "fk_ad_campaign" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "fk_ad_fsn_period_idx" ON "fk_ad_fsn" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "fk_ad_keyword_period_idx" ON "fk_ad_keyword" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "fk_ad_placement_period_idx" ON "fk_ad_placement" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "fk_ad_search_term_period_idx" ON "fk_ad_search_term" USING btree ("profile_id","period_from","period_to");--> statement-breakpoint
CREATE INDEX "fk_daily_fsn_returns_date_idx" ON "fk_daily_fsn_returns" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "fk_daily_fsn_sales_date_idx" ON "fk_daily_fsn_sales" USING btree ("profile_id","date");