import { index, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { termComments } from "./comments";
import { terms } from "./terms";

export const notificationKindEnum = pgEnum("notification_kind", ["comment_mention", "comment_reply"]);

/**
 * 받는 사람 한 명당 한 행. 내용(본문 발췌, 작성자 이름)은 복사하지 않고 댓글을 조인해
 * 읽는다 — 복사해 두면 댓글을 고치거나 지운 뒤에도 알림에 옛 문장이 남는다.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    kind: notificationKindEnum("kind").notNull(),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    commentId: uuid("comment_id").notNull().references(() => termComments.id, { onDelete: "cascade" }),
    actorId: uuid("actor_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    readAt: timestamp("read_at", { withTimezone: true }),
  },
  (t) => ({
    // 댓글을 고칠 때마다 같은 멘션이 다시 알림으로 쌓이지 않게 한다.
    uniquePerComment: uniqueIndex("notifications_user_comment_kind_unique").on(t.userId, t.commentId, t.kind),
    inboxIdx: index("notifications_user_created_idx").on(t.userId, t.createdAt),
  }),
);
