import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

/** 온톨로지 관계의 양 끝에 허용되는 현재 노드 종류. */
export const ontologyNodeKindEnum = pgEnum("ontology_node_kind", ["term", "wiki_page"]);

/**
 * 관계 의미 카탈로그.
 *
 * 실제 edge는 기존 term_relations와 wiki_page_terms가 소유하고, 이 테이블은
 * 관계의 역관계·추이성·허용 노드 종류를 선언한다. 따라서 기존 승인/리비전
 * 워크플로를 깨지 않고도 검색과 추론이 같은 의미 규칙을 공유할 수 있다.
 */
export const ontologyPredicates = pgTable(
  "ontology_predicates",
  {
    key: text("key").primaryKey(),
    label: text("label").notNull(),
    inverseKey: text("inverse_key"),
    symmetric: boolean("symmetric").notNull().default(false),
    transitive: boolean("transitive").notNull().default(false),
    sourceKind: ontologyNodeKindEnum("source_kind").notNull(),
    targetKind: ontologyNodeKindEnum("target_kind").notNull(),
    description: text("description"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    inverseKeyIdx: index("ontology_predicates_inverse_key_idx").on(t.inverseKey),
    orderIdx: index("ontology_predicates_order_idx").on(t.sortOrder, t.key),
    validKinds: check("ontology_predicates_valid_kinds", sql`
      (${t.key} in ('defines', 'applies_to') and ${t.sourceKind} = 'wiki_page' and ${t.targetKind} = 'term')
      or (${t.key} in ('defined_in', 'applied_in') and ${t.sourceKind} = 'term' and ${t.targetKind} = 'wiki_page')
      or (${t.key} not in ('defines', 'applies_to', 'defined_in', 'applied_in') and ${t.sourceKind} = 'term' and ${t.targetKind} = 'term')
    `),
  }),
);
