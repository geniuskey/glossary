import { sql } from "drizzle-orm";
import {
  boolean,
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
import { terms } from "./terms";

/** Embedding APIs that return the OpenAI embeddings or Gemini embedContent shape. */
export const ragEmbeddingProviderEnum = pgEnum("rag_embedding_provider", [
  "openai_compatible",
  "gemini",
]);

/** Cohere v2/Jina-compatible rerank endpoints share the same request/response shape. */
export const ragRerankerProviderEnum = pgEnum("rag_reranker_provider", [
  "cohere_compatible",
]);

export const ragIndexJobStatusEnum = pgEnum("rag_index_job_status", [
  "queued",
  "processing",
  "ready",
  "failed",
]);

/**
 * The vector column is deliberately fixed at 1536 dimensions. It matches the
 * default OpenAI text-embedding-3-small output and Gemini can request the same
 * outputDimensionality. Keeping one dimension lets PostgreSQL use an HNSW
 * cosine index instead of silently mixing incompatible model outputs.
 */
export const RAG_VECTOR_DIMENSIONS = 1536 as const;

export const ragConfig = pgTable(
  "rag_config",
  {
    id: text("id").primaryKey().default("default"),
    enabled: boolean("enabled").notNull().default(false),
    chatEnabled: boolean("chat_enabled").notNull().default(false),
    embeddingProvider: ragEmbeddingProviderEnum("embedding_provider").notNull().default("openai_compatible"),
    embeddingBaseUrl: text("embedding_base_url").notNull().default("https://api.openai.com/v1"),
    embeddingModel: text("embedding_model").notNull().default("text-embedding-3-small"),
    embeddingApiKeyEncrypted: text("embedding_api_key_encrypted").notNull().default(""),
    embeddingCustomHeadersEncrypted: text("embedding_custom_headers_encrypted").notNull().default(""),
    rerankerEnabled: boolean("reranker_enabled").notNull().default(false),
    rerankerProvider: ragRerankerProviderEnum("reranker_provider").notNull().default("cohere_compatible"),
    rerankerBaseUrl: text("reranker_base_url").notNull().default("https://api.cohere.com/v2"),
    rerankerModel: text("reranker_model").notNull().default("rerank-v3.5"),
    rerankerApiKeyEncrypted: text("reranker_api_key_encrypted").notNull().default(""),
    rerankerCustomHeadersEncrypted: text("reranker_custom_headers_encrypted").notNull().default(""),
    chunkSize: integer("chunk_size").notNull().default(1_600),
    chunkOverlap: integer("chunk_overlap").notNull().default(240),
    topK: integer("top_k").notNull().default(8),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => ({
    singleRow: check("rag_config_single_row", sql`${t.id} = 'default'`),
    chunkSizeRange: check("rag_config_chunk_size_range", sql`${t.chunkSize} between 400 and 8_000`),
    chunkOverlapRange: check("rag_config_chunk_overlap_range", sql`${t.chunkOverlap} between 0 and 2_000`),
    topKRange: check("rag_config_top_k_range", sql`${t.topK} between 1 and 50`),
  }),
);

/**
 * One immutable snapshot chunk of a term revision. Old chunks are deleted when
 * a newer revision is indexed, so the table remains the queryable current index
 * while the term_revisions table remains the audit history.
 */
export const ragDocuments = pgTable(
  "rag_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    chunkIndex: integer("chunk_index").notNull(),
    sourceField: text("source_field").notNull(),
    content: text("content").notNull(),
    contentHash: text("content_hash").notNull(),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    embedding: vector("embedding", { dimensions: RAG_VECTOR_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    termRevisionChunkUnique: uniqueIndex("rag_documents_term_revision_chunk_unique").on(t.termId, t.revision, t.chunkIndex),
    termRevisionIdx: index("rag_documents_term_revision_idx").on(t.termId, t.revision),
    embeddingHnswIdx: index("rag_documents_embedding_hnsw_idx").using("hnsw", sql`${t.embedding} vector_cosine_ops`),
    positiveRevision: check("rag_documents_positive_revision", sql`${t.revision} > 0`),
    nonNegativeChunk: check("rag_documents_non_negative_chunk", sql`${t.chunkIndex} >= 0`),
  }),
);

/** Durable work queue. A term has at most one job, always for its latest requested revision. */
export const ragIndexQueue = pgTable(
  "rag_index_queue",
  {
    termId: uuid("term_id").primaryKey().references(() => terms.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    status: ragIndexJobStatusEnum("status").notNull().default("queued"),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (t) => ({
    statusRequestedIdx: index("rag_index_queue_status_requested_idx").on(t.status, t.requestedAt),
    positiveRevision: check("rag_index_queue_positive_revision", sql`${t.revision} > 0`),
  }),
);
