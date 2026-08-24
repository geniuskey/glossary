import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
// drizzle-kit 0.28.x의 CJS 로더가 "./terms.js"/"./auth.js"를 해석하지 못해
// "Cannot find module" 오류가 난다. schema/index.ts와 동일한 이유로 확장자를 생략한다.
import { terms } from "./terms";
import { users } from "./auth";

export const termRevisions = pgTable(
  "term_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
    revisionNumber: integer("revision_number").notNull(),
    snapshot: jsonb("snapshot").notNull(),
    message: text("message"),
    authorId: uuid("author_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    perTerm: uniqueIndex("term_revisions_unique").on(t.termId, t.revisionNumber),
    termIdx: index("term_revisions_term_idx").on(t.termId),
  }),
);
