ALTER TABLE "workspace_settings" ADD COLUMN "definition_min_chars" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD COLUMN "body_min_chars" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_definition_min_chars_range" CHECK ("workspace_settings"."definition_min_chars" between 0 and 10000);--> statement-breakpoint
ALTER TABLE "workspace_settings" ADD CONSTRAINT "workspace_settings_body_min_chars_range" CHECK ("workspace_settings"."body_min_chars" between 0 and 10000);