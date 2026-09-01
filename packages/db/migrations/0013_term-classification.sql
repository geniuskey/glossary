CREATE TYPE "public"."business_category" AS ENUM('product', 'customer', 'project', 'process', 'design', 'evaluation', 'equipment', 'organization', 'system', 'other');--> statement-breakpoint

-- v0.1.x의 category는 자유 입력 세부 주제였다. 새 enum 컬럼으로 캐스팅하기
-- 전에 topic으로 전부 보존해야 운영 데이터가 'other'로 뭉개지지 않는다.
ALTER TABLE "terms" ADD COLUMN "topic" text;--> statement-breakpoint
UPDATE "terms" SET "topic" = "category" WHERE "category" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "terms" DROP COLUMN "category";--> statement-breakpoint
ALTER TABLE "terms" ADD COLUMN "category" "business_category";--> statement-breakpoint

-- 과거 자유 입력값이 새 표준 키와 정확히 같으면 분류도 함께 살린다.
UPDATE "terms"
SET "category" = "topic"::"business_category"
WHERE "topic" IN ('product', 'customer', 'project', 'process', 'design', 'evaluation', 'equipment', 'organization', 'system', 'other');--> statement-breakpoint

-- 기존 Type 중 대상 종류였던 두 값은 새 Category로 결정적으로 옮길 수 있다.
UPDATE "terms" SET "category" = 'project' WHERE "term_type" = 'project';--> statement-breakpoint
UPDATE "terms" SET "category" = 'product' WHERE "term_type" = 'product_id';--> statement-breakpoint

ALTER TABLE "terms" ALTER COLUMN "term_type" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "term_type" SET DATA TYPE text USING "term_type"::text;--> statement-breakpoint
DROP TYPE "public"."term_type";--> statement-breakpoint
CREATE TYPE "public"."term_type" AS ENUM('concept', 'proper_name', 'identifier', 'unit');--> statement-breakpoint
UPDATE "terms"
SET "term_type" = CASE "term_type"
  WHEN 'term' THEN 'concept'
  WHEN 'abbreviation' THEN 'concept'
  WHEN 'project' THEN 'proper_name'
  WHEN 'product_id' THEN 'identifier'
  WHEN 'code' THEN 'identifier'
  WHEN 'unit' THEN 'unit'
  ELSE 'concept'
END;--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "term_type" SET DATA TYPE "public"."term_type" USING "term_type"::"public"."term_type";--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "term_type" SET DEFAULT 'concept';--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "terms_category_idx" ON "terms" USING btree ("category");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "terms_topic_idx" ON "terms" USING btree ("topic");
