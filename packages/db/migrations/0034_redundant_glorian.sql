CREATE TYPE "public"."classification_review_kind" AS ENUM('domain', 'category');--> statement-breakpoint
CREATE TABLE "classification_review_suggestions" (
	"term_id" uuid NOT NULL,
	"kind" "classification_review_kind" NOT NULL,
	"revision" integer NOT NULL,
	"values" text[] DEFAULT array[]::text[] NOT NULL,
	"reason" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "classification_review_suggestions_term_id_kind_pk" PRIMARY KEY("term_id","kind"),
	CONSTRAINT "classification_review_suggestions_positive_revision" CHECK ("classification_review_suggestions"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "classification_review_suggestions" ADD CONSTRAINT "classification_review_suggestions_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;