import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

/** 상태가 running으로 남은 호출은 프로세스 중단·타임아웃을 나타낼 수 있다. */
export const aiRunStatusEnum = pgEnum("ai_run_status", ["running", "succeeded", "failed", "cancelled"]);

/**
 * 외부 AI 호출 한 건의 운영 메타데이터만 저장한다. 프롬프트·응답 원문과
 * 인증 정보는 저장하지 않는다. 모델별 토큰·지연시간·실패율을 장기간 조회할
 * 수 있어야 공급자 장애와 비용 급증을 실제 데이터로 발견할 수 있다.
 */
export const aiRuns = pgTable(
  "ai_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    traceId: uuid("trace_id").notNull(),
    operation: text("operation").notNull(),
    provider: text("provider").notNull(),
    model: text("model").notNull(),
    status: aiRunStatusEnum("status").notNull().default("running"),
    attempts: integer("attempts").notNull().default(0),
    inputChars: integer("input_chars").notNull().default(0),
    outputChars: integer("output_chars").notNull().default(0),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    totalTokens: integer("total_tokens"),
    latencyMs: integer("latency_ms"),
    httpStatus: integer("http_status"),
    errorCode: text("error_code"),
    errorMessage: text("error_message"),
    metadata: jsonb("metadata").$type<Record<string, string | number | boolean | null>>().notNull().default(sql`'{}'::jsonb`),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    conversationId: uuid("conversation_id"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (t) => ({
    traceIdx: index("ai_runs_trace_idx").on(t.traceId),
    startedIdx: index("ai_runs_started_idx").on(t.startedAt),
    operationStartedIdx: index("ai_runs_operation_started_idx").on(t.operation, t.startedAt),
    statusStartedIdx: index("ai_runs_status_started_idx").on(t.status, t.startedAt),
    attemptsNonNegative: check("ai_runs_attempts_non_negative", sql`${t.attempts} >= 0`),
    inputCharsNonNegative: check("ai_runs_input_chars_non_negative", sql`${t.inputChars} >= 0`),
    outputCharsNonNegative: check("ai_runs_output_chars_non_negative", sql`${t.outputChars} >= 0`),
    inputTokensNonNegative: check("ai_runs_input_tokens_non_negative", sql`${t.inputTokens} is null or ${t.inputTokens} >= 0`),
    outputTokensNonNegative: check("ai_runs_output_tokens_non_negative", sql`${t.outputTokens} is null or ${t.outputTokens} >= 0`),
    totalTokensNonNegative: check("ai_runs_total_tokens_non_negative", sql`${t.totalTokens} is null or ${t.totalTokens} >= 0`),
    latencyNonNegative: check("ai_runs_latency_non_negative", sql`${t.latencyMs} is null or ${t.latencyMs} >= 0`),
    httpStatusRange: check("ai_runs_http_status_range", sql`${t.httpStatus} is null or ${t.httpStatus} between 100 and 599`),
  }),
);
