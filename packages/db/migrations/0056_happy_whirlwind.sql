CREATE TYPE "public"."sync_bundle_mode" AS ENUM('full', 'incremental');--> statement-breakpoint
CREATE TYPE "public"."sync_entity_type" AS ENUM('term', 'wiki_page', 'relation', 'domain', 'business_category');--> statement-breakpoint
CREATE TABLE "sync_entities" (
	"source_instance_id" uuid NOT NULL,
	"entity_type" "sync_entity_type" NOT NULL,
	"entity_id" text NOT NULL,
	"content_hash" text NOT NULL,
	"local_revision" integer,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_entities_source_instance_id_entity_type_entity_id_pk" PRIMARY KEY("source_instance_id","entity_type","entity_id")
);
--> statement-breakpoint
CREATE TABLE "sync_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"mode" "sync_bundle_mode" NOT NULL,
	"base_export_id" uuid,
	"manifest" jsonb NOT NULL,
	"counts" jsonb NOT NULL,
	"byte_size" integer,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_instance" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"instance_id" uuid DEFAULT gen_random_uuid() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sync_instance_single_row" CHECK ("sync_instance"."id" = 'default')
);
--> statement-breakpoint
CREATE TABLE "sync_sources" (
	"instance_id" uuid PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"last_bundle_id" uuid NOT NULL,
	"last_exported_at" timestamp with time zone NOT NULL,
	"last_imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_report" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sync_entities" ADD CONSTRAINT "sync_entities_source_instance_id_sync_sources_instance_id_fk" FOREIGN KEY ("source_instance_id") REFERENCES "public"."sync_sources"("instance_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_exports" ADD CONSTRAINT "sync_exports_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sync_entities_entity_idx" ON "sync_entities" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "sync_exports_created_idx" ON "sync_exports" USING btree ("created_at");