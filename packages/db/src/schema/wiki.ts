import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { apiKeys, users } from "./auth";
import { RAG_VECTOR_DIMENSIONS, ragIndexJobStatusEnum } from "./rag";
import { terms } from "./terms";

/** 위키는 초안과 공개 문서를 분리해, 검토 전 내용이 AI의 공식 근거가 되지 않게 한다. */
export const wikiPageStatusEnum = pgEnum("wiki_page_status", [
  "draft",
  "published",
  "archived",
]);

export const wikiPageTermRoleEnum = pgEnum("wiki_page_term_role", [
  "primary",
  "related",
]);

/** 용어를 설명하는 살아 있는 업무 문서. 회의록은 과거 근거이고 위키는 승인된 맥락이다. */
export const wikiPages = pgTable(
  "wiki_pages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    /** Confluence 등 원문을 관리하는 외부 출처. 위키 본문과 분리해 최신 원문을 추적한다. */
    sourceUrl: text("source_url"),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    domain: text("domain").array().notNull().default([]),
    revision: integer("revision").notNull().default(1),
    status: wikiPageStatusEnum("status").notNull().default("draft"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUnique: uniqueIndex("wiki_pages_slug_unique").on(t.slug),
    statusUpdatedIdx: index("wiki_pages_status_updated_idx").on(t.status, t.updatedAt),
    domainIdx: index("wiki_pages_domain_idx").using("gin", t.domain),
    positiveRevision: check("wiki_pages_positive_revision", sql`${t.revision} > 0`),
  }),
);

/** 페이지 편집 이력. 현재 본문은 wiki_pages, 감사 가능한 원본은 여기에 남긴다. */
export const wikiPageRevisions = pgTable(
  "wiki_page_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wikiPageId: uuid("wiki_page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    message: text("message"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    authorKeyId: uuid("author_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    perPage: uniqueIndex("wiki_page_revisions_unique").on(t.wikiPageId, t.revisionNumber),
    pageIdx: index("wiki_page_revisions_page_idx").on(t.wikiPageId),
  }),
);

/** 페이지와 용어를 명시적으로 연결해 용어 상세에서 관련 업무 맥락을 역탐색한다. */
export const wikiPageTerms = pgTable(
  "wiki_page_terms",
  {
    wikiPageId: uuid("wiki_page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    role: wikiPageTermRoleEnum("role").notNull().default("related"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    primary: primaryKey({ columns: [t.wikiPageId, t.termId] }),
    termIdx: index("wiki_page_terms_term_idx").on(t.termId),
    roleIdx: index("wiki_page_terms_role_idx").on(t.wikiPageId, t.role),
  }),
);

/** 공개된 현재 revision만 검색하는 위키 RAG 청크. */
export const wikiRagDocuments = pgTable(
  "wiki_rag_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    wikiPageId: uuid("wiki_page_id").notNull().references(() => wikiPages.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    startOffset: integer("start_offset").notNull(),
    endOffset: integer("end_offset").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    embedding: vector("embedding", { dimensions: RAG_VECTOR_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pageRevisionChunkUnique: uniqueIndex("wiki_rag_documents_revision_chunk_unique").on(t.wikiPageId, t.revision, t.chunkIndex),
    pageRevisionIdx: index("wiki_rag_documents_page_revision_idx").on(t.wikiPageId, t.revision),
    embeddingHnswIdx: index("wiki_rag_documents_embedding_hnsw_idx").using("hnsw", sql`${t.embedding} vector_cosine_ops`),
    positiveRevision: check("wiki_rag_documents_positive_revision", sql`${t.revision} > 0`),
    nonNegativeChunk: check("wiki_rag_documents_non_negative_chunk", sql`${t.chunkIndex} >= 0`),
    validOffsets: check("wiki_rag_documents_valid_offsets", sql`${t.startOffset} >= 0 and ${t.endOffset} > ${t.startOffset}`),
  }),
);

/** 위키 페이지 하나당 최신 revision을 가리키는 내구성 있는 색인 작업. */
export const wikiRagIndexQueue = pgTable(
  "wiki_rag_index_queue",
  {
    wikiPageId: uuid("wiki_page_id").primaryKey().references(() => wikiPages.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    status: ragIndexJobStatusEnum("status").notNull().default("queued"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (t) => ({
    statusRequestedIdx: index("wiki_rag_index_queue_status_requested_idx").on(t.status, t.requestedAt),
    positiveRevision: check("wiki_rag_index_queue_positive_revision", sql`${t.revision} > 0`),
  }),
);
