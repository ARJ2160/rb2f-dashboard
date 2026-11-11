CREATE TABLE "daily_pi_city_sales" (
	"profile_id" text NOT NULL,
	"date" date NOT NULL,
	"asin" text NOT NULL,
	"state" text NOT NULL,
	"city" text NOT NULL,
	"postal_code" text NOT NULL,
	"gross_sales" numeric(14, 2) DEFAULT 0 NOT NULL,
	"gross_units" integer DEFAULT 0 NOT NULL,
	"net_sales" numeric(14, 2) DEFAULT 0 NOT NULL,
	"net_units" integer DEFAULT 0 NOT NULL,
	"indexed_glance_views" numeric(16, 2) DEFAULT 0 NOT NULL,
	"upload_id" uuid,
	CONSTRAINT "daily_pi_city_sales_profile_id_date_asin_state_city_postal_code_pk" PRIMARY KEY("profile_id","date","asin","state","city","postal_code")
);
--> statement-breakpoint
CREATE INDEX "daily_pi_city_sales_profile_date_idx" ON "daily_pi_city_sales" USING btree ("profile_id","date");