ALTER TABLE "terms" DROP CONSTRAINT "terms_category_business_categories_key_fk";
--> statement-breakpoint
DROP INDEX IF EXISTS "terms_category_idx";--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "category" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "category" SET DATA TYPE text[] USING (
  case when "category" is null then array[]::text[] else array["category"]::text[] end
);--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "category" SET DEFAULT '{}';--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "category" SET NOT NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "terms_category_idx" ON "terms" USING gin ("category");
