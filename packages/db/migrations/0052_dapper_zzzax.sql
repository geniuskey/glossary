ALTER TABLE "terms" ADD COLUMN "tags" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
UPDATE "terms" SET "tags" = ARRAY["topic"] WHERE "topic" IS NOT NULL AND btrim("topic") <> '';--> statement-breakpoint
CREATE INDEX "terms_tags_idx" ON "terms" USING gin ("tags");
