CREATE TABLE IF NOT EXISTS "workspace_settings" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"home_eyebrow" text NOT NULL,
	"home_title" text NOT NULL,
	"home_description" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid,
	CONSTRAINT "workspace_settings_single_row" CHECK ("workspace_settings"."id" = 'default')
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
