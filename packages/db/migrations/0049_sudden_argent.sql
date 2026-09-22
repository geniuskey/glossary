CREATE TYPE "public"."ontology_node_kind" AS ENUM('term', 'wiki_page');--> statement-breakpoint
CREATE TABLE "ontology_predicates" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"inverse_key" text,
	"symmetric" boolean DEFAULT false NOT NULL,
	"transitive" boolean DEFAULT false NOT NULL,
	"source_kind" "ontology_node_kind" NOT NULL,
	"target_kind" "ontology_node_kind" NOT NULL,
	"description" text,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ontology_predicates_valid_kinds" CHECK (
      ("ontology_predicates"."key" in ('defines', 'applies_to') and "ontology_predicates"."source_kind" = 'wiki_page' and "ontology_predicates"."target_kind" = 'term')
      or ("ontology_predicates"."key" in ('defined_in', 'applied_in') and "ontology_predicates"."source_kind" = 'term' and "ontology_predicates"."target_kind" = 'wiki_page')
      or ("ontology_predicates"."key" not in ('defines', 'applies_to', 'defined_in', 'applied_in') and "ontology_predicates"."source_kind" = 'term' and "ontology_predicates"."target_kind" = 'term')
    )
);
--> statement-breakpoint
CREATE INDEX "ontology_predicates_inverse_key_idx" ON "ontology_predicates" USING btree ("inverse_key");--> statement-breakpoint
CREATE INDEX "ontology_predicates_order_idx" ON "ontology_predicates" USING btree ("sort_order","key");
--> statement-breakpoint
INSERT INTO "ontology_predicates" ("key", "label", "inverse_key", "symmetric", "transitive", "source_kind", "target_kind", "description", "sort_order") VALUES
  ('related_to', '관련됨', 'related_to', true, false, 'term', 'term', '상하위·부분 관계를 확정할 수 없는 일반적인 관련 관계', 10),
  ('is_a', '하위 종류임', 'has_subtype', false, true, 'term', 'term', '출발 개념은 도착 개념의 하위 종류', 20),
  ('has_subtype', '하위 종류를 가짐', 'is_a', false, true, 'term', 'term', '출발 개념은 도착 개념의 상위 종류', 21),
  ('part_of', '일부임', 'contains', false, true, 'term', 'term', '출발 개념은 도착 개념을 구성하는 일부', 30),
  ('contains', '구성 요소를 가짐', 'part_of', false, true, 'term', 'term', '출발 개념은 도착 개념의 구성 요소를 가짐', 31),
  ('used_in', '사용됨', 'has_usage', false, false, 'term', 'term', '출발 개념이 도착 개념에서 사용됨', 40),
  ('has_usage', '사용함', 'used_in', false, false, 'term', 'term', '출발 개념이 도착 개념을 사용함', 41),
  ('prerequisite_of', '선행 조건임', 'required_for', false, false, 'term', 'term', '출발 개념은 도착 개념에 앞서 충족되어야 함', 50),
  ('required_for', '선행 조건으로 요구됨', 'prerequisite_of', false, false, 'term', 'term', '출발 개념은 도착 개념의 선행 조건으로 요구됨', 51),
  ('replaces', '대체함', 'replaced_by', false, false, 'term', 'term', '출발 개념이 도착 개념을 대체함', 60),
  ('replaced_by', '대체됨', 'replaces', false, false, 'term', 'term', '출발 개념이 도착 개념으로 대체됨', 61),
  ('defines', '정의함', 'defined_in', false, false, 'wiki_page', 'term', '위키 문서가 개념을 정의함', 70),
  ('defined_in', '정의된 문서', 'defines', false, false, 'term', 'wiki_page', '개념이 해당 위키 문서에서 정의됨', 71),
  ('applies_to', '적용됨', 'applied_in', false, false, 'wiki_page', 'term', '위키 문서의 맥락이 개념에 적용됨', 80),
  ('applied_in', '적용 문서', 'applies_to', false, false, 'term', 'wiki_page', '개념이 해당 위키 문서의 적용 대상임', 81)
ON CONFLICT ("key") DO NOTHING;
