import { sql } from "drizzle-orm";
import {
  boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";
import { users } from "./auth";

export const termTypeEnum = pgEnum("term_type", [
  "term", "abbreviation", "project", "product_id", "code", "unit",
]);

// draft는 협업 중인 초안이며 기본 검색·추천·AI 조회에는 노출하지 않는다.
// active는 팀이 찾아보고 실제 문서에서 사용할 수 있는 공개 상태다. 완성도는
// 별도 규칙(termCompletion)으로 계산하며, 필드가 다 찼다는 이유만으로 자동 공개하지
// 않는다. deprecated/forbidden은 공개된 용어의 사용 정책을 표현한다.
export const termStatusEnum = pgEnum("term_status", [
  "draft", "active", "deprecated", "forbidden",
]);

export const surfaceKindEnum = pgEnum("surface_kind", [
  "canonical", "abbreviation", "full_name", "alias", "discouraged", "forbidden",
]);

export const surfaceLangEnum = pgEnum("surface_lang", ["en", "ko", "neutral"]);

export const terms = pgTable(
  "terms",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    termType: termTypeEnum("term_type").notNull().default("term"),
    nameEn: text("name_en"),
    nameKo: text("name_ko"),
    fullNameEn: text("full_name_en"),
    fullNameKo: text("full_name_ko"),
    domain: text("domain").array().notNull().default([]),
    category: text("category"),
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
    categoryIdx: index("terms_category_idx").on(t.category),
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
