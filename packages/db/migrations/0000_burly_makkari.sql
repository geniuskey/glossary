CREATE TYPE "public"."surface_kind" AS ENUM('canonical', 'abbreviation', 'full_name', 'alias', 'discouraged', 'forbidden');--> statement-breakpoint
CREATE TYPE "public"."surface_lang" AS ENUM('en', 'ko', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."term_status" AS ENUM('draft', 'approved', 'deprecated', 'forbidden');--> statement-breakpoint
CREATE TYPE "public"."term_type" AS ENUM('term', 'abbreviation', 'project', 'product_id', 'code', 'unit');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "term_surfaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"text" text NOT NULL,
	"lang" "surface_lang" DEFAULT 'neutral' NOT NULL,
	"kind" "surface_kind" DEFAULT 'alias' NOT NULL,
	"case_sensitive" boolean DEFAULT false NOT NULL,
	"norm_loose" text NOT NULL,
	"norm_space" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "terms" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"term_type" "term_type" DEFAULT 'term' NOT NULL,
	"name_en" text,
	"name_ko" text,
	"full_name_en" text,
	"full_name_ko" text,
	"domain" text[] DEFAULT '{}' NOT NULL,
	"status" "term_status" DEFAULT 'draft' NOT NULL,
	"definition_md" text,
	"body_md" text,
	"replaced_by_id" uuid,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "term_surfaces" ADD CONSTRAINT "term_surfaces_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "term_surfaces_norm_loose_idx" ON "term_surfaces" USING btree ("norm_loose");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "term_surfaces_norm_space_idx" ON "term_surfaces" USING btree ("norm_space");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "term_surfaces_norm_loose_trgm" ON "term_surfaces" USING gin ("norm_loose" gin_trgm_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "term_surfaces_term_idx" ON "term_surfaces" USING btree ("term_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "term_surfaces_unique" ON "term_surfaces" USING btree ("term_id","norm_loose","kind");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "terms_slug_unique" ON "terms" USING btree ("slug");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "terms_status_idx" ON "terms" USING btree ("status");