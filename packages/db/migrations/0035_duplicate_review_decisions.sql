CREATE TYPE "public"."duplicate_review_decision" AS ENUM('different', 'uncertain');--> statement-breakpoint
CREATE TABLE "duplicate_review_decisions" (
	"left_term_id" uuid NOT NULL,
	"right_term_id" uuid NOT NULL,
	"left_revision" integer NOT NULL,
	"right_revision" integer NOT NULL,
	"decision" "duplicate_review_decision" NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_review_decisions_left_term_id_right_term_id_pk" PRIMARY KEY("left_term_id","right_term_id"),
	CONSTRAINT "duplicate_review_decisions_distinct_terms" CHECK ("duplicate_review_decisions"."left_term_id" <> "duplicate_review_decisions"."right_term_id"),
	CONSTRAINT "duplicate_review_decisions_left_revision_positive" CHECK ("duplicate_review_decisions"."left_revision" > 0),
	CONSTRAINT "duplicate_review_decisions_right_revision_positive" CHECK ("duplicate_review_decisions"."right_revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "duplicate_review_decisions" ADD CONSTRAINT "duplicate_review_decisions_left_term_id_terms_id_fk" FOREIGN KEY ("left_term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "duplicate_review_decisions" ADD CONSTRAINT "duplicate_review_decisions_right_term_id_terms_id_fk" FOREIGN KEY ("right_term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "duplicate_review_decisions" ADD CONSTRAINT "duplicate_review_decisions_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "duplicate_review_decisions_right_idx" ON "duplicate_review_decisions" USING btree ("right_term_id");
