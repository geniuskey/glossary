CREATE TABLE IF NOT EXISTS "business_categories" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "business_categories" ("key", "label", "sort_order") VALUES
  ('product', '제품', 0),
  ('customer', '고객', 1),
  ('project', '프로젝트', 2),
  ('process', '공정', 3),
  ('design', '설계', 4),
  ('evaluation', '평가', 5),
  ('equipment', '장비', 6),
  ('organization', '조직', 7),
  ('system', '시스템', 8),
  ('other', '기타', 9)
ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "category" SET DATA TYPE text USING "category"::text;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "business_categories_label_unique" ON "business_categories" USING btree ("label");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "business_categories_order_idx" ON "business_categories" USING btree ("sort_order","key");--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "terms" ADD CONSTRAINT "terms_category_business_categories_key_fk" FOREIGN KEY ("category") REFERENCES "public"."business_categories"("key") ON DELETE restrict ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DROP TYPE "public"."business_category";
