CREATE TABLE "sc_ledger_summary" (
	"brand_id" text NOT NULL,
	"date" date NOT NULL,
	"fnsku" text NOT NULL,
	"disposition" text NOT NULL,
	"location" text NOT NULL,
	"asin" text DEFAULT '' NOT NULL,
	"msku" text DEFAULT '' NOT NULL,
	"title" text,
	"starting_balance" integer DEFAULT 0 NOT NULL,
	"in_transit_between" integer DEFAULT 0 NOT NULL,
	"receipts" integer DEFAULT 0 NOT NULL,
	"customer_shipments" integer DEFAULT 0 NOT NULL,
	"customer_returns" integer DEFAULT 0 NOT NULL,
	"vendor_returns" integer DEFAULT 0 NOT NULL,
	"warehouse_transfer" integer DEFAULT 0 NOT NULL,
	"found" integer DEFAULT 0 NOT NULL,
	"lost" integer DEFAULT 0 NOT NULL,
	"damaged" integer DEFAULT 0 NOT NULL,
	"disposed" integer DEFAULT 0 NOT NULL,
	"other_events" integer DEFAULT 0 NOT NULL,
	"ending_balance" integer DEFAULT 0 NOT NULL,
	"unknown_events" integer DEFAULT 0 NOT NULL,
	"upload_id" text,
	CONSTRAINT "sc_ledger_summary_brand_id_date_fnsku_disposition_location_pk" PRIMARY KEY("brand_id","date","fnsku","disposition","location")
);
--> statement-breakpoint
CREATE INDEX "sc_ledger_summary_brand_date_idx" ON "sc_ledger_summary" USING btree ("brand_id","date");
--> statement-breakpoint
CREATE INDEX "sc_ledger_summary_brand_loc_idx" ON "sc_ledger_summary" USING btree ("brand_id","location");
--> statement-breakpoint
CREATE TABLE "sc_ledger_detail" (
	"brand_id" text NOT NULL,
	"row_hash" text NOT NULL,
	"date" date NOT NULL,
	"fnsku" text DEFAULT '' NOT NULL,
	"asin" text DEFAULT '' NOT NULL,
	"msku" text DEFAULT '' NOT NULL,
	"title" text,
	"event_type" text DEFAULT '' NOT NULL,
	"reference_id" text DEFAULT '' NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"fulfillment_center" text DEFAULT '' NOT NULL,
	"disposition" text DEFAULT '' NOT NULL,
	"reason" text,
	"country" text,
	"upload_id" text,
	CONSTRAINT "sc_ledger_detail_brand_id_row_hash_pk" PRIMARY KEY("brand_id","row_hash")
);
--> statement-breakpoint
CREATE INDEX "sc_ledger_detail_brand_ref_idx" ON "sc_ledger_detail" USING btree ("brand_id","reference_id");
--> statement-breakpoint
CREATE INDEX "sc_ledger_detail_brand_date_idx" ON "sc_ledger_detail" USING btree ("brand_id","date");
--> statement-breakpoint
CREATE TABLE "sc_fba_inventory" (
	"brand_id" text NOT NULL,
	"snapshot_date" date NOT NULL,
	"sku" text NOT NULL,
	"fnsku" text DEFAULT '' NOT NULL,
	"asin" text DEFAULT '' NOT NULL,
	"product_name" text,
	"available" integer DEFAULT 0 NOT NULL,
	"inbound_quantity" integer DEFAULT 0 NOT NULL,
	"inbound_working" integer DEFAULT 0 NOT NULL,
	"inbound_shipped" integer DEFAULT 0 NOT NULL,
	"inbound_received" integer DEFAULT 0 NOT NULL,
	"reserved" integer DEFAULT 0 NOT NULL,
	"unfulfillable" integer DEFAULT 0 NOT NULL,
	"units_shipped_7" integer,
	"units_shipped_30" integer,
	"units_shipped_60" integer,
	"units_shipped_90" integer,
	"days_of_supply" numeric(12, 2),
	"weeks_of_cover_t30" numeric(12, 2),
	"sell_through" numeric(12, 4),
	"recommended_ship_in_qty" integer,
	"recommended_ship_in_date" text,
	"alert" text,
	"extra" jsonb,
	"upload_id" text,
	CONSTRAINT "sc_fba_inventory_brand_id_snapshot_date_sku_pk" PRIMARY KEY("brand_id","snapshot_date","sku")
);
--> statement-breakpoint
CREATE INDEX "sc_fba_inventory_brand_snap_idx" ON "sc_fba_inventory" USING btree ("brand_id","snapshot_date");
--> statement-breakpoint
CREATE TABLE "sc_shipments" (
	"brand_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"shipment_name" text DEFAULT '' NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"created" date,
	"last_updated" date,
	"destination" text DEFAULT '' NOT NULL,
	"delivery_window" text,
	"skus" integer DEFAULT 0 NOT NULL,
	"units_expected" integer DEFAULT 0 NOT NULL,
	"units_located" integer DEFAULT 0 NOT NULL,
	"upload_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sc_shipments_brand_id_shipment_id_pk" PRIMARY KEY("brand_id","shipment_id")
);
--> statement-breakpoint
CREATE INDEX "sc_shipments_brand_status_idx" ON "sc_shipments" USING btree ("brand_id","status");
--> statement-breakpoint
CREATE INDEX "sc_shipments_brand_dest_idx" ON "sc_shipments" USING btree ("brand_id","destination");
--> statement-breakpoint
CREATE TABLE "sc_shipments_history" (
	"brand_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"as_of" date NOT NULL,
	"status" text DEFAULT '' NOT NULL,
	"units_expected" integer DEFAULT 0 NOT NULL,
	"units_located" integer DEFAULT 0 NOT NULL,
	"upload_id" text,
	CONSTRAINT "sc_shipments_history_brand_id_shipment_id_as_of_pk" PRIMARY KEY("brand_id","shipment_id","as_of")
);
--> statement-breakpoint
CREATE TABLE "sc_shipment_contents" (
	"brand_id" text NOT NULL,
	"shipment_id" text NOT NULL,
	"sku" text NOT NULL,
	"fnsku" text DEFAULT '' NOT NULL,
	"asin" text DEFAULT '' NOT NULL,
	"units_shipped" integer DEFAULT 0 NOT NULL,
	"units_received" integer DEFAULT 0 NOT NULL,
	"upload_id" text,
	CONSTRAINT "sc_shipment_contents_brand_id_shipment_id_sku_pk" PRIMARY KEY("brand_id","shipment_id","sku")
);
