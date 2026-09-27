import { sql } from "drizzle-orm";
import { check, index, integer, jsonb, pgEnum, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { users } from "./auth";

export const syncBundleModeEnum = pgEnum("sync_bundle_mode", ["full", "incremental"]);

export const syncEntityTypeEnum = pgEnum("sync_entity_type", [
  "term", "wiki_page", "relation", "domain", "business_category",
]);

/**
 * 설치 단위 식별자. 번들이 어느 서버에서 왔는지 가려야 받는 쪽이 출처별 추적 기록을
 * 나누고, 자기 자신이 만든 번들을 다시 들이는 실수를 막을 수 있다.
 */
export const syncInstance = pgTable(
  "sync_instance",
  {
    id: text("id").primaryKey().default("default"),
    instanceId: uuid("instance_id").notNull().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    singleRow: check("sync_instance_single_row", sql`${t.id} = 'default'`),
  }),
);

/**
 * 보내는 쪽이 만든 번들의 전체 목록(manifest). 변경분 번들은 기준 번들의 manifest와
 * 현재 해시를 비교해 달라진 항목만 싣는다 — 타임스탬프 기준이면 리비전·updatedAt을
 * 남기지 않는 쓰기(분류 삭제 시 배열 정리 등)를 조용히 놓친다.
 */
export const syncExports = pgTable(
  "sync_exports",
  {
    id: uuid("id").primaryKey(),
    mode: syncBundleModeEnum("mode").notNull(),
    baseExportId: uuid("base_export_id"),
    manifest: jsonb("manifest").notNull(),
    counts: jsonb("counts").$type<Record<string, number>>().notNull(),
    byteSize: integer("byte_size"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    createdIdx: index("sync_exports_created_idx").on(t.createdAt),
  }),
);

/** 받는 쪽이 출처 서버별로 마지막에 적용한 번들. 오래된 번들이 최신 상태를 되돌리지 못하게 한다. */
export const syncSources = pgTable("sync_sources", {
  instanceId: uuid("instance_id").primaryKey(),
  label: text("label").notNull(),
  lastBundleId: uuid("last_bundle_id").notNull(),
  lastExportedAt: timestamp("last_exported_at", { withTimezone: true }).notNull(),
  lastImportedAt: timestamp("last_imported_at", { withTimezone: true }).notNull().defaultNow(),
  lastReport: jsonb("last_report").notNull(),
});

/**
 * 받는 쪽에서 동기화로 들어온 항목. contentHash로 변경 여부를, localRevision으로
 * "마지막 동기화 이후 이 서버에서 누가 고쳤는가"를 판정한다. 여기에 없는 항목은
 * 이 서버에서 직접 만든 것이라 출처 삭제에 끌려 지워지지 않는다.
 */
export const syncEntities = pgTable(
  "sync_entities",
  {
    sourceInstanceId: uuid("source_instance_id").notNull().references(() => syncSources.instanceId, { onDelete: "cascade" }),
    entityType: syncEntityTypeEnum("entity_type").notNull(),
    entityId: text("entity_id").notNull(),
    contentHash: text("content_hash").notNull(),
    localRevision: integer("local_revision"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    primary: primaryKey({ columns: [t.sourceInstanceId, t.entityType, t.entityId] }),
    entityIdx: index("sync_entities_entity_idx").on(t.entityType, t.entityId),
  }),
);
