-- Adds snapshot_date to keyword_sov and moves it into the primary key.
-- Order matters: drop the old PK/index first, add the column (nullable so
-- existing rows don't fail), backfill them, then make it NOT NULL and
-- create the new PK + index that reference it.

DROP INDEX IF EXISTS "keyword_sov_profile_idx";--> statement-breakpoint
ALTER TABLE "keyword_sov" DROP CONSTRAINT IF EXISTS "keyword_sov_profile_id_duration_keyword_pk";--> statement-breakpoint
ALTER TABLE "keyword_sov" ADD COLUMN IF NOT EXISTS "snapshot_date" date;--> statement-breakpoint
-- Backfill any pre-existing rows (there shouldn't be real data yet; set a
-- sentinel so NOT NULL + the new PK can be added). Re-ingesting the file
-- replaces these rows with the real snapshot date.
UPDATE "keyword_sov" SET "snapshot_date" = CURRENT_DATE WHERE "snapshot_date" IS NULL;--> statement-breakpoint
ALTER TABLE "keyword_sov" ALTER COLUMN "snapshot_date" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "keyword_sov" ADD CONSTRAINT "keyword_sov_profile_id_duration_snapshot_date_keyword_pk" PRIMARY KEY("profile_id","duration","snapshot_date","keyword");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "keyword_sov_profile_idx" ON "keyword_sov" USING btree ("profile_id","duration","snapshot_date");
