import { desc, eq, sql } from "drizzle-orm";
import { syncEntities, syncExports, syncSources } from "@glossary/db";
import { getDb } from "@/lib/db";
import { defaultSyncLabel, getInstanceId } from "./export";
import type { SyncImportReport } from "./import";

export interface SyncExportSummary {
  id: string;
  mode: "full" | "incremental";
  baseExportId: string | null;
  counts: Record<string, number>;
  byteSize: number | null;
  createdAt: string;
}

export interface SyncSourceSummary {
  instanceId: string;
  label: string;
  lastBundleId: string;
  lastExportedAt: string;
  lastImportedAt: string;
  trackedCount: number;
  lastReport: SyncImportReport | null;
}

export interface SyncStatus {
  instanceId: string;
  label: string;
  exports: SyncExportSummary[];
  sources: SyncSourceSummary[];
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const db = getDb();
  const [instanceId, exportRows, sourceRows] = await Promise.all([
    getInstanceId(db),
    db.select({
      id: syncExports.id,
      mode: syncExports.mode,
      baseExportId: syncExports.baseExportId,
      counts: syncExports.counts,
      byteSize: syncExports.byteSize,
      createdAt: syncExports.createdAt,
    }).from(syncExports).orderBy(desc(syncExports.createdAt)).limit(10),
    db.select({
      source: syncSources,
      trackedCount: sql<number>`(select count(*)::int from ${syncEntities} where ${syncEntities.sourceInstanceId} = ${syncSources.instanceId})`,
    }).from(syncSources).orderBy(desc(syncSources.lastImportedAt)),
  ]);
  return {
    instanceId,
    label: defaultSyncLabel(),
    exports: exportRows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
    sources: sourceRows.map(({ source, trackedCount }) => ({
      instanceId: source.instanceId,
      label: source.label,
      lastBundleId: source.lastBundleId,
      lastExportedAt: source.lastExportedAt.toISOString(),
      lastImportedAt: source.lastImportedAt.toISOString(),
      trackedCount,
      lastReport: Object.keys(source.lastReport as object).length ? source.lastReport as SyncImportReport : null,
    })),
  };
}

/** 출처 서버와의 연결을 끊는다. 이미 들어온 데이터는 남고, 이후로는 이 서버의 데이터로 취급된다. */
export async function forgetSyncSource(instanceId: string): Promise<boolean> {
  const deleted = await getDb().delete(syncSources).where(eq(syncSources.instanceId, instanceId)).returning({ id: syncSources.instanceId });
  return deleted.length > 0;
}
