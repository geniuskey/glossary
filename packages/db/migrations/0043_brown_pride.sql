CREATE TYPE "public"."wiki_page_status" AS ENUM('draft', 'published', 'archived');--> statement-breakpoint
CREATE TYPE "public"."wiki_page_term_role" AS ENUM('primary', 'related');--> statement-breakpoint
CREATE TABLE "wiki_page_revisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_page_id" uuid NOT NULL,
	"revision_number" integer NOT NULL,
	"snapshot" jsonb NOT NULL,
	"message" text,
	"author_id" uuid,
	"author_key_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "wiki_page_terms" (
	"wiki_page_id" uuid NOT NULL,
	"term_id" uuid NOT NULL,
	"role" "wiki_page_term_role" DEFAULT 'related' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_page_terms_wiki_page_id_term_id_pk" PRIMARY KEY("wiki_page_id","term_id")
);
--> statement-breakpoint
CREATE TABLE "wiki_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"domain" text[] DEFAULT '{}' NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" "wiki_page_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_pages_positive_revision" CHECK ("wiki_pages"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "wiki_rag_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"wiki_page_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "wiki_rag_documents_positive_revision" CHECK ("wiki_rag_documents"."revision" > 0),
	CONSTRAINT "wiki_rag_documents_non_negative_chunk" CHECK ("wiki_rag_documents"."chunk_index" >= 0),
	CONSTRAINT "wiki_rag_documents_valid_offsets" CHECK ("wiki_rag_documents"."start_offset" >= 0 and "wiki_rag_documents"."end_offset" > "wiki_rag_documents"."start_offset")
);
--> statement-breakpoint
CREATE TABLE "wiki_rag_index_queue" (
	"wiki_page_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"status" "rag_index_job_status" DEFAULT 'queued' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text,
	CONSTRAINT "wiki_rag_index_queue_positive_revision" CHECK ("wiki_rag_index_queue"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "wiki_page_revisions" ADD CONSTRAINT "wiki_page_revisions_wiki_page_id_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revisions" ADD CONSTRAINT "wiki_page_revisions_author_id_users_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_revisions" ADD CONSTRAINT "wiki_page_revisions_author_key_id_api_keys_id_fk" FOREIGN KEY ("author_key_id") REFERENCES "public"."api_keys"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_terms" ADD CONSTRAINT "wiki_page_terms_wiki_page_id_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_page_terms" ADD CONSTRAINT "wiki_page_terms_term_id_terms_id_fk" FOREIGN KEY ("term_id") REFERENCES "public"."terms"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_rag_documents" ADD CONSTRAINT "wiki_rag_documents_wiki_page_id_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "wiki_rag_index_queue" ADD CONSTRAINT "wiki_rag_index_queue_wiki_page_id_wiki_pages_id_fk" FOREIGN KEY ("wiki_page_id") REFERENCES "public"."wiki_pages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_page_revisions_unique" ON "wiki_page_revisions" USING btree ("wiki_page_id","revision_number");--> statement-breakpoint
CREATE INDEX "wiki_page_revisions_page_idx" ON "wiki_page_revisions" USING btree ("wiki_page_id");--> statement-breakpoint
CREATE INDEX "wiki_page_terms_term_idx" ON "wiki_page_terms" USING btree ("term_id");--> statement-breakpoint
CREATE INDEX "wiki_page_terms_role_idx" ON "wiki_page_terms" USING btree ("wiki_page_id","role");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_pages_slug_unique" ON "wiki_pages" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "wiki_pages_status_updated_idx" ON "wiki_pages" USING btree ("status","updated_at");--> statement-breakpoint
CREATE INDEX "wiki_pages_domain_idx" ON "wiki_pages" USING gin ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "wiki_rag_documents_revision_chunk_unique" ON "wiki_rag_documents" USING btree ("wiki_page_id","revision","chunk_index");--> statement-breakpoint
CREATE INDEX "wiki_rag_documents_page_revision_idx" ON "wiki_rag_documents" USING btree ("wiki_page_id","revision");--> statement-breakpoint
CREATE INDEX "wiki_rag_documents_embedding_hnsw_idx" ON "wiki_rag_documents" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "wiki_rag_index_queue_status_requested_idx" ON "wiki_rag_index_queue" USING btree ("status","requested_at");