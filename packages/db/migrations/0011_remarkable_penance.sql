CREATE TABLE IF NOT EXISTS "attachment_refs" (
	"attachment_id" uuid NOT NULL,
	"term_id" uuid NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL,
	"stored_mime" text NOT NULL,
	"byte_size" integer NOT NULL,
	"width" integer NOT NULL,
	"height" integer NOT NULL,
	"original_filename" text NOT NULL,
	"original_mime" text NOT NULL,
	"original_bytes" integer NOT NULL,
	"uploaded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachment_refs" ADD CONSTRAINT "attachment_refs_attachment_id_attachments_id_fk" FOREIGN KEY ("attachment_id") REFERENCES "public"."attachments"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachment_refs" ADD CONSTRAINT "attachment_refs_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "attachments" ADD CONSTRAINT "attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attachment_refs_unique" ON "attachment_refs" USING btree ("attachment_id","term_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "attachment_refs_term_idx" ON "attachment_refs" USING btree ("term_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "attachments_sha256_unique" ON "attachments" USING btree ("sha256");