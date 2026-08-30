ALTER TABLE "terms" ADD COLUMN "category" text;
--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "owner_id" uuid;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "terms" ADD CONSTRAINT "terms_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "terms_category_idx" ON "terms" USING btree ("category");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "terms_owner_idx" ON "terms" USING btree ("owner_id");
