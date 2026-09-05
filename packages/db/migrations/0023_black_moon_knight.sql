CREATE TABLE IF NOT EXISTS "ai_review_suggestions" (
	"term_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_review_suggestions_positive_revision" CHECK ("ai_review_suggestions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "ai_config" ADD COLUMN "auto_review_enabled" boolean DEFAULT false NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_review_suggestions" ADD CONSTRAINT "ai_review_suggestions_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
