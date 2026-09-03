CREATE TYPE "public"."term_quality_profile" AS ENUM('auto', 'mapping', 'context', 'guidance');--> statement-breakpoint
CREATE TYPE "public"."ai_provider" AS ENUM('gemini', 'openai_compatible');--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"provider" "ai_provider" DEFAULT 'gemini' NOT NULL,
	"base_url" text DEFAULT 'https://generativelanguage.googleapis.com/v1beta' NOT NULL,
	"model" text DEFAULT 'gemini-3.6-flash' NOT NULL,
	"api_key_encrypted" text DEFAULT '' NOT NULL,
	"custom_headers_encrypted" text DEFAULT '' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "ai_config_single_row" CHECK ("ai_config"."id" = 'default')
);
--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "quality_profile" "term_quality_profile" DEFAULT 'auto' NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "ai_config" ADD CONSTRAINT "ai_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
