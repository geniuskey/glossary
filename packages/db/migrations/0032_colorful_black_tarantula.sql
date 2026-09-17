CREATE TYPE "public"."ai_run_status" AS ENUM('running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "ai_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trace_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"status" "ai_run_status" DEFAULT 'running' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"input_chars" integer DEFAULT 0 NOT NULL,
	"output_chars" integer DEFAULT 0 NOT NULL,
	"input_tokens" integer,
	"output_tokens" integer,
	"total_tokens" integer,
	"latency_ms" integer,
	"http_status" integer,
	"error_code" text,
	"error_message" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"actor_id" uuid,
	"conversation_id" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone,
	CONSTRAINT "ai_runs_attempts_non_negative" CHECK ("ai_runs"."attempts" >= 0),
	CONSTRAINT "ai_runs_input_chars_non_negative" CHECK ("ai_runs"."input_chars" >= 0),
	CONSTRAINT "ai_runs_output_chars_non_negative" CHECK ("ai_runs"."output_chars" >= 0),
	CONSTRAINT "ai_runs_input_tokens_non_negative" CHECK ("ai_runs"."input_tokens" is null or "ai_runs"."input_tokens" >= 0),
	CONSTRAINT "ai_runs_output_tokens_non_negative" CHECK ("ai_runs"."output_tokens" is null or "ai_runs"."output_tokens" >= 0),
	CONSTRAINT "ai_runs_total_tokens_non_negative" CHECK ("ai_runs"."total_tokens" is null or "ai_runs"."total_tokens" >= 0),
	CONSTRAINT "ai_runs_latency_non_negative" CHECK ("ai_runs"."latency_ms" is null or "ai_runs"."latency_ms" >= 0),
	CONSTRAINT "ai_runs_http_status_range" CHECK ("ai_runs"."http_status" is null or "ai_runs"."http_status" between 100 and 599)
);
--> statement-breakpoint
ALTER TABLE "ai_runs" ADD CONSTRAINT "ai_runs_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_runs_trace_idx" ON "ai_runs" USING btree ("trace_id");--> statement-breakpoint
CREATE INDEX "ai_runs_started_idx" ON "ai_runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "ai_runs_operation_started_idx" ON "ai_runs" USING btree ("operation","started_at");--> statement-breakpoint
CREATE INDEX "ai_runs_status_started_idx" ON "ai_runs" USING btree ("status","started_at");