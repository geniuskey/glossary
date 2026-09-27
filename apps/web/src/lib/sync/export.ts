import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  attachments,
  businessCategories,
  domains,
  syncExports,
  syncInstance,
  termRelations,
  termRevisions,
  termSlugAliases,
  termSurfaces,
  terms,
  wikiPages,
  wikiPageTerms,
  type Db,
} from "@glossary/db";
import { APP_VERSION } from "@/lib/app-version";
import { extractAttachmentHashes } from "@/lib/attachments/refs";
import { getDb } from "@/lib/db";
import {
  businessCategoryContentHash,
  domainContentHash,
  relationContentHash,
  termContentHash,
  wikiPageContentHash,
  SYNC_BUNDLE_FORMAT,
  SYNC_BUNDLE_VERSION,
  type SyncAttachment,
  type SyncBundle,
  type SyncEntityKey,
  type SyncManifest,
  type SyncTerm,
  type SyncWikiPage,
} from "./bundle";

/** 변경분 번들의 기준이 될 수 있는 최근 내보내기 기록 수. manifest가 행마다 커서 무한히 두지 않는다. */
const KEEP_EXPORTS = 30;

export async function getInstanceId(db: Db = getDb()): Promise<string> {
  await db.insert(syncInstance).values({ id: "default" }).onConflictDoNothing();
  const [row] = await db.select({ instanceId: syncInstance.instanceId }).from(syncInstance).where(eq(syncInstance.id, "default"));
  return row!.instanceId;
}

export function defaultSyncLabel(): string {
  return process.env.GLOSSARY_SYNC_LABEL?.trim() || hostname() || "glossary";
}

function groupBy<T>(rows: readonly T[], key: (row: T) => string): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const row of rows) {
    const k = key(row);
    const group = groups.get(k);
    if (group) group.push(row);
    else groups.set(k, [row]);
  }
  return groups;
}

function iso(date: Date | null): string | null {
  return date?.toISOString() ?? null;
}

export interface BuildSyncBundleOptions {
  mode: "full" | "incremental";
  /** 변경분의 기준 번들. 비우면 가장 최근 내보내기를 기준으로 한다. */
  baseBundleId?: string | null;
  label?: string;
  createdBy?: string | null;
}

export class SyncExportError extends Error {}

export async function buildSyncBundle(options: BuildSyncBundleOptions): Promise<SyncBundle> {
  const db = getDb();
  const instanceId = await getInstanceId(db);

  let base: SyncManifest | null = null;
  let baseBundleId: string | null = null;
  if (options.mode === "incremental") {
    const [row] = options.baseBundleId
      ? await db.select().from(syncExports).where(eq(syncExports.id, options.baseBundleId)).limit(1)
      : await db.select().from(syncExports).orderBy(desc(syncExports.createdAt)).limit(1);
    if (!row) {
      throw new SyncExportError(options.baseBundleId
        ? "기준 번들 기록을 찾을 수 없습니다. 오래되어 정리되었을 수 있으니 전체 번들을 내보내 주세요."
        : "이전 내보내기 기록이 없습니다. 처음에는 전체 번들을 내보내 주세요.");
    }
    base = row.manifest as SyncManifest;
    baseBundleId = row.id;
  }

  // 모든 읽기를 한 스냅샷에서 한다. 따로 읽으면 그 사이 커밋된 용어의 표기만
  // 실리는 식으로 번들 안에서 서로 어긋날 수 있다.
  const snapshot = await db.transaction(async (tx) => {
    const [termRows, surfaceRows, aliasRows, revisionRows, wikiRows, wikiTermRows, relationRows, domainRows, categoryRows] = await Promise.all([
      tx.select().from(terms).orderBy(asc(terms.id)),
      tx.select().from(termSurfaces).orderBy(asc(termSurfaces.termId), asc(termSurfaces.id)),
      tx.select().from(termSlugAliases).orderBy(asc(termSlugAliases.slug)),
      tx.select({
        termId: termRevisions.termId,
        revision: sql<number>`max(${termRevisions.revisionNumber})::int`,
      }).from(termRevisions).groupBy(termRevisions.termId),
      tx.select().from(wikiPages).orderBy(asc(wikiPages.id)),
      tx.select().from(wikiPageTerms).orderBy(asc(wikiPageTerms.termId)),
      // AI가 제안만 한 관계는 이 서버의 검토 대기열이다. 받는 쪽은 리비전 번호가 달라
      // 검토 기준(sourceRevision)이 의미를 잃으므로 승인된 관계만 보낸다.
      tx.select().from(termRelations).where(eq(termRelations.status, "approved")).orderBy(asc(termRelations.id)),
      tx.select().from(domains).orderBy(asc(domains.sortOrder), asc(domains.key)),
      tx.select().from(businessCategories).orderBy(asc(businessCategories.sortOrder), asc(businessCategories.key)),
    ]);
    return { termRows, surfaceRows, aliasRows, revisionRows, wikiRows, wikiTermRows, relationRows, domainRows, categoryRows };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });

  const surfacesByTerm = groupBy(snapshot.surfaceRows, (row) => row.termId);
  const aliasesByTerm = groupBy(snapshot.aliasRows, (row) => row.termId);
  const termIdsByPage = groupBy(snapshot.wikiTermRows, (row) => row.wikiPageId);
  const revisionByTerm = new Map(snapshot.revisionRows.map((row) => [row.termId, row.revision]));

  const allTerms: SyncTerm[] = snapshot.termRows.map((term) => ({
    id: term.id,
    slug: term.slug,
    qualityProfile: term.qualityProfile,
    nameEn: term.nameEn,
    nameKo: term.nameKo,
    fullNameEn: term.fullNameEn,
    fullNameKo: term.fullNameKo,
    domain: term.domain,
    category: term.category,
    topic: term.topic,
    tags: term.tags,
    definitionMd: term.definitionMd,
    bodyMd: term.bodyMd,
    replacedById: term.replacedById,
    slugAliases: (aliasesByTerm.get(term.id) ?? []).map((row) => row.slug),
    surfaces: (surfacesByTerm.get(term.id) ?? []).map((row) => ({
      text: row.text,
      lang: row.lang,
      kind: row.kind,
      caseSensitive: row.caseSensitive,
    })),
    sourceRevision: revisionByTerm.get(term.id) ?? 0,
    createdAt: term.createdAt.toISOString(),
    updatedAt: term.updatedAt.toISOString(),
  }));

  const allPages: SyncWikiPage[] = snapshot.wikiRows.map((page) => ({
    id: page.id,
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    sourceUrl: page.sourceUrl,
    content: page.content,
    domain: page.domain,
    status: page.status,
    termIds: (termIdsByPage.get(page.id) ?? []).map((row) => row.termId).sort(),
    sourceRevision: page.revision,
    reviewedAt: iso(page.reviewedAt),
    createdAt: page.createdAt.toISOString(),
    updatedAt: page.updatedAt.toISOString(),
  }));

  const allRelations = snapshot.relationRows.map((relation) => ({
    id: relation.id,
    sourceTermId: relation.sourceTermId,
    targetTermId: relation.targetTermId,
    relationType: relation.relationType,
    confidence: relation.confidence,
    evidenceMd: relation.evidenceMd,
    createdAt: relation.createdAt.toISOString(),
    reviewedAt: iso(relation.reviewedAt),
  }));

  const allDomains = snapshot.domainRows.map((domain) => ({
    key: domain.key,
    label: domain.label,
    labelEn: domain.labelEn,
    color: domain.color,
    sortOrder: domain.sortOrder,
  }));

  const allCategories = snapshot.categoryRows.map((category) => ({
    key: category.key,
    label: category.label,
    labelEn: category.labelEn,
    sortOrder: category.sortOrder,
  }));

  const attachmentsOf = (markdown: (string | null)[]) => markdown.flatMap((text) => extractAttachmentHashes(text));
  const referenced = new Set([
    ...allTerms.flatMap((term) => attachmentsOf([term.definitionMd, term.bodyMd])),
    ...allPages.flatMap((page) => attachmentsOf([page.content])),
  ]);

  const manifest: SyncManifest = {
    terms: Object.fromEntries(allTerms.map((term) => [term.id, termContentHash(term)])),
    wikiPages: Object.fromEntries(allPages.map((page) => [page.id, wikiPageContentHash(page)])),
    relations: Object.fromEntries(allRelations.map((relation) => [relation.id, relationContentHash(relation)])),
    domains: Object.fromEntries(allDomains.map((domain) => [domain.key, domainContentHash(domain)])),
    businessCategories: Object.fromEntries(allCategories.map((category) => [category.key, businessCategoryContentHash(category)])),
    attachments: [],
  };

  const changed = (key: SyncEntityKey, id: string) => !base || base[key][id] !== manifest[key][id];

  // 분류 체계는 작고, 받는 쪽이 용어의 분류 키를 자기 키로 옮기는 기준이라 변경분
  // 번들에도 항상 전부 싣는다. 빠지면 바뀌지 않은 분류의 키 대응을 알 수 없다.
  const data = {
    domains: allDomains,
    businessCategories: allCategories,
    terms: allTerms.filter((term) => changed("terms", term.id)),
    wikiPages: allPages.filter((page) => changed("wikiPages", page.id)),
    relations: allRelations.filter((relation) => changed("relations", relation.id)),
    attachments: [] as SyncAttachment[],
  };

  // 실제로 존재하는 첨부만 manifest에 싣는다. 본문에 적힌 해시라도 이 서버에 실체가
  // 없으면 받는 쪽이 "빠졌다"고 오판하지 않게 한다.
  const existing = referenced.size
    ? await db.select({ sha256: attachments.sha256 }).from(attachments).where(inArray(attachments.sha256, [...referenced]))
    : [];
  manifest.attachments = existing.map((row) => row.sha256).sort();

  const baseAttachments = new Set(base?.attachments ?? []);
  const needed = new Set([
    ...data.terms.flatMap((term) => attachmentsOf([term.definitionMd, term.bodyMd])),
    ...data.wikiPages.flatMap((page) => attachmentsOf([page.content])),
  ].filter((sha) => !baseAttachments.has(sha)));
  if (needed.size > 0) {
    const rows = await db.select().from(attachments).where(inArray(attachments.sha256, [...needed])).orderBy(asc(attachments.sha256));
    data.attachments = rows.map((row) => ({
      sha256: row.sha256,
      storedMime: row.storedMime,
      byteSize: row.byteSize,
      width: row.width,
      height: row.height,
      originalFilename: row.originalFilename,
      originalMime: row.originalMime,
      originalBytes: row.originalBytes,
      dataBase64: Buffer.from(row.data).toString("base64"),
    }));
  }

  const bundle: SyncBundle = {
    format: SYNC_BUNDLE_FORMAT,
    version: SYNC_BUNDLE_VERSION,
    bundleId: randomUUID(),
    mode: options.mode,
    baseBundleId,
    source: { instanceId, label: options.label?.trim() || defaultSyncLabel(), appVersion: APP_VERSION },
    exportedAt: new Date().toISOString(),
    manifest,
    data,
  };
  return bundle;
}

export function syncBundleCounts(bundle: SyncBundle): Record<string, number> {
  return Object.fromEntries(Object.entries(bundle.data).map(([key, rows]) => [key, rows.length]));
}

/**
 * 번들을 파일로 내보낸 뒤에 기록한다. 기록이 먼저 남고 파일 쓰기가 실패하면,
 * 다음 변경분이 받는 쪽에 도달한 적 없는 번들을 기준으로 잡아 항목이 빠진다.
 */
export async function recordSyncExport(bundle: SyncBundle, byteSize: number, createdBy: string | null = null): Promise<void> {
  const db = getDb();
  await db.insert(syncExports).values({
    id: bundle.bundleId,
    mode: bundle.mode,
    baseExportId: bundle.baseBundleId,
    manifest: bundle.manifest,
    counts: syncBundleCounts(bundle),
    byteSize,
    createdBy,
    createdAt: new Date(bundle.exportedAt),
  });
  const stale = await db.select({ id: syncExports.id }).from(syncExports)
    .orderBy(desc(syncExports.createdAt)).offset(KEEP_EXPORTS);
  if (stale.length > 0) await db.delete(syncExports).where(inArray(syncExports.id, stale.map((row) => row.id)));
}
