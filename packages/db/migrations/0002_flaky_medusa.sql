ALTER TABLE "term_revisions" ADD COLUMN "author_key_id" uuid;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "term_revisions" ADD CONSTRAINT "term_revisions_author_key_id_api_keys_id_fk" FOREIGN KEY ("author_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
