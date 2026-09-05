CREATE TYPE "public"."term_relation_status" AS ENUM('proposed', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."term_relation_type" AS ENUM('related_to', 'is_a', 'part_of', 'used_in', 'prerequisite_of', 'replaces');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "term_relations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source_term_id" uuid NOT NULL,
	"target_term_id" uuid NOT NULL,
	"relation_type" "term_relation_type" NOT NULL,
	"status" "term_relation_status" DEFAULT 'proposed' NOT NULL,
	"confidence" integer DEFAULT 100 NOT NULL,
	"evidence_md" text,
	"source_revision" integer,
	"target_revision" integer,
	"created_by" uuid,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	CONSTRAINT "term_relations_distinct_terms" CHECK ("term_relations"."source_term_id" <> "term_relations"."target_term_id"),
	CONSTRAINT "term_relations_confidence_range" CHECK ("term_relations"."confidence" between 0 and 100),
	CONSTRAINT "term_relations_positive_source_revision" CHECK ("term_relations"."source_revision" is null or "term_relations"."source_revision" > 0),
	CONSTRAINT "term_relations_positive_target_revision" CHECK ("term_relations"."target_revision" is null or "term_relations"."target_revision" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "term_relations" ADD CONSTRAINT "term_relations_source_term_id_terms_id_fk" FOREIGN KEY ("source_term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "term_relations" ADD CONSTRAINT "term_relations_target_term_id_terms_id_fk" FOREIGN KEY ("target_term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "term_relations" ADD CONSTRAINT "term_relations_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "term_relations" ADD CONSTRAINT "term_relations_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "term_relations_unique" ON "term_relations" USING btree ("source_term_id","target_term_id","relation_type");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "term_relations_source_idx" ON "term_relations" USING btree ("source_term_id","status");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "term_relations_target_idx" ON "term_relations" USING btree ("target_term_id","status");