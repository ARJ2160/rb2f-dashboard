CREATE TABLE "campaign_mapper" (
	"profile_id" text NOT NULL,
	"campaign_key" text NOT NULL,
	"campaign_name" text NOT NULL,
	"category" text,
	"type" text,
	"targeting" text,
	"branded" text,
	"auto_manual" text,
	CONSTRAINT "campaign_mapper_profile_id_campaign_key_pk" PRIMARY KEY("profile_id","campaign_key")
);
--> statement-breakpoint
CREATE TABLE "daily_placements" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"channel" text NOT NULL,
	"campaign_name" text NOT NULL,
	"placement" text NOT NULL,
	"raw_placement" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"spend" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_sales" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_units" integer DEFAULT 0 NOT NULL,
	"upload_id" uuid,
	CONSTRAINT "daily_placements_profile_id_date_channel_campaign_name_raw_placement_pk" PRIMARY KEY("profile_id","date","channel","campaign_name","raw_placement")
);
--> statement-breakpoint
CREATE TABLE "daily_search_terms" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"channel" text NOT NULL,
	"campaign_name" text NOT NULL,
	"target" text NOT NULL,
	"match_type" text NOT NULL,
	"search_term" text NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"spend" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_sales" numeric(14, 2) DEFAULT 0 NOT NULL,
	"ad_units" integer DEFAULT 0 NOT NULL,
	"upload_id" uuid,
	CONSTRAINT "daily_search_terms_profile_id_date_channel_campaign_name_target_match_type_search_term_pk" PRIMARY KEY("profile_id","date","channel","campaign_name","target","match_type","search_term")
);
--> statement-breakpoint
CREATE TABLE "daily_state_sales" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"source" text NOT NULL,
	"state" text NOT NULL,
	"asin" text NOT NULL,
	"units" integer DEFAULT 0 NOT NULL,
	"sales" numeric(14, 2) DEFAULT 0 NOT NULL,
	"orders" integer,
	"unpriced_units" integer,
	"upload_id" uuid,
	CONSTRAINT "daily_state_sales_profile_id_date_source_state_asin_pk" PRIMARY KEY("profile_id","date","source","state","asin")
);
--> statement-breakpoint
CREATE INDEX "daily_placements_profile_date_idx" ON "daily_placements" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "daily_search_terms_profile_date_idx" ON "daily_search_terms" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "daily_state_sales_profile_date_idx" ON "daily_state_sales" USING btree ("profile_id","date");