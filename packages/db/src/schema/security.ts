import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { apiKeys, users } from "./auth";

/** 관리자·콘텐츠 변경과 인증 이벤트를 추적하는 감사 로그. */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    action: text("action").notNull(),
    targetType: text("target_type").notNull(),
    targetId: text("target_id"),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    actorKeyId: uuid("actor_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("audit_events_created_idx").on(t.createdAt),
    actionCreatedIdx: index("audit_events_action_created_idx").on(t.action, t.createdAt),
    actorUserCreatedIdx: index("audit_events_actor_user_created_idx").on(t.actorUserId, t.createdAt),
    targetIdx: index("audit_events_target_idx").on(t.targetType, t.targetId),
  }),
);

/** 여러 앱 인스턴스가 공유하는 짧은 시간 창 레이트 리밋 버킷. */
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    key: text("key").primaryKey(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    updatedIdx: index("rate_limit_buckets_updated_idx").on(t.updatedAt),
  }),
);
