CREATE TYPE "public"."meeting_document_status" AS ENUM('active', 'archived');--> statement-breakpoint
CREATE TABLE "meeting_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"meeting_date" timestamp with time zone,
	"source" text DEFAULT '' NOT NULL,
	"team" text DEFAULT '' NOT NULL,
	"domain" text[] DEFAULT '{}' NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"revision" integer DEFAULT 1 NOT NULL,
	"status" "meeting_document_status" DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_documents_positive_revision" CHECK ("meeting_documents"."revision" > 0)
);
--> statement-breakpoint
CREATE TABLE "meeting_rag_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"meeting_document_id" uuid NOT NULL,
	"revision" integer NOT NULL,
	"chunk_index" integer NOT NULL,
	"start_offset" integer NOT NULL,
	"end_offset" integer NOT NULL,
	"content" text NOT NULL,
	"content_hash" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "meeting_rag_documents_positive_revision" CHECK ("meeting_rag_documents"."revision" > 0),
	CONSTRAINT "meeting_rag_documents_non_negative_chunk" CHECK ("meeting_rag_documents"."chunk_index" >= 0),
	CONSTRAINT "meeting_rag_documents_valid_offsets" CHECK ("meeting_rag_documents"."start_offset" >= 0 and "meeting_rag_documents"."end_offset" > "meeting_rag_documents"."start_offset")
);
--> statement-breakpoint
CREATE TABLE "meeting_rag_index_queue" (
	"meeting_document_id" uuid PRIMARY KEY NOT NULL,
	"revision" integer NOT NULL,
	"status" "rag_index_job_status" DEFAULT 'queued' NOT NULL,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"error_message" text,
	CONSTRAINT "meeting_rag_index_queue_positive_revision" CHECK ("meeting_rag_index_queue"."revision" > 0)
);
--> statement-breakpoint
ALTER TABLE "meeting_documents" ADD CONSTRAINT "meeting_documents_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_rag_documents" ADD CONSTRAINT "meeting_rag_documents_meeting_document_id_meeting_documents_id_fk" FOREIGN KEY ("meeting_document_id") REFERENCES "public"."meeting_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "meeting_rag_index_queue" ADD CONSTRAINT "meeting_rag_index_queue_meeting_document_id_meeting_documents_id_fk" FOREIGN KEY ("meeting_document_id") REFERENCES "public"."meeting_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "meeting_documents_status_date_idx" ON "meeting_documents" USING btree ("status","meeting_date");--> statement-breakpoint
CREATE INDEX "meeting_documents_updated_idx" ON "meeting_documents" USING btree ("updated_at");--> statement-breakpoint
CREATE INDEX "meeting_documents_domain_idx" ON "meeting_documents" USING gin ("domain");--> statement-breakpoint
CREATE UNIQUE INDEX "meeting_rag_documents_revision_chunk_unique" ON "meeting_rag_documents" USING btree ("meeting_document_id","revision","chunk_index");--> statement-breakpoint
CREATE INDEX "meeting_rag_documents_document_revision_idx" ON "meeting_rag_documents" USING btree ("meeting_document_id","revision");--> statement-breakpoint
CREATE INDEX "meeting_rag_documents_embedding_hnsw_idx" ON "meeting_rag_documents" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "meeting_rag_index_queue_status_requested_idx" ON "meeting_rag_index_queue" USING btree ("status","requested_at");