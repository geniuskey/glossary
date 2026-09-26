import { jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const termBatchReceipts = pgTable("term_batch_receipts", {
  actor: text("actor").notNull(),
  batchKey: text("batch_key").notNull(),
  rowKey: text("row_key").notNull(),
  payloadHash: text("payload_hash").notNull(),
  result: jsonb("result").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  pk: primaryKey({ columns: [t.actor, t.batchKey, t.rowKey], name: "term_batch_receipts_pk" }),
}));
