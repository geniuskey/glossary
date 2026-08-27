import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
// drizzle-kit 0.28.x의 CJS 로더가 "./terms.js"/"./auth.js"를 해석하지 못해
// "Cannot find module" 오류가 난다. schema/index.ts와 동일한 이유로 확장자를 생략한다.
import { terms } from "./terms";
import { apiKeys, users } from "./auth";

export const termRevisions = pgTable(
  "term_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    message: text("message"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    // R47: API 키로 만든 리비전은 authorId가 항상 null이라 누가 썼는지 구분할
    // 수 없었다. 나중에 채울 수 없는 값이라(과거 리비전의 실제 작성 키를 복원할
    // 방법이 없음) 지금 추가한다.
    authorKeyId: uuid("author_key_id").references(() => apiKeys.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    perTerm: uniqueIndex("term_revisions_unique").on(t.termId, t.revisionNumber),
    termIdx: index("term_revisions_term_idx").on(t.termId),
  }),
);
