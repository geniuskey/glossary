import { sql } from "drizzle-orm";
import { check, index, pgTable, text, timestamp, uuid, type AnyPgColumn } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { terms } from "./terms";

/**
 * 용어 하나에 달리는 토론. 용어 본문과 달리 리비전을 남기지 않는다 — 댓글은 개념의
 * 상태가 아니라 그 개념을 두고 나눈 대화라, term_revisions에 섞이면 "이 리비전에서
 * 무엇이 바뀌었는가"가 흐려진다.
 */
export const termComments = pgTable(
  "term_comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => termComments.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    // 멘션은 본문 안에 `@[이름](user:<uuid>)`로 남는다. 아래 배열은 본문에서 뽑아
    // 존재를 확인한 사용자만 담는 색인이다 — "나를 언급한 댓글"을 본문 LIKE로 찾지 않게.
    body: text("body").notNull(),
    mentionedUserIds: uuid("mentioned_user_ids").array().notNull().default(sql`'{}'::uuid[]`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    // 답글이 달린 댓글을 지우면 답글까지 맥락을 잃는다. 행은 남기고 본문만 비운다.
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    termIdx: index("term_comments_term_idx").on(t.termId, t.createdAt),
    parentIdx: index("term_comments_parent_idx").on(t.parentId),
    mentionIdx: index("term_comments_mentions_idx").using("gin", t.mentionedUserIds),
    notSelfParent: check("term_comments_not_self_parent", sql`${t.parentId} is null or ${t.parentId} <> ${t.id}`),
  }),
);
