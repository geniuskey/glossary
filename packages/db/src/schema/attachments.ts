import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid, customType } from "drizzle-orm/pg-core";
import { users } from "./auth";
import { terms } from "./terms";

const bytea = customType<{ data: Buffer; driverData: Buffer }>({
  dataType() {
    return "bytea";
  },
});

/** 변환이 끝난 이미지 실체. sha256은 저장된 WebP 바이트를 기준으로 한다. */
export const attachments = pgTable(
  "attachments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sha256: text("sha256").notNull(),
    data: bytea("data").notNull(),
    storedMime: text("stored_mime").notNull(),
    byteSize: integer("byte_size").notNull(),
    width: integer("width").notNull(),
    height: integer("height").notNull(),
    originalFilename: text("original_filename").notNull(),
    originalMime: text("original_mime").notNull(),
    originalBytes: integer("original_bytes").notNull(),
    uploadedBy: uuid("uploaded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    shaUnique: uniqueIndex("attachments_sha256_unique").on(t.sha256),
  }),
);

/** 현재 본문에서 사용 중인 첨부. 이미지 실체는 이력이 참조할 수 있어 자동 삭제하지 않는다. */
export const attachmentRefs = pgTable(
  "attachment_refs",
  {
    attachmentId: uuid("attachment_id").notNull().references(() => attachments.id, { onDelete: "cascade" }),
    termId: uuid("term_id").notNull().references(() => terms.id, { onDelete: "cascade" }),
  },
  (t) => ({
    uniqueRef: uniqueIndex("attachment_refs_unique").on(t.attachmentId, t.termId),
    termIdx: index("attachment_refs_term_idx").on(t.termId),
  }),
);
