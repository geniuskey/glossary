CREATE TABLE "term_slug_aliases" (
	"slug" text PRIMARY KEY NOT NULL,
	"term_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "term_slug_aliases" ADD CONSTRAINT "term_slug_aliases_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "term_slug_aliases_term_idx" ON "term_slug_aliases" USING btree ("term_id");