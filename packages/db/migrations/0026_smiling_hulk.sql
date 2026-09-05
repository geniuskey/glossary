CREATE TYPE "public"."ai_review_queue_status" AS ENUM('queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TYPE "public"."ai_review_request_mode" AS ENUM('automatic', 'manual');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_review_queue" (
	"term_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"status" "ai_review_queue_status" DEFAULT 'queued' NOT NULL,
	"request_mode" "ai_review_request_mode" DEFAULT 'automatic' NOT NULL,
	"requested_by" uuid,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text,
	CONSTRAINT "ai_review_queue_positive_revision" CHECK ("ai_review_queue"."revision" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_review_queue" ADD CONSTRAINT "ai_review_queue_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_review_queue" ADD CONSTRAINT "ai_review_queue_requested_by_users_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_review_queue_status_requested_idx" ON "ai_review_queue" USING btree ("status","requested_at");--> statement-breakpoint
INSERT INTO "ai_review_queue" ("term_id", "revision", "status", "request_mode", "requested_at", "finished_at")
SELECT "term_id", "revision", 'ready', 'automatic', "generated_at", "generated_at"
FROM "ai_review_suggestions"
WHERE "generator_version" = 2
ON CONFLICT ("term_id") DO NOTHING;
