ALTER TABLE "public"."terms" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."terms" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
-- 과거 정책 상태는 더 이상 유효하지 않다. 행 자체는 보존하고 보완 필요 상태로
-- 돌려 다음 저장(또는 품질 기준 저장)에서 현재 내용으로 다시 판정한다.
UPDATE "public"."terms" SET "status" = 'draft' WHERE "status" IN ('deprecated', 'forbidden');--> statement-breakpoint
DROP TYPE "public"."term_status";--> statement-breakpoint
CREATE TYPE "public"."term_status" AS ENUM('draft', 'active');--> statement-breakpoint
ALTER TABLE "public"."terms" ALTER COLUMN "status" SET DATA TYPE "public"."term_status" USING "status"::"public"."term_status";--> statement-breakpoint
ALTER TABLE "public"."terms" ALTER COLUMN "status" SET DEFAULT 'draft';--> statement-breakpoint
-- 기존 두 상태도 더는 사용자 선택을 뜻하지 않는다. 현재 작업공간 기준으로
-- 전 행을 다시 계산해 배포 직후부터 저장 상태와 판정 의미를 일치시킨다.
UPDATE "public"."terms"
SET "status" = CASE
  WHEN (
    (btrim(coalesce("full_name_en", '')) <> '' OR btrim(coalesce("full_name_ko", '')) <> '')
    AND coalesce("name_en", "name_ko", '') ~ '^[A-Z0-9][A-Z0-9+./-]{1,11}$'
  ) OR (
    char_length(btrim(coalesce("definition_md", ''))) >= greatest(
      1,
      coalesce((SELECT "definition_min_chars" FROM "public"."workspace_settings" WHERE "id" = 'default'), 1)
    )
    AND (cardinality("domain") > 0 OR cardinality("category") > 0)
  )
  THEN 'active'::"public"."term_status"
  ELSE 'draft'::"public"."term_status"
END;
