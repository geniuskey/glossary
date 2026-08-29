import { sql } from "drizzle-orm";
import {
  boolean, index, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid,
} from "drizzle-orm/pg-core";

export const termTypeEnum = pgEnum("term_type", [
  "term", "abbreviation", "project", "product_id", "code", "unit",
]);

// R130: 원래 draft|approved|deprecated|forbidden 4값이었다. 승인 축(draft↔approved)은
// 승인 주체·권한·효과가 어디에도 없어서 배지 색과 필터 파셋 말고는 아무것도 바꾸지
// 못했고, 로그인한 사람이면 누구나 자기 글을 approved로 올릴 수 있는 개방 편집에서는
// 라벨이 곧 소음이 된다(엑셀의 "확정" 열이 죽던 방식). status는 "이 용어를 문서에서
// 써도 되는가" 한 축만 남긴다 — 로드맵 M2의 린트 규칙(deprecated→replaced_by 제시,
// forbidden→error)과 1:1로 대응하는 값들이다. 기존 draft/approved 행은
// 마이그레이션 0003에서 전부 active로 접었다.
export const termStatusEnum = pgEnum("term_status", [
  "active", "deprecated", "forbidden",
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
    status: termStatusEnum("status").notNull().default("active"),
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
