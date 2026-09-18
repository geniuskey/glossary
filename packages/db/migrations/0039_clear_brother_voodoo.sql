CREATE TYPE "public"."ai_suggestion_disposition" AS ENUM('dismissed', 'deferred', 'saved');--> statement-breakpoint
CREATE TYPE "public"."ai_suggestion_scope" AS ENUM('shared', 'personal');--> statement-breakpoint
CREATE TABLE "ai_suggestion_decisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"feature" text NOT NULL,
	"suggestion_id" text NOT NULL,
	"generator_version" integer DEFAULT 1 NOT NULL,
	"scope" "ai_suggestion_scope" NOT NULL,
	"disposition" "ai_suggestion_disposition" NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"user_id" uuid,
	"remind_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_suggestion_decisions_positive_revision" CHECK ("ai_suggestion_decisions"."revision" > 0),
	CONSTRAINT "ai_suggestion_decisions_positive_generator" CHECK ("ai_suggestion_decisions"."generator_version" > 0),
	CONSTRAINT "ai_suggestion_decisions_scope_owner" CHECK (("ai_suggestion_decisions"."scope" = 'shared' and "ai_suggestion_decisions"."user_id" is null) or ("ai_suggestion_decisions"."scope" = 'personal' and "ai_suggestion_decisions"."user_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "ai_suggestion_decisions" ADD CONSTRAINT "ai_suggestion_decisions_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_suggestion_decisions" ADD CONSTRAINT "ai_suggestion_decisions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_suggestion_decisions_term_feature_idx" ON "ai_suggestion_decisions" USING btree ("term_id","revision","feature");--> statement-breakpoint
CREATE INDEX "ai_suggestion_decisions_user_updated_idx" ON "ai_suggestion_decisions" USING btree ("user_id","updated_at");