import { boolean, check, index, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";
import { terms } from "./terms";

export const aiProviderEnum = pgEnum("ai_provider", ["gemini", "openai_compatible"]);
export const aiReviewQueueStatusEnum = pgEnum("ai_review_queue_status", ["queued", "processing", "ready", "failed"]);
export const aiReviewRequestModeEnum = pgEnum("ai_review_request_mode", ["automatic", "manual"]);

/**
 * 워크스페이스 공용 AI 연결 설정. API 키와 헤더 값은 애플리케이션에서
 * AES-256-GCM으로 암호화한 문자열만 저장하며 화면/API로는 다시 내보내지 않는다.
 */
export const aiConfig = pgTable(
  "ai_config",
  {
    id: text("id").primaryKey().default("default"),
    enabled: boolean("enabled").notNull().default(false),
    autoReviewEnabled: boolean("auto_review_enabled").notNull().default(false),
    provider: aiProviderEnum("provider").notNull().default("gemini"),
    baseUrl: text("base_url").notNull().default("https://generativelanguage.googleapis.com/v1beta"),
    model: text("model").notNull().default("gemini-3.6-flash"),
    apiKeyEncrypted: text("api_key_encrypted").notNull().default(""),
    customHeadersEncrypted: text("custom_headers_encrypted").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
  },
  (t) => ({ singleRow: check("ai_config_single_row", sql`${t.id} = 'default'`) }),
);

/** 현재 용어 리비전에 대해 미리 생성한 검토 제안. 리비전이 바뀌면 자동으로 오래된 캐시가 된다. */
export const aiReviewSuggestions = pgTable(
  "ai_review_suggestions",
  {
    termId: uuid("term_id").primaryKey().references(() => terms.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    generatorVersion: integer("generator_version").notNull().default(1),
    suggestions: jsonb("suggestions").$type<unknown>().notNull().default(sql`'[]'::jsonb`),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ positiveRevision: check("ai_review_suggestions_positive_revision", sql`${t.revision} > 0`) }),
);

/** 자동·수동 AI 검토 요청의 현재 상태. 용어마다 최신 리비전 한 건만 관리한다. */
export const aiReviewQueue = pgTable(
  "ai_review_queue",
  {
    termId: uuid("term_id").primaryKey().references(() => terms.id, { onDelete: "cascade" }),
    revision: integer("revision").notNull(),
    status: aiReviewQueueStatusEnum("status").notNull().default("queued"),
    requestMode: aiReviewRequestModeEnum("request_mode").notNull().default("automatic"),
    requestedBy: uuid("requested_by").references(() => users.id, { onDelete: "set null" }),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    errorMessage: text("error_message"),
  },
  (t) => ({
    statusRequestedIdx: index("ai_review_queue_status_requested_idx").on(t.status, t.requestedAt),
    positiveRevision: check("ai_review_queue_positive_revision", sql`${t.revision} > 0`),
  }),
);
