ALTER TABLE "wiki_pages" ADD COLUMN "reviewed_by" uuid;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD COLUMN "reviewed_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;