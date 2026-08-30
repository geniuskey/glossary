-- 초안을 실제 공개 경계로 되살린다. 기존 행은 그대로 유지하고 새 행만 draft로
-- 시작한다. enum 값을 추가한 트랜잭션 안에서 곧바로 기본값으로 쓰는 PostgreSQL
-- 버전별 제약을 피하기 위해 타입을 안전하게 재생성한다.
ALTER TABLE "terms" ALTER COLUMN "status" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "status" TYPE text USING "status"::text;--> statement-breakpoint
DROP TYPE "public"."term_status";--> statement-breakpoint
CREATE TYPE "public"."term_status" AS ENUM('draft', 'active', 'deprecated', 'forbidden');--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "status" TYPE "public"."term_status" USING "status"::"public"."term_status";--> statement-breakpoint
ALTER TABLE "terms" ALTER COLUMN "status" SET DEFAULT 'draft';
