import { sql } from "drizzle-orm";
import { check, index, integer, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { terms } from "./terms";
import { users } from "./auth";

export const unregisteredCandidateStatusEnum = pgEnum("unregistered_candidate_status", [
  "open",
  "dismissed",
  "promoted",
]);
export type UnregisteredCandidateStatus = (typeof unregisteredCandidateStatusEnum.enumValues)[number];

/** 문서 검증에서 발견된 미등록 후보. 등록 전까지는 용어집의 검색 대상이 아니다. */
export const unregisteredCandidates = pgTable(
  "unregistered_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // normalizeSurface(...).loose. 표기 방식이 달라도 같은 후보로 합친다.
    normLoose: text("norm_loose").notNull(),
    text: text("text").notNull(),
    status: unregisteredCandidateStatusEnum("status").notNull().default("open"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    sampleContext: text("sample_context"),
    sourcePath: text("source_path"),
    lexiconVersion: text("lexicon_version"),
    promotedTermId: uuid("promoted_term_id").references(() => terms.id, { onDelete: "set null" }),
    reviewedBy: uuid("reviewed_by").references(() => users.id, { onDelete: "set null" }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    decisionNote: text("decision_note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    normLooseUnique: uniqueIndex("unregistered_candidates_norm_loose_unique").on(t.normLoose),
    statusIdx: index("unregistered_candidates_status_idx").on(t.status, t.lastSeenAt),
    occurrenceIdx: index("unregistered_candidates_occurrence_idx").on(t.occurrenceCount, t.lastSeenAt),
    occurrencePositive: check("unregistered_candidates_occurrence_positive", sql`${t.occurrenceCount} > 0`),
    textNotEmpty: check("unregistered_candidates_text_not_empty", sql`length(trim(${t.text})) > 0`),
  }),
);
