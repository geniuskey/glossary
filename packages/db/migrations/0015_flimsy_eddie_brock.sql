ALTER TABLE "terms" DROP CONSTRAINT "terms_category_business_categories_key_fk";
--> statement-breakpoint
ALTER TABLE "business_categories" ADD COLUMN "label_en" text;--> statement-breakpoint
UPDATE "business_categories"
SET "label_en" = CASE "key"
  WHEN 'product' THEN 'Product'
  WHEN 'customer' THEN 'Customer'
  WHEN 'project' THEN 'Project'
  WHEN 'process' THEN 'Process'
  WHEN 'design' THEN 'Design'
  WHEN 'evaluation' THEN 'Evaluation'
  WHEN 'equipment' THEN 'Equipment'
  WHEN 'organization' THEN 'Organization'
  WHEN 'system' THEN 'System'
  WHEN 'other' THEN 'Other'
  ELSE initcap(replace("key", '-', ' '))
END;--> statement-breakpoint
ALTER TABLE "business_categories" ALTER COLUMN "label_en" SET NOT NULL;--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "terms" ADD CONSTRAINT "terms_category_business_categories_key_fk" FOREIGN KEY ("category") REFERENCES "public"."business_categories"("key") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_categories_label_en_unique" ON "business_categories" USING btree ("label_en");
