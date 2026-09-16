CREATE TABLE "definition_review_suggestions" (
	"term_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"suggestion" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "definition_review_suggestions_positive_revision" CHECK ("definition_review_suggestions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "definition_review_suggestions" ADD CONSTRAINT "definition_review_suggestions_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;