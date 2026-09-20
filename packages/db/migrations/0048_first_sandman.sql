CREATE TYPE "public"."unregistered_candidate_status" AS ENUM('open', 'dismissed', 'promoted');--> statement-breakpoint
CREATE TABLE "unregistered_candidates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"norm_loose" text NOT NULL,
	"text" text NOT NULL,
	"status" "unregistered_candidate_status" DEFAULT 'open' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"occurrence_count" integer DEFAULT 1 NOT NULL,
	"sample_context" text,
	"source_path" text,
	"lexicon_version" text,
	"promoted_term_id" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unregistered_candidates_occurrence_positive" CHECK ("unregistered_candidates"."occurrence_count" > 0),
	CONSTRAINT "unregistered_candidates_text_not_empty" CHECK (length(trim("unregistered_candidates"."text")) > 0)
);
--> statement-breakpoint
ALTER TABLE "unregistered_candidates" ADD CONSTRAINT "unregistered_candidates_promoted_term_id_terms_id_fk" FOREIGN KEY ("promoted_term_id") REFERENCES "public"."terms"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "unregistered_candidates" ADD CONSTRAINT "unregistered_candidates_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "unregistered_candidates_norm_loose_unique" ON "unregistered_candidates" USING btree ("norm_loose");--> statement-breakpoint
CREATE INDEX "unregistered_candidates_status_idx" ON "unregistered_candidates" USING btree ("status","last_seen_at");--> statement-breakpoint
CREATE INDEX "unregistered_candidates_occurrence_idx" ON "unregistered_candidates" USING btree ("occurrence_count","last_seen_at");