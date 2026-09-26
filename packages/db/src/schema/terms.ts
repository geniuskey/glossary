import { sql } from "drizzle-orm";
import {
  boolean, check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const termQualityProfileEnum = pgEnum("term_quality_profile", [
  "auto", "mapping", "context", "guidance",
]);

export const domains = pgTable(
  "domains",
  {
    key: text("key").primaryKey(),
    label: text("label").notNull(),
    labelEn: text("label_en"),
    color: text("color").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    labelUnique: uniqueIndex("domains_label_unique").on(t.label),
    labelEnUnique: uniqueIndex("domains_label_en_unique").on(t.labelEn),
    colorUnique: uniqueIndex("domains_color_unique").on(t.color),
    orderIdx: index("domains_order_idx").on(t.sortOrder, t.key),
  }),
);

export const businessCategories = pgTable(
  "business_categories",
  {
    key: text("key").primaryKey(),
    label: text("label").notNull(),
    labelEn: text("label_en"),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    labelUnique: uniqueIndex("business_categories_label_unique").on(t.label),
    labelEnUnique: uniqueIndex("business_categories_label_en_unique").on(t.labelEn),
    orderIdx: index("business_categories_order_idx").on(t.sortOrder, t.key),
  }),
);

// draft/active는 사용자 워크플로가 아니라 용어 정리 기준의 자동 판정 캐시다.
// 쓰기 서비스가 termCompletion 결과에 따라 값을 정하며 사용자가 직접 바꾸지 않는다.
export const termStatusEnum = pgEnum("term_status", [
  "draft", "active",
]);

export const surfaceKindEnum = pgEnum("surface_kind", [
  "canonical", "abbreviation", "full_name", "alias", "discouraged", "forbidden",
]);

export const surfaceLangEnum = pgEnum("surface_lang", ["en", "ko", "neutral"]);

export const termRelationTypeEnum = pgEnum("term_relation_type", [
  "related_to", "is_a", "part_of", "used_in", "prerequisite_of", "replaces",
]);

export const termRelationStatusEnum = pgEnum("term_relation_status", [
  "proposed", "approved", "rejected",
]);

export const terms = pgTable(
  "terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    qualityProfile: termQualityProfileEnum("quality_profile").notNull().default("auto"),
    nameEn: text("name_en"),
    nameKo: text("name_ko"),
    fullNameEn: text("full_name_en"),
    fullNameKo: text("full_name_ko"),
    domain: text("domain").array().notNull().default([]),
    // 도메인처럼 하나의 용어가 여러 업무 분류에 걸칠 수 있다. 카탈로그 존재
    // 여부는 쓰기 API에서 검증하고, 분류 삭제 시 연결 배열에서도 함께 제거한다.
    category: text("category").array().notNull().default([]),
    // 기존 API의 단일 주제 필드는 첫 태그를 담아 호환성을 유지한다.
    topic: text("topic"),
    // 용어별 자유 입력 태그. 기존 주제 값은 마이그레이션에서 첫 태그로 옮긴다.
    tags: text("tags").array().notNull().default([]),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "set null" }),
    status: termStatusEnum("status").notNull().default("draft"),
    definitionMd: text("definition_md"),
    bodyMd: text("body_md"),
    replacedById: uuid("replaced_by_id"),
    createdBy: uuid("created_by"),
    updatedBy: uuid("updated_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex("terms_slug_unique").on(t.slug),
    statusIdx: index("terms_status_idx").on(t.status),
    categoryIdx: index("terms_category_idx").using("gin", t.category),
    topicIdx: index("terms_topic_idx").on(t.topic),
    tagsIdx: index("terms_tags_idx").using("gin", t.tags),
    ownerIdx: index("terms_owner_idx").on(t.ownerId),
  }),
);

export const termSurfaces = pgTable(
  "term_surfaces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    lang: surfaceLangEnum("lang").notNull().default("neutral"),
    kind: surfaceKindEnum("kind").notNull().default("alias"),
    caseSensitive: boolean("case_sensitive").notNull().default(false),
    normLoose: text("norm_loose").notNull(),
    normSpace: text("norm_space").notNull(),
  },
  (t) => ({
    looseIdx: index("term_surfaces_norm_loose_idx").on(t.normLoose),
    spaceIdx: index("term_surfaces_norm_space_idx").on(t.normSpace),
    looseTrgm: index("term_surfaces_norm_loose_trgm")
      .using("gin", sql`${t.normLoose} gin_trgm_ops`),
    termIdx: index("term_surfaces_term_idx").on(t.termId),
    uniquePerTerm: uniqueIndex("term_surfaces_unique").on(t.termId, t.normLoose, t.kind),
  }),
);

// slug는 사람이 고칠 수 있고, 약어 slug를 풀네임으로 옮기는 정리도 한다. 옛 slug를
// 남기지 않으면 바깥에 퍼진 `/g/<옛 slug>` 링크가 조용히 404가 된다. 여기 남은 slug는
// 새 용어의 자동 slug로도 재사용하지 않는다 — 재사용하면 옛 링크가 엉뚱한 개념으로 간다.
export const termSlugAliases = pgTable(
  "term_slug_aliases",
  {
    slug: text("slug").primaryKey(),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    termIdx: index("term_slug_aliases_term_idx").on(t.termId),
  }),
);

/** AI는 proposed만 만들고, 검색 그래프에는 사람이 승인한 관계만 들어간다. */
export const termRelations = pgTable(
  "term_relations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceTermId: uuid("source_term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    targetTermId: uuid("target_term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    relationType: termRelationTypeEnum("relation_type").notNull(),
    status: termRelationStatusEnum("status").notNull().default("proposed"),
    confidence: integer("confidence").notNull().default(100),
    evidenceMd: text("evidence_md"),
    sourceRevision: integer("source_revision"),
    targetRevision: integer("target_revision"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
  },
  (t) => ({
    uniqueRelation: uniqueIndex("term_relations_unique").on(t.sourceTermId, t.targetTermId, t.relationType),
    sourceIdx: index("term_relations_source_idx").on(t.sourceTermId, t.status),
    targetIdx: index("term_relations_target_idx").on(t.targetTermId, t.status),
    distinctTerms: check("term_relations_distinct_terms", sql`${t.sourceTermId} <> ${t.targetTermId}`),
    confidenceRange: check("term_relations_confidence_range", sql`${t.confidence} between 0 and 100`),
    positiveSourceRevision: check("term_relations_positive_source_revision", sql`${t.sourceRevision} is null or ${t.sourceRevision} > 0`),
    positiveTargetRevision: check("term_relations_positive_target_revision", sql`${t.targetRevision} is null or ${t.targetRevision} > 0`),
  }),
);
