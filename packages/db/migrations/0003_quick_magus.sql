-- R130: 승인 축 제거 — draft|approved|deprecated|forbidden → active|deprecated|forbidden.
--
-- drizzle-kit이 생성한 원본은 이 순서였다: SET DEFAULT 'active' → 컬럼을 text로 →
-- DROP TYPE → CREATE TYPE → 다시 enum으로 캐스팅. 빈 DB에서만 통과한다. 실제
-- 데이터가 있는 DB에서는 두 군데서 깨진다.
--   1. 첫 줄의 SET DEFAULT 'active'는 컬럼이 아직 옛 enum이라
--      "invalid input value for enum term_status: active"로 그 자리에서 실패한다.
--   2. 그걸 넘겨도 마지막 캐스팅에서 기존 'draft'/'approved' 행이 같은 이유로 실패한다.
-- 그래서 DEFAULT를 먼저 떼고, text인 동안 옛 값을 active로 접은 뒤, 캐스팅하고,
-- 마지막에 새 DEFAULT를 건다.
--
-- term_revisions.snapshot(jsonb) 안의 옛 status 문자열은 일부러 건드리지 않는다 —
-- 리비전은 "그때 그랬다"는 기록이라 고쳐 쓰면 이력이 거짓말이 된다. 되돌리기가
-- 읽을 때 lib/terms/revert.ts가 옛 값을 active로 옮긴다.
ALTER TABLE "terms" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "public"."terms" ALTER COLUMN "status" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."term_status";--> statement-breakpoint
CREATE TYPE "public"."term_status" AS ENUM('active', 'deprecated', 'forbidden');--> statement-breakpoint
UPDATE "terms" SET "status" = 'active' WHERE "status" IN ('draft', 'approved');--> statement-breakpoint
ALTER TABLE "public"."terms" ALTER COLUMN "status" SET DATA TYPE "public"."term_status" USING "status"::"public"."term_status";--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "status" SET DEFAULT 'active';
