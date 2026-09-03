import { boolean, check, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { users } from "./auth";

export const aiProviderEnum = pgEnum("ai_provider", ["gemini", "openai_compatible"]);

/**
 * 워크스페이스 공용 AI 연결 설정. API 키와 헤더 값은 애플리케이션에서
 * AES-256-GCM으로 암호화한 문자열만 저장하며 화면/API로는 다시 내보내지 않는다.
 */
export const aiConfig = pgTable(
  "ai_config",
  {
    id: text("id").primaryKey().default("default"),
    enabled: boolean("enabled").notNull().default(false),
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
