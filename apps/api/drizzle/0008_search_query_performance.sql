-- Brand Analytics Search Query Performance (Brand View), keyed on the reporting period.
CREATE TABLE "search_query_performance" (
	"profile_id" text NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"search_query" text NOT NULL,
	"volume" integer DEFAULT 0 NOT NULL,
	"impressions_total" integer DEFAULT 0 NOT NULL,
	"impressions_brand" integer DEFAULT 0 NOT NULL,
	"clicks_total" integer DEFAULT 0 NOT NULL,
	"clicks_brand" integer DEFAULT 0 NOT NULL,
	"cart_adds_total" integer DEFAULT 0 NOT NULL,
	"cart_adds_brand" integer DEFAULT 0 NOT NULL,
	"purchases_total" integer DEFAULT 0 NOT NULL,
	"purchases_brand" integer DEFAULT 0 NOT NULL,
	"upload_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "search_query_performance_profile_id_period_start_period_end_search_query_pk" PRIMARY KEY("profile_id","period_start","period_end","search_query")
);
--> statement-breakpoint
CREATE INDEX "search_query_performance_profile_period_idx" ON "search_query_performance" USING btree ("profile_id","period_start","period_end");
