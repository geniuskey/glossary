import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";
import { users } from "./auth";
import { ragIndexJobStatusEnum, RAG_VECTOR_DIMENSIONS } from "./rag";

/** 회의록은 삭제 대신 보관해 과거 의사결정의 근거를 보존한다. */
export const meetingDocumentStatusEnum = pgEnum("meeting_document_status", [
  "active",
  "archived",
]);

/**
 * 사용자가 저장한 회의록 원문. revision은 내용이 바뀔 때마다 증가하며,
 * vector 청크는 항상 현재 revision만 검색된다.
 */
export const meetingDocuments = pgTable(
  "meeting_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    meetingDate: timestamp("meeting_date", { withTimezone: true }),
    source: text("source").notNull().default(""),
    team: text("team").notNull().default(""),
    domain: text("domain").array().notNull().default([]),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    revision: integer("revision").notNull().default(1),
    status: meetingDocumentStatusEnum("status").notNull().default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    statusDateIdx: index("meeting_documents_status_date_idx").on(t.status, t.meetingDate),
    updatedIdx: index("meeting_documents_updated_idx").on(t.updatedAt),
    domainIdx: index("meeting_documents_domain_idx").using("gin", t.domain),
    positiveRevision: check("meeting_documents_positive_revision", sql`${t.revision} > 0`),
  }),
);

/** 현재 회의록 revision의 검색용 immutable 청크. */
export const meetingRagDocuments = pgTable(
  "meeting_rag_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    meetingDocumentId: uuid("meeting_document_id").notNull().references(() => meetingDocuments.id, { onDelete: "cascade" }),
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
    documentRevisionChunkUnique: uniqueIndex("meeting_rag_documents_revision_chunk_unique").on(t.meetingDocumentId, t.revision, t.chunkIndex),
    documentRevisionIdx: index("meeting_rag_documents_document_revision_idx").on(t.meetingDocumentId, t.revision),
    embeddingHnswIdx: index("meeting_rag_documents_embedding_hnsw_idx").using("hnsw", sql`${t.embedding} vector_cosine_ops`),
    positiveRevision: check("meeting_rag_documents_positive_revision", sql`${t.revision} > 0`),
    nonNegativeChunk: check("meeting_rag_documents_non_negative_chunk", sql`${t.chunkIndex} >= 0`),
    validOffsets: check("meeting_rag_documents_valid_offsets", sql`${t.startOffset} >= 0 and ${t.endOffset} > ${t.startOffset}`),
  }),
);

/** 회의록 하나당 최신 revision을 가리키는 durable 색인 작업. */
export const meetingRagIndexQueue = pgTable(
  "meeting_rag_index_queue",
  {
    meetingDocumentId: uuid("meeting_document_id").primaryKey().references(() => meetingDocuments.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    status: ragIndexJobStatusEnum("status").notNull().default("queued"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (t) => ({
    statusRequestedIdx: index("meeting_rag_index_queue_status_requested_idx").on(t.status, t.requestedAt),
    positiveRevision: check("meeting_rag_index_queue_positive_revision", sql`${t.revision} > 0`),
  }),
);
