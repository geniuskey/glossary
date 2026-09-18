CREATE TABLE "identity_review_suggestions" (
	"term_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"generator_version" integer DEFAULT 1 NOT NULL,
	"findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"suggestions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "identity_review_suggestions_positive_revision" CHECK ("identity_review_suggestions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "identity_review_suggestions" ADD CONSTRAINT "identity_review_suggestions_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;