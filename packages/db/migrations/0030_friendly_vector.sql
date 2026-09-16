CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."rag_embedding_provider" AS ENUM('openai_compatible', 'gemini');--> statement-breakpoint
CREATE TYPE "public"."rag_reranker_provider" AS ENUM('cohere_compatible');--> statement-breakpoint
CREATE TYPE "public"."rag_index_job_status" AS ENUM('queued', 'processing', 'ready', 'failed');--> statement-breakpoint
CREATE TABLE "public"."rag_config" (
	"id" text PRIMARY KEY DEFAULT 'default' NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"embedding_provider" "rag_embedding_provider" DEFAULT 'openai_compatible' NOT NULL,
	"embedding_base_url" text DEFAULT 'https://api.openai.com/v1' NOT NULL,
	"embedding_model" text DEFAULT 'text-embedding-3-small' NOT NULL,
	"embedding_api_key_encrypted" text DEFAULT '' NOT NULL,
	"embedding_custom_headers_encrypted" text DEFAULT '' NOT NULL,
	"reranker_enabled" boolean DEFAULT false NOT NULL,
	"reranker_provider" "rag_reranker_provider" DEFAULT 'cohere_compatible' NOT NULL,
	"reranker_base_url" text DEFAULT 'https://api.cohere.com/v2' NOT NULL,
	"reranker_model" text DEFAULT 'rerank-v3.5' NOT NULL,
	"reranker_api_key_encrypted" text DEFAULT '' NOT NULL,
	"reranker_custom_headers_encrypted" text DEFAULT '' NOT NULL,
	"chunk_size" integer DEFAULT 1600 NOT NULL,
	"chunk_overlap" integer DEFAULT 240 NOT NULL,
	"top_k" integer DEFAULT 8 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_by" uuid
);
--> statement-breakpoint
ALTER TABLE "public"."rag_config" ADD CONSTRAINT "rag_config_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."rag_config" ADD CONSTRAINT "rag_config_single_row" CHECK ("rag_config"."id" = 'default');--> statement-breakpoint
ALTER TABLE "public"."rag_config" ADD CONSTRAINT "rag_config_chunk_size_range" CHECK ("rag_config"."chunk_size" between 400 and 8000);--> statement-breakpoint
ALTER TABLE "public"."rag_config" ADD CONSTRAINT "rag_config_chunk_overlap_range" CHECK ("rag_config"."chunk_overlap" between 0 and 2000);--> statement-breakpoint
ALTER TABLE "public"."rag_config" ADD CONSTRAINT "rag_config_top_k_range" CHECK ("rag_config"."top_k" between 1 and 50);--> statement-breakpoint
CREATE TABLE "public"."rag_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"term_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"source_field" text NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "public"."rag_documents" ADD CONSTRAINT "rag_documents_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."rag_documents" ADD CONSTRAINT "rag_documents_positive_revision" CHECK ("rag_documents"."revision" > 0);--> statement-breakpoint
ALTER TABLE "public"."rag_documents" ADD CONSTRAINT "rag_documents_non_negative_chunk" CHECK ("rag_documents"."chunk_index" >= 0);--> statement-breakpoint
CREATE TABLE "public"."rag_index_queue" (
	"term_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"status" "rag_index_job_status" DEFAULT 'queued' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text
);
--> statement-breakpoint
ALTER TABLE "public"."rag_index_queue" ADD CONSTRAINT "rag_index_queue_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "public"."rag_index_queue" ADD CONSTRAINT "rag_index_queue_positive_revision" CHECK ("rag_index_queue"."revision" > 0);--> statement-breakpoint
CREATE UNIQUE INDEX "rag_documents_term_revision_chunk_unique" ON "public"."rag_documents" USING btree ("term_id","revision","chunk_index");--> statement-breakpoint
CREATE INDEX "rag_documents_term_revision_idx" ON "public"."rag_documents" USING btree ("term_id","revision");--> statement-breakpoint
CREATE INDEX "rag_documents_embedding_hnsw_idx" ON "public"."rag_documents" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "rag_index_queue_status_requested_idx" ON "public"."rag_index_queue" USING btree ("status","requested_at");--> statement-breakpoint
