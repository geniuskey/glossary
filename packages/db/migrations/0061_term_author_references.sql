UPDATE "terms" SET "created_by" = NULL WHERE "created_by" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "terms"."created_by");--> statement-breakpoint
UPDATE "terms" SET "updated_by" = NULL WHERE "updated_by" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "users" WHERE "users"."id" = "terms"."updated_by");--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "terms" ADD CONSTRAINT "terms_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;
