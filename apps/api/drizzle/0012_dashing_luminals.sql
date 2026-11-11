CREATE TABLE "daily_asin_gv" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"asin" text NOT NULL,
	"glance_views" numeric(16, 2) DEFAULT 0 NOT NULL,
	"category" text,
	"subcategory" text,
	"brand" text,
	"upload_id" uuid,
	CONSTRAINT "daily_asin_gv_profile_id_date_asin_pk" PRIMARY KEY("profile_id","date","asin")
);
--> statement-breakpoint
CREATE TABLE "keyword_sov" (
	"profile_id" text NOT NULL,
	"duration" text NOT NULL,
	"keyword" text NOT NULL,
	"keyword_type" text NOT NULL,
	"category" text,
	"searches" text,
	"rank" integer,
	"most_clicked_organic_asin" text,
	"most_clicked_sp_asin" text,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"upload_id" uuid,
	CONSTRAINT "keyword_sov_profile_id_duration_keyword_pk" PRIMARY KEY("profile_id","duration","keyword")
);
--> statement-breakpoint
CREATE TABLE "product_search_rank" (
	"profile_id" text NOT NULL,
	"asin" text NOT NULL,
	"period" date NOT NULL,
	"search_rank" numeric(10, 4) DEFAULT 0 NOT NULL,
	"category" text,
	"subcategory" text,
	"brand" text,
	"title" text,
	"upload_id" uuid,
	CONSTRAINT "product_search_rank_profile_id_asin_period_pk" PRIMARY KEY("profile_id","asin","period")
);
--> statement-breakpoint
CREATE INDEX "daily_asin_gv_profile_date_idx" ON "daily_asin_gv" USING btree ("profile_id","date");--> statement-breakpoint
CREATE INDEX "keyword_sov_profile_idx" ON "keyword_sov" USING btree ("profile_id","duration");--> statement-breakpoint
CREATE INDEX "product_search_rank_profile_idx" ON "product_search_rank" USING btree ("profile_id");