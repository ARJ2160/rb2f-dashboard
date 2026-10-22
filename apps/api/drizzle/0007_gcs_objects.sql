CREATE TABLE "gcs_objects" (
	"profile_id" text NOT NULL,
	"object_name" text NOT NULL,
	"generation" text NOT NULL,
	"size" integer DEFAULT 0 NOT NULL,
	"object_updated" timestamp with time zone,
	"status" text NOT NULL,
	"report_types" text,
	"rows_stored" integer DEFAULT 0 NOT NULL,
	"date_from" date,
	"date_to" date,
	"message" text,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "gcs_objects_profile_id_object_name_pk" PRIMARY KEY("profile_id","object_name")
);
