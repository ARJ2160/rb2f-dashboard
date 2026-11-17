CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"logo_url" text,
	"vendor_codes" text[] DEFAULT '{}'::text[] NOT NULL,
	"seller_ids" text[] DEFAULT '{}'::text[] NOT NULL,
	"marketplace" text DEFAULT 'Amazon.in' NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_channels" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"has_vendor_central" boolean DEFAULT false NOT NULL,
	"has_seller_central" boolean DEFAULT false NOT NULL,
	"last_vc_upload" date,
	"last_sc_upload" date,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_settings" (
	"brand_id" text PRIMARY KEY NOT NULL,
	"critical_days" integer DEFAULT 12 NOT NULL,
	"excess_days" integer DEFAULT 60 NOT NULL,
	"due_soon_days" integer DEFAULT 3 NOT NULL,
	"vc_sales_metric" text DEFAULT 'Shipped Units' NOT NULL,
	"vc_revenue_metric" text DEFAULT 'Shipped Revenue' NOT NULL,
	"stuck_receiving_days" integer DEFAULT 14 NOT NULL,
	"working_too_long_days" integer DEFAULT 5 NOT NULL,
	"in_transit_too_long_days" integer DEFAULT 10 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dim_warehouse" (
	"code" text PRIMARY KEY NOT NULL,
	"network" text DEFAULT 'Core' NOT NULL,
	"city" text,
	"state" text,
	"needs_review" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "dim_product" (
	"brand_id" text NOT NULL,
	"asin" text DEFAULT '' NOT NULL,
	"msku" text DEFAULT '' NOT NULL,
	"fnsku" text DEFAULT '' NOT NULL,
	"model_number" text,
	"title" text,
	"short_name" text,
	"extra" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dim_product_brand_id_asin_msku_fnsku_pk" PRIMARY KEY("brand_id","asin","msku","fnsku")
);
--> statement-breakpoint
CREATE INDEX "dim_product_brand_idx" ON "dim_product" USING btree ("brand_id");
--> statement-breakpoint
CREATE TABLE "import_batches" (
	"id" text PRIMARY KEY NOT NULL,
	"brand_id" text NOT NULL,
	"filename" text NOT NULL,
	"file_type" text,
	"channel" text,
	"status" text NOT NULL,
	"rows" integer DEFAULT 0 NOT NULL,
	"headers_found" integer,
	"date_from" date,
	"date_to" date,
	"identifier_warning" text,
	"message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "import_batches_brand_created_idx" ON "import_batches" USING btree ("brand_id","created_at");

--> statement-breakpoint
INSERT INTO "dim_warehouse" ("code","network","city","state","needs_review") VALUES
	('HAD1','Amazon Now',NULL,NULL,true),
	('HBA4','Amazon Now',NULL,NULL,true),
	('HBL4','Amazon Now',NULL,NULL,true),
	('HCC6','Amazon Now',NULL,NULL,true),
	('HCI2','Amazon Now',NULL,NULL,true),
	('HDL2','Amazon Now',NULL,NULL,true),
	('HHS1','Amazon Now','Gurgaon','Haryana',false),
	('HHS6','Amazon Now',NULL,NULL,true),
	('HHY7','Amazon Now',NULL,NULL,true),
	('HKA2','Amazon Now',NULL,NULL,true),
	('HKR2','Amazon Now',NULL,NULL,true),
	('HLK1','Amazon Now',NULL,NULL,true),
	('HMU5','Amazon Now',NULL,NULL,true),
	('HMV4','Amazon Now',NULL,NULL,true),
	('HNR4','Amazon Now',NULL,NULL,true),
	('HPN6','Amazon Now',NULL,NULL,true)
ON CONFLICT ("code") DO NOTHING;
