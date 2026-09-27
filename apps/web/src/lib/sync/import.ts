import { and, eq, inArray, sql } from "drizzle-orm";
import {
  attachmentRefs,
  attachments,
  businessCategories,
  classificationReviewSuggestions,
  domains,
  surfaceKeys,
  syncEntities,
  syncSources,
  termRelations,
  termRevisions,
  termSlugAliases,
  termSurfaces,
  terms,
  wikiPageRevisions,
  wikiPages,
  wikiPageTerms,
  workspaceSettings,
  type Db,
} from "@glossary/db";
import { extractAttachmentHashes } from "@/lib/attachments/refs";
import { getDb } from "@/lib/db";
import { queueRagIndex } from "@/lib/rag/indexer";
import { queueWikiIndex } from "@/lib/rag/wiki-indexer";
import { completionStatus } from "@/lib/terms/completion";
import { firstUnusedDomainColor } from "@/lib/terms/domain-colors";
import { domainLabelKey } from "@/lib/terms/domain-label";
import { normalizeTags } from "@/lib/terms/tags";
import { DEFAULT_TERM_QUALITY } from "@/lib/workspace/term-quality-values";
import { wikiContentHash } from "@/lib/wiki/content-hash";
import {
  businessCategoryContentHash,
  domainContentHash,
  relationContentHash,
  termContentHash,
  wikiPageContentHash,
  type SyncBundle,
  type SyncEntityKey,
  type SyncTerm,
} from "./bundle";
import { getInstanceId } from "./export";

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
type EntityType = "term" | "wiki_page" | "relation" | "domain" | "business_category";

/** 마지막 동기화 이후 이 서버에서 고친 항목을 출처 내용으로 덮을지(source), 남길지(keep). */
export type LocalEditPolicy = "source" | "keep";

export interface SyncImportOptions {
  dryRun?: boolean;
  localEdits?: LocalEditPolicy;
}

export interface SyncIssue {
  type: EntityType | "attachment";
  id: string;
  label: string;
  reason: string;
}

interface Tally { created: number; updated: number; deleted: number; unchanged: number }

export interface SyncImportReport {
  bundleId: string;
  mode: SyncBundle["mode"];
  source: { instanceId: string; label: string };
  exportedAt: string;
  importedAt: string;
  dryRun: boolean;
  localEdits: LocalEditPolicy;
  alreadyApplied: boolean;
  counts: Record<SyncEntityKey, Tally>;
  attachmentsAdded: number;
  issueTotals: { conflicts: number; overwritten: number; kept: number; stale: number };
  conflicts: SyncIssue[];
  overwritten: SyncIssue[];
  kept: SyncIssue[];
  stale: SyncIssue[];
}

export class SyncImportError extends Error {
  constructor(readonly code: "own_bundle" | "older_bundle", message: string) {
    super(message);
  }
}

class DryRunRollback extends Error {
  constructor(readonly report: SyncImportReport) {
    super("dry run");
  }
}

/** 보고서가 수만 건 목록으로 부풀지 않게 항목은 앞부분만 싣고 총계는 따로 센다. */
const MAX_LISTED_ISSUES = 200;

const ENTITY_KEY: Record<EntityType, SyncEntityKey> = {
  term: "terms",
  wiki_page: "wikiPages",
  relation: "relations",
  domain: "domains",
  business_category: "businessCategories",
};

function emptyTally(): Tally {
  return { created: 0, updated: 0, deleted: 0, unchanged: 0 };
}

function termLabel(term: Pick<SyncTerm, "slug" | "nameKo" | "nameEn">): string {
  return `${term.nameKo || term.nameEn || term.slug} (/g/${term.slug})`;
}

function labelKey(label: string): string {
  return label.normalize("NFC").trim().toLocaleLowerCase("ko");
}

function chunks<T>(rows: readonly T[], size = 500): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

interface Tracked { contentHash: string; localRevision: number | null }

/**
 * 동기화 번들을 이 서버에 반영한다. 전체가 한 트랜잭션이라 도중에 실패하면 아무것도
 * 남지 않는다 — 절반만 반영된 상태에서 다음 번들이 들어오면 변경분 판정이 어긋난다.
 * 항목 단위로 풀 수 있는 문제(주소 충돌 등)는 건너뛰고 보고서에 남긴다.
 */
export async function applySyncBundle(bundle: SyncBundle, options: SyncImportOptions = {}): Promise<SyncImportReport> {
  const localEdits = options.localEdits ?? "source";
  const report: SyncImportReport = {
    bundleId: bundle.bundleId,
    mode: bundle.mode,
    source: { instanceId: bundle.source.instanceId, label: bundle.source.label },
    exportedAt: bundle.exportedAt,
    importedAt: new Date().toISOString(),
    dryRun: Boolean(options.dryRun),
    localEdits,
    alreadyApplied: false,
    counts: {
      terms: emptyTally(),
      wikiPages: emptyTally(),
      relations: emptyTally(),
      domains: emptyTally(),
      businessCategories: emptyTally(),
    },
    attachmentsAdded: 0,
    issueTotals: { conflicts: 0, overwritten: 0, kept: 0, stale: 0 },
    conflicts: [],
    overwritten: [],
    kept: [],
    stale: [],
  };
  const issue = (kind: "conflicts" | "overwritten" | "kept" | "stale", entry: SyncIssue) => {
    report.issueTotals[kind] += 1;
    if (report[kind].length < MAX_LISTED_ISSUES) report[kind].push(entry);
  };

  try {
    await getDb().transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('glossary_sync_import'))`);
      // 분류 체계를 고치는 관리자 화면과 같은 잠금을 잡는다. 동시에 돌면 색·이름
      // 유일성 검사가 서로의 쓰기를 못 본다.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('glossary_domain_catalog'))`);

      if (bundle.source.instanceId === await getInstanceId(tx as unknown as Db)) {
        throw new SyncImportError("own_bundle", "이 서버가 내보낸 번들입니다. 다른 서버에서 받은 번들만 가져올 수 있습니다.");
      }

      const [sourceRow] = await tx.select().from(syncSources).where(eq(syncSources.instanceId, bundle.source.instanceId)).limit(1);
      if (sourceRow && new Date(bundle.exportedAt) < sourceRow.lastExportedAt) {
        throw new SyncImportError(
          "older_bundle",
          `이미 더 최신 번들(${sourceRow.lastExportedAt.toISOString()})이 반영되어 있습니다. 오래된 번들을 적용하면 최신 내용이 되돌아갑니다.`,
        );
      }
      report.alreadyApplied = sourceRow?.lastBundleId === bundle.bundleId;

      await tx.insert(syncSources).values({
        instanceId: bundle.source.instanceId,
        label: bundle.source.label,
        lastBundleId: sourceRow?.lastBundleId ?? bundle.bundleId,
        lastExportedAt: sourceRow?.lastExportedAt ?? new Date(bundle.exportedAt),
        lastReport: sourceRow?.lastReport ?? {},
      }).onConflictDoNothing();

      const trackedRows = await tx.select().from(syncEntities).where(eq(syncEntities.sourceInstanceId, bundle.source.instanceId));
      const tracked = new Map<string, Tracked>(trackedRows.map((row) => [`${row.entityType}:${row.entityId}`, row]));
      const trackUpserts = new Map<string, { entityType: EntityType; entityId: string; contentHash: string; localRevision: number | null }>();
      const trackDeletes: { entityType: EntityType; entityId: string }[] = [];
      const track = (entityType: EntityType, entityId: string, contentHash: string, localRevision: number | null) => {
        trackUpserts.set(`${entityType}:${entityId}`, { entityType, entityId, contentHash, localRevision });
        tracked.set(`${entityType}:${entityId}`, { contentHash, localRevision });
      };
      const untrack = (entityType: EntityType, entityId: string) => {
        trackDeletes.push({ entityType, entityId });
        tracked.delete(`${entityType}:${entityId}`);
        trackUpserts.delete(`${entityType}:${entityId}`);
      };
      const trackedIds = (entityType: EntityType) => trackedRows.filter((row) => row.entityType === entityType).map((row) => row.entityId);

      // ---- 첨부: 용어·위키 본문이 참조하므로 먼저 넣는다. sha256이 내용 주소라 덮어쓸 일이 없다.
      for (const batch of chunks(bundle.data.attachments, 50)) {
        const inserted = await tx.insert(attachments).values(batch.map((a) => ({
          sha256: a.sha256,
          data: Buffer.from(a.dataBase64, "base64"),
          storedMime: a.storedMime,
          byteSize: a.byteSize,
          width: a.width,
          height: a.height,
          originalFilename: a.originalFilename,
          originalMime: a.originalMime,
          originalBytes: a.originalBytes,
        }))).onConflictDoNothing().returning({ id: attachments.id });
        report.attachmentsAdded += inserted.length;
      }

      // ---- 도메인: 용어는 도메인을 "이름"으로 들고 있다. 같은 이름이 이미 있으면 키가 달라도 같은 도메인이다.
      const localDomains = await tx.select().from(domains);
      for (const incoming of bundle.data.domains) {
        const hash = domainContentHash(incoming);
        const known = tracked.get(`domain:${incoming.key}`);
        const byKey = localDomains.find((d) => d.key === incoming.key);
        const byLabel = localDomains.find((d) => domainLabelKey(d.label) === domainLabelKey(incoming.label));
        const others = (key: string) => localDomains.filter((d) => d.key !== key);
        if (byKey) {
          if (known?.contentHash === hash) { report.counts.domains.unchanged += 1; continue; }
          const labelFree = !others(byKey.key).some((d) => domainLabelKey(d.label) === domainLabelKey(incoming.label));
          const labelEnFree = !incoming.labelEn || !others(byKey.key).some((d) => d.labelEn && domainLabelKey(d.labelEn) === domainLabelKey(incoming.labelEn!));
          const colorFree = !others(byKey.key).some((d) => d.color === incoming.color);
          if (!labelFree) {
            issue("conflicts", { type: "domain", id: incoming.key, label: incoming.label, reason: "같은 이름의 다른 도메인이 이 서버에 있어 이름을 바꾸지 않았습니다." });
          }
          const next = {
            label: labelFree ? incoming.label : byKey.label,
            labelEn: labelEnFree ? incoming.labelEn : byKey.labelEn,
            color: colorFree ? incoming.color : byKey.color,
            sortOrder: incoming.sortOrder,
          };
          await tx.update(domains).set({ ...next, updatedAt: new Date() }).where(eq(domains.key, byKey.key));
          // 관리자 화면의 이름 변경(updateDomain)과 같은 규칙: 이 서버에서만 만든 용어도 새 이름을 따라간다.
          if (next.label !== byKey.label) {
            await tx.update(terms)
              .set({ domain: sql`array_replace(${terms.domain}, ${byKey.label}, ${next.label})` })
              .where(sql`${terms.domain} @> array[${byKey.label}]::text[]`);
          }
          Object.assign(byKey, next);
          report.counts.domains.updated += 1;
          track("domain", incoming.key, hash, null);
        } else if (byLabel) {
          report.counts.domains.unchanged += 1;
          track("domain", incoming.key, hash, null);
        } else {
          const used = new Set(localDomains.map((d) => d.color));
          const color = used.has(incoming.color) ? firstUnusedDomainColor(used) : incoming.color;
          if (!color) {
            issue("conflicts", { type: "domain", id: incoming.key, label: incoming.label, reason: "도메인 색상 팔레트가 가득 차 추가하지 못했습니다." });
            continue;
          }
          const labelEn = incoming.labelEn && !localDomains.some((d) => d.labelEn && domainLabelKey(d.labelEn) === domainLabelKey(incoming.labelEn!))
            ? incoming.labelEn : null;
          const [created] = await tx.insert(domains).values({ key: incoming.key, label: incoming.label, labelEn, color, sortOrder: incoming.sortOrder }).returning();
          localDomains.push(created!);
          report.counts.domains.created += 1;
          track("domain", incoming.key, hash, null);
        }
      }

      // ---- 업무 분류: 용어는 분류를 "키"로 들고 있어, 이름만 같고 키가 다르면 키를 옮겨 적는다.
      const localCategories = await tx.select().from(businessCategories);
      const categoryKeyMap = new Map<string, string>();
      for (const incoming of bundle.data.businessCategories) {
        const hash = businessCategoryContentHash(incoming);
        const known = tracked.get(`business_category:${incoming.key}`);
        const byKey = localCategories.find((c) => c.key === incoming.key);
        const byLabel = localCategories.find((c) => labelKey(c.label) === labelKey(incoming.label));
        if (byKey) {
          categoryKeyMap.set(incoming.key, byKey.key);
          if (known?.contentHash === hash) { report.counts.businessCategories.unchanged += 1; continue; }
          const others = localCategories.filter((c) => c.key !== byKey.key);
          const labelFree = !others.some((c) => labelKey(c.label) === labelKey(incoming.label));
          const labelEnFree = !incoming.labelEn || !others.some((c) => c.labelEn && labelKey(c.labelEn) === labelKey(incoming.labelEn!));
          if (!labelFree) {
            issue("conflicts", { type: "business_category", id: incoming.key, label: incoming.label, reason: "같은 이름의 다른 업무 분류가 이 서버에 있어 이름을 바꾸지 않았습니다." });
          }
          const next = {
            label: labelFree ? incoming.label : byKey.label,
            labelEn: labelEnFree ? incoming.labelEn : byKey.labelEn,
            sortOrder: incoming.sortOrder,
          };
          await tx.update(businessCategories).set({ ...next, updatedAt: new Date() }).where(eq(businessCategories.key, byKey.key));
          Object.assign(byKey, next);
          report.counts.businessCategories.updated += 1;
          track("business_category", incoming.key, hash, null);
        } else if (byLabel) {
          categoryKeyMap.set(incoming.key, byLabel.key);
          report.counts.businessCategories.unchanged += 1;
          track("business_category", incoming.key, hash, null);
        } else {
          const labelEn = incoming.labelEn && !localCategories.some((c) => c.labelEn && labelKey(c.labelEn) === labelKey(incoming.labelEn!))
            ? incoming.labelEn : null;
          const [created] = await tx.insert(businessCategories).values({ key: incoming.key, label: incoming.label, labelEn, sortOrder: incoming.sortOrder }).returning();
          localCategories.push(created!);
          categoryKeyMap.set(incoming.key, incoming.key);
          report.counts.businessCategories.created += 1;
          track("business_category", incoming.key, hash, null);
        }
      }

      const currentRevisions = async (ids: string[]) => {
        const out = new Map<string, number>();
        for (const batch of chunks(ids)) {
          const rows = await tx.select({ termId: termRevisions.termId, n: sql<number>`max(${termRevisions.revisionNumber})::int` })
            .from(termRevisions).where(inArray(termRevisions.termId, batch)).groupBy(termRevisions.termId);
          for (const row of rows) out.set(row.termId, row.n);
        }
        return out;
      };

      // ---- 삭제: 출처 manifest에서 사라진 항목. 새 항목이 같은 주소를 이어받는 경우가
      // 있어(삭제 후 같은 이름으로 재등록) 생성보다 먼저 처리한다.
      for (const id of trackedIds("relation").filter((id) => !(id in bundle.manifest.relations))) {
        const deleted = await tx.delete(termRelations).where(eq(termRelations.id, id)).returning({ id: termRelations.id });
        if (deleted.length) report.counts.relations.deleted += 1;
        untrack("relation", id);
      }
      const goneTermIds = trackedIds("term").filter((id) => !(id in bundle.manifest.terms));
      const goneTermRevisions = await currentRevisions(goneTermIds);
      for (const id of goneTermIds) {
        const [local] = await tx.select({ slug: terms.slug, nameKo: terms.nameKo, nameEn: terms.nameEn }).from(terms).where(eq(terms.id, id));
        if (local) {
          const modified = tracked.get(`term:${id}`)?.localRevision !== (goneTermRevisions.get(id) ?? 0);
          if (modified && localEdits === "keep") {
            issue("kept", { type: "term", id, label: termLabel(local), reason: "출처에서 삭제되었지만 이 서버에서 고친 용어라 남겼습니다. 이제 이 서버의 용어로 취급합니다." });
          } else {
            await tx.delete(terms).where(eq(terms.id, id));
            report.counts.terms.deleted += 1;
          }
        }
        untrack("term", id);
      }
      for (const id of trackedIds("wiki_page").filter((id) => !(id in bundle.manifest.wikiPages))) {
        const [local] = await tx.select({ slug: wikiPages.slug, title: wikiPages.title, revision: wikiPages.revision }).from(wikiPages).where(eq(wikiPages.id, id));
        if (local) {
          const modified = tracked.get(`wiki_page:${id}`)?.localRevision !== local.revision;
          if (modified && localEdits === "keep") {
            issue("kept", { type: "wiki_page", id, label: `${local.title} (/w/${local.slug})`, reason: "출처에서 삭제되었지만 이 서버에서 고친 문서라 남겼습니다. 이제 이 서버의 문서로 취급합니다." });
          } else {
            await tx.delete(wikiPages).where(eq(wikiPages.id, id));
            report.counts.wikiPages.deleted += 1;
          }
        }
        untrack("wiki_page", id);
      }

      // ---- 용어
      const [qualityRow] = await tx.select({
        definitionMinChars: workspaceSettings.definitionMinChars,
        bodyMinChars: workspaceSettings.bodyMinChars,
      }).from(workspaceSettings).where(eq(workspaceSettings.id, "default"));
      const quality = qualityRow ?? DEFAULT_TERM_QUALITY;

      const slugOwner = new Map((await tx.select({ id: terms.id, slug: terms.slug }).from(terms)).map((row) => [row.slug, row.id]));
      const aliasOwner = new Map((await tx.select({ slug: termSlugAliases.slug, termId: termSlugAliases.termId }).from(termSlugAliases)).map((row) => [row.slug, row.termId]));
      const incomingTermIds = bundle.data.terms.map((t) => t.id);
      const localTerms = new Map<string, typeof terms.$inferSelect>();
      const localSurfaces = new Map<string, { text: string; lang: SyncTerm["surfaces"][number]["lang"]; kind: SyncTerm["surfaces"][number]["kind"]; caseSensitive: boolean }[]>();
      const localAliases = new Map<string, string[]>();
      for (const batch of chunks(incomingTermIds)) {
        for (const row of await tx.select().from(terms).where(inArray(terms.id, batch))) localTerms.set(row.id, row);
        for (const row of await tx.select().from(termSurfaces).where(inArray(termSurfaces.termId, batch))) {
          localSurfaces.set(row.termId, [...(localSurfaces.get(row.termId) ?? []), { text: row.text, lang: row.lang, kind: row.kind, caseSensitive: row.caseSensitive }]);
        }
        for (const row of await tx.select().from(termSlugAliases).where(inArray(termSlugAliases.termId, batch))) {
          localAliases.set(row.termId, [...(localAliases.get(row.termId) ?? []), row.slug]);
        }
      }
      const termRevisionMap = await currentRevisions(incomingTermIds);

      const referencedHashes = [...new Set([
        ...bundle.data.terms.flatMap((t) => [...extractAttachmentHashes(t.definitionMd), ...extractAttachmentHashes(t.bodyMd)]),
      ])];
      const attachmentIdBySha = new Map<string, string>();
      for (const batch of chunks(referencedHashes)) {
        for (const row of await tx.select({ id: attachments.id, sha256: attachments.sha256 }).from(attachments).where(inArray(attachments.sha256, batch))) {
          attachmentIdBySha.set(row.sha256, row.id);
        }
      }

      for (const incoming of bundle.data.terms) {
        const hash = termContentHash(incoming);
        const known = tracked.get(`term:${incoming.id}`);
        const local = localTerms.get(incoming.id);
        const localRevision = termRevisionMap.get(incoming.id) ?? 0;
        const label = termLabel(incoming);
        const category = incoming.category.map((key) => categoryKeyMap.get(key) ?? key);

        if (local) {
          const localHash = termContentHash({
            ...incoming,
            ...local,
            category: local.category.map((key) => [...categoryKeyMap].find(([, mapped]) => mapped === key)?.[0] ?? key),
            slugAliases: localAliases.get(local.id) ?? [],
            surfaces: localSurfaces.get(local.id) ?? [],
            createdAt: incoming.createdAt,
            updatedAt: incoming.updatedAt,
          });
          if (localHash === hash) {
            report.counts.terms.unchanged += 1;
            track("term", incoming.id, hash, localRevision);
            continue;
          }
          // 출처가 그대로면 이 서버에서 고친 내용도 그대로 둔다. 덮어쓰기는 양쪽이 모두
          // 바뀐 경우에만 일어난다.
          if (known?.contentHash === hash) {
            report.counts.terms.unchanged += 1;
            continue;
          }
          // 추적 기록이 없는데 같은 id가 있으면 출처 DB를 통째로 복원해 시작한 경우다.
          // 같은 UUID는 출처에서만 나올 수 있으므로 이 서버의 수정으로 보지 않는다.
          const modified = known !== undefined && known.localRevision !== localRevision;
          if (modified && localEdits === "keep") {
            issue("kept", { type: "term", id: incoming.id, label, reason: "마지막 동기화 이후 이 서버에서 고쳐 출처 내용을 반영하지 않았습니다." });
            continue;
          }
          if (incoming.slug !== local.slug) {
            const owner = slugOwner.get(incoming.slug) ?? aliasOwner.get(incoming.slug);
            if (owner && owner !== incoming.id) {
              issue("conflicts", { type: "term", id: incoming.id, label, reason: `주소 /g/${incoming.slug}를 이 서버의 다른 용어가 쓰고 있어 반영하지 않았습니다.` });
              continue;
            }
          }
          const status = completionStatus({ ...incoming, categories: category }, quality);
          const [updated] = await tx.update(terms).set({
            slug: incoming.slug,
            qualityProfile: incoming.qualityProfile,
            nameEn: incoming.nameEn,
            nameKo: incoming.nameKo,
            fullNameEn: incoming.fullNameEn,
            fullNameKo: incoming.fullNameKo,
            domain: incoming.domain,
            category,
            topic: incoming.topic,
            tags: incoming.tags,
            status,
            definitionMd: incoming.definitionMd,
            bodyMd: incoming.bodyMd,
            replacedById: incoming.replacedById,
            updatedAt: new Date(incoming.updatedAt),
          }).where(eq(terms.id, incoming.id)).returning();
          if (local.slug !== incoming.slug) {
            slugOwner.delete(local.slug);
            slugOwner.set(incoming.slug, incoming.id);
          }
          const savedSurfaces = await writeTermChildren(tx, incoming, { slugOwner, aliasOwner, attachmentIdBySha }, true);
          const revision = localRevision + 1;
          await tx.insert(termRevisions).values({
            termId: incoming.id,
            revisionNumber: revision,
            snapshot: { term: updated, surfaces: savedSurfaces },
            message: syncMessage(bundle, incoming.sourceRevision),
          });
          await tx.delete(classificationReviewSuggestions).where(eq(classificationReviewSuggestions.termId, incoming.id));
          await queueRagIndex(tx, incoming.id, revision);
          if (modified) issue("overwritten", { type: "term", id: incoming.id, label, reason: "이 서버에서 고친 내용을 출처 내용으로 덮었습니다. 이력에서 되돌릴 수 있습니다." });
          report.counts.terms.updated += 1;
          track("term", incoming.id, hash, revision);
          continue;
        }

        if (known && (known.contentHash === hash || localEdits === "keep")) {
          if (known.contentHash === hash) report.counts.terms.unchanged += 1;
          else issue("kept", { type: "term", id: incoming.id, label, reason: "이 서버에서 삭제한 용어라 다시 만들지 않았습니다." });
          continue;
        }
        const owner = slugOwner.get(incoming.slug) ?? aliasOwner.get(incoming.slug);
        if (owner) {
          issue("conflicts", { type: "term", id: incoming.id, label, reason: `주소 /g/${incoming.slug}를 이 서버의 다른 용어가 쓰고 있어 가져오지 않았습니다.` });
          continue;
        }
        const status = completionStatus({ ...incoming, categories: category }, quality);
        const [created] = await tx.insert(terms).values({
          id: incoming.id,
          slug: incoming.slug,
          qualityProfile: incoming.qualityProfile,
          nameEn: incoming.nameEn,
          nameKo: incoming.nameKo,
          fullNameEn: incoming.fullNameEn,
          fullNameKo: incoming.fullNameKo,
          domain: incoming.domain,
          category,
          topic: incoming.topic,
          tags: incoming.tags,
          status,
          definitionMd: incoming.definitionMd,
          bodyMd: incoming.bodyMd,
          replacedById: incoming.replacedById,
          createdAt: new Date(incoming.createdAt),
          updatedAt: new Date(incoming.updatedAt),
        }).returning();
        slugOwner.set(incoming.slug, incoming.id);
        const savedSurfaces = await writeTermChildren(tx, incoming, { slugOwner, aliasOwner, attachmentIdBySha }, false);
        await tx.insert(termRevisions).values({
          termId: incoming.id,
          revisionNumber: 1,
          snapshot: { term: created, surfaces: savedSurfaces },
          message: syncMessage(bundle, incoming.sourceRevision),
        });
        await queueRagIndex(tx, incoming.id, 1);
        report.counts.terms.created += 1;
        track("term", incoming.id, hash, 1);
      }

      // ---- 위키
      const existingTermIds = new Set((await tx.select({ id: terms.id }).from(terms)).map((row) => row.id));
      const wikiSlugOwner = new Map((await tx.select({ id: wikiPages.id, slug: wikiPages.slug }).from(wikiPages)).map((row) => [row.slug, row.id]));
      const incomingPageIds = bundle.data.wikiPages.map((p) => p.id);
      const localPages = new Map<string, typeof wikiPages.$inferSelect>();
      const localPageTerms = new Map<string, string[]>();
      for (const batch of chunks(incomingPageIds)) {
        for (const row of await tx.select().from(wikiPages).where(inArray(wikiPages.id, batch))) localPages.set(row.id, row);
        for (const row of await tx.select().from(wikiPageTerms).where(inArray(wikiPageTerms.wikiPageId, batch))) {
          localPageTerms.set(row.wikiPageId, [...(localPageTerms.get(row.wikiPageId) ?? []), row.termId]);
        }
      }

      for (const incoming of bundle.data.wikiPages) {
        const normalizedPage = { ...incoming, tags: normalizeTags(incoming.tags ?? []) };
        const hash = wikiPageContentHash(normalizedPage);
        const known = tracked.get(`wiki_page:${incoming.id}`);
        const local = localPages.get(incoming.id);
        const label = `${incoming.title} (/w/${incoming.slug})`;
        // 이 서버에 없는(충돌로 못 들어온) 용어와의 연결은 뺀다. 해시는 출처 기준이라
        // 그 용어가 나중에 들어와도 다음 번들에서 연결이 채워지지는 않는다 — 전체 번들로 맞춘다.
        const termIds = [...new Set(incoming.termIds)].filter((id) => existingTermIds.has(id)).sort();
        const hashInput = { title: incoming.title, summary: incoming.summary, sourceUrl: incoming.sourceUrl, content: incoming.content, domain: incoming.domain, tags: normalizedPage.tags, termIds };
        const reviewedAt = incoming.status === "published" && incoming.reviewedAt ? new Date(incoming.reviewedAt) : null;

        if (local) {
          const localHash = wikiPageContentHash({ ...normalizedPage, ...local, tags: local.tags, termIds: localPageTerms.get(local.id) ?? [], reviewedAt: incoming.reviewedAt, createdAt: incoming.createdAt, updatedAt: incoming.updatedAt, sourceRevision: incoming.sourceRevision });
          if (localHash === hash) {
            report.counts.wikiPages.unchanged += 1;
            track("wiki_page", incoming.id, hash, local.revision);
            continue;
          }
          if (known?.contentHash === hash) {
            report.counts.wikiPages.unchanged += 1;
            continue;
          }
          const modified = known !== undefined && known.localRevision !== local.revision;
          if (modified && localEdits === "keep") {
            issue("kept", { type: "wiki_page", id: incoming.id, label, reason: "마지막 동기화 이후 이 서버에서 고쳐 출처 내용을 반영하지 않았습니다." });
            continue;
          }
          const slugUser = wikiSlugOwner.get(incoming.slug);
          if (slugUser && slugUser !== incoming.id) {
            issue("conflicts", { type: "wiki_page", id: incoming.id, label, reason: `주소 /w/${incoming.slug}를 이 서버의 다른 문서가 쓰고 있어 반영하지 않았습니다.` });
            continue;
          }
          const revision = local.revision + 1;
          const [updated] = await tx.update(wikiPages).set({
            slug: incoming.slug,
            title: incoming.title,
            summary: incoming.summary,
            sourceUrl: incoming.sourceUrl,
            content: incoming.content,
            contentHash: wikiContentHash(hashInput),
            domain: incoming.domain,
            tags: normalizedPage.tags,
            revision,
            status: incoming.status,
            reviewedBy: null,
            reviewedAt,
            updatedAt: new Date(incoming.updatedAt),
          }).where(eq(wikiPages.id, incoming.id)).returning();
          wikiSlugOwner.delete(local.slug);
          wikiSlugOwner.set(incoming.slug, incoming.id);
          await tx.delete(wikiPageTerms).where(eq(wikiPageTerms.wikiPageId, incoming.id));
          if (termIds.length) await tx.insert(wikiPageTerms).values(termIds.map((termId) => ({ wikiPageId: incoming.id, termId })));
          await tx.insert(wikiPageRevisions).values({
            wikiPageId: incoming.id,
            revisionNumber: revision,
            snapshot: wikiSnapshot(updated!, termIds),
            message: syncMessage(bundle, incoming.sourceRevision),
          });
          await queueWikiIndex(tx, incoming.id, revision);
          if (modified) issue("overwritten", { type: "wiki_page", id: incoming.id, label, reason: "이 서버에서 고친 내용을 출처 내용으로 덮었습니다. 이력에서 확인할 수 있습니다." });
          report.counts.wikiPages.updated += 1;
          track("wiki_page", incoming.id, hash, revision);
          continue;
        }

        if (known && (known.contentHash === hash || localEdits === "keep")) {
          if (known.contentHash === hash) report.counts.wikiPages.unchanged += 1;
          else issue("kept", { type: "wiki_page", id: incoming.id, label, reason: "이 서버에서 삭제한 문서라 다시 만들지 않았습니다." });
          continue;
        }
        if (wikiSlugOwner.has(incoming.slug)) {
          issue("conflicts", { type: "wiki_page", id: incoming.id, label, reason: `주소 /w/${incoming.slug}를 이 서버의 다른 문서가 쓰고 있어 가져오지 않았습니다.` });
          continue;
        }
        const [created] = await tx.insert(wikiPages).values({
          id: incoming.id,
          slug: incoming.slug,
          title: incoming.title,
          summary: incoming.summary,
          sourceUrl: incoming.sourceUrl,
          content: incoming.content,
          contentHash: wikiContentHash(hashInput),
          domain: incoming.domain,
          tags: normalizedPage.tags,
          revision: 1,
          status: incoming.status,
          reviewedAt,
          createdAt: new Date(incoming.createdAt),
          updatedAt: new Date(incoming.updatedAt),
        }).returning();
        wikiSlugOwner.set(incoming.slug, incoming.id);
        if (termIds.length) await tx.insert(wikiPageTerms).values(termIds.map((termId) => ({ wikiPageId: incoming.id, termId })));
        await tx.insert(wikiPageRevisions).values({
          wikiPageId: incoming.id,
          revisionNumber: 1,
          snapshot: wikiSnapshot(created!, termIds),
          message: syncMessage(bundle, incoming.sourceRevision),
        });
        await queueWikiIndex(tx, incoming.id, 1);
        report.counts.wikiPages.created += 1;
        track("wiki_page", incoming.id, hash, 1);
      }

      // ---- 관계: 양 끝 용어가 이 서버에 있어야 한다.
      const localRelations = new Map<string, typeof termRelations.$inferSelect>();
      for (const batch of chunks(bundle.data.relations.map((r) => r.id))) {
        for (const row of await tx.select().from(termRelations).where(inArray(termRelations.id, batch))) localRelations.set(row.id, row);
      }
      for (const incoming of bundle.data.relations) {
        const hash = relationContentHash(incoming);
        const known = tracked.get(`relation:${incoming.id}`);
        const label = `${incoming.relationType}: ${incoming.sourceTermId} → ${incoming.targetTermId}`;
        if (!existingTermIds.has(incoming.sourceTermId) || !existingTermIds.has(incoming.targetTermId)) {
          issue("conflicts", { type: "relation", id: incoming.id, label, reason: "연결된 용어가 이 서버에 없어 관계를 가져오지 않았습니다." });
          continue;
        }
        const [sameTriple] = await tx.select({ id: termRelations.id }).from(termRelations).where(and(
          eq(termRelations.sourceTermId, incoming.sourceTermId),
          eq(termRelations.targetTermId, incoming.targetTermId),
          eq(termRelations.relationType, incoming.relationType),
        )).limit(1);
        const local = localRelations.get(incoming.id);
        if (sameTriple && sameTriple.id !== incoming.id) {
          issue("conflicts", { type: "relation", id: incoming.id, label, reason: "같은 관계가 이 서버에 이미 있어 가져오지 않았습니다." });
          continue;
        }
        const values = {
          sourceTermId: incoming.sourceTermId,
          targetTermId: incoming.targetTermId,
          relationType: incoming.relationType,
          status: "approved" as const,
          confidence: incoming.confidence,
          evidenceMd: incoming.evidenceMd,
          sourceRevision: null,
          targetRevision: null,
          reviewedAt: incoming.reviewedAt ? new Date(incoming.reviewedAt) : null,
        };
        if (local) {
          if (known?.contentHash === hash && local.status === "approved") { report.counts.relations.unchanged += 1; continue; }
          await tx.update(termRelations).set(values).where(eq(termRelations.id, incoming.id));
          report.counts.relations.updated += 1;
        } else {
          await tx.insert(termRelations).values({ id: incoming.id, ...values, createdAt: new Date(incoming.createdAt) });
          report.counts.relations.created += 1;
        }
        track("relation", incoming.id, hash, null);
      }

      // ---- 출처에서 사라진 분류 체계: 이 서버의 어떤 용어도 쓰지 않을 때만 지운다.
      for (const key of trackedIds("domain").filter((key) => !(key in bundle.manifest.domains))) {
        const [local] = await tx.select().from(domains).where(eq(domains.key, key));
        if (local) {
          const [usage] = await tx.select({ n: sql<number>`count(*)::int` }).from(terms).where(sql`${terms.domain} @> array[${local.label}]::text[]`);
          if ((usage?.n ?? 0) === 0) {
            await tx.delete(domains).where(eq(domains.key, key));
            report.counts.domains.deleted += 1;
          }
        }
        untrack("domain", key);
      }
      for (const key of trackedIds("business_category").filter((key) => !(key in bundle.manifest.businessCategories))) {
        const [usage] = await tx.select({ n: sql<number>`count(*)::int` }).from(terms).where(sql`${key} = any(${terms.category})`);
        if ((usage?.n ?? 0) === 0) {
          const deleted = await tx.delete(businessCategories).where(eq(businessCategories.key, key)).returning({ key: businessCategories.key });
          if (deleted.length) report.counts.businessCategories.deleted += 1;
        }
        untrack("business_category", key);
      }

      // ---- 누락 검사: manifest에는 있는데 이 번들에 실리지 않았고, 이 서버가 그 내용을 모르는 항목.
      // 변경분 번들 하나를 건너뛰었거나 이전 충돌로 못 들어온 항목이다.
      const included = new Set<string>([
        ...bundle.data.terms.map((t) => `term:${t.id}`),
        ...bundle.data.wikiPages.map((p) => `wiki_page:${p.id}`),
        ...bundle.data.relations.map((r) => `relation:${r.id}`),
      ]);
      for (const type of ["term", "wiki_page", "relation"] as const) {
        for (const [id, hash] of Object.entries(bundle.manifest[ENTITY_KEY[type]])) {
          if (included.has(`${type}:${id}`)) continue;
          if (tracked.get(`${type}:${id}`)?.contentHash === hash) continue;
          issue("stale", { type, id, label: id, reason: "이 서버에 반영되지 않은 이전 변경이 있습니다. 전체 번들로 다시 맞춰 주세요." });
        }
      }
      const missingAttachments = new Set(bundle.manifest.attachments);
      for (const batch of chunks(bundle.manifest.attachments)) {
        for (const row of await tx.select({ sha256: attachments.sha256 }).from(attachments).where(inArray(attachments.sha256, batch))) {
          missingAttachments.delete(row.sha256);
        }
      }
      for (const sha of missingAttachments) {
        issue("stale", { type: "attachment", id: sha, label: sha.slice(0, 12), reason: "본문이 참조하는 이미지가 이 서버에 없습니다. 전체 번들로 다시 맞춰 주세요." });
      }

      for (const { entityType, entityId } of trackDeletes) {
        await tx.delete(syncEntities).where(and(
          eq(syncEntities.sourceInstanceId, bundle.source.instanceId),
          eq(syncEntities.entityType, entityType),
          eq(syncEntities.entityId, entityId),
        ));
      }
      for (const batch of chunks([...trackUpserts.values()])) {
        await tx.insert(syncEntities).values(batch.map((row) => ({ ...row, sourceInstanceId: bundle.source.instanceId, syncedAt: new Date() })))
          .onConflictDoUpdate({
            target: [syncEntities.sourceInstanceId, syncEntities.entityType, syncEntities.entityId],
            set: {
              contentHash: sql`excluded.content_hash`,
              localRevision: sql`excluded.local_revision`,
              syncedAt: sql`excluded.synced_at`,
            },
          });
      }

      await tx.update(syncSources).set({
        label: bundle.source.label,
        lastBundleId: bundle.bundleId,
        lastExportedAt: new Date(bundle.exportedAt),
        lastImportedAt: new Date(report.importedAt),
        lastReport: report,
      }).where(eq(syncSources.instanceId, bundle.source.instanceId));

      if (options.dryRun) throw new DryRunRollback(report);
    });
  } catch (err) {
    if (err instanceof DryRunRollback) return err.report;
    throw err;
  }
  return report;
}

function syncMessage(bundle: SyncBundle, sourceRevision: number): string {
  return `sync: ${bundle.source.label} r${sourceRevision}`;
}

function wikiSnapshot(page: typeof wikiPages.$inferSelect, termIds: string[]) {
  return {
    page: {
      id: page.id,
      slug: page.slug,
      title: page.title,
      summary: page.summary,
      sourceUrl: page.sourceUrl,
      content: page.content,
      contentHash: page.contentHash,
      domain: page.domain,
      tags: page.tags,
      revision: page.revision,
      status: page.status,
    },
    termIds,
  };
}

async function writeTermChildren(
  tx: Tx,
  term: SyncTerm,
  maps: { slugOwner: Map<string, string>; aliasOwner: Map<string, string>; attachmentIdBySha: Map<string, string> },
  replace: boolean,
) {
  if (replace) {
    await tx.delete(termSurfaces).where(eq(termSurfaces.termId, term.id));
    await tx.delete(termSlugAliases).where(eq(termSlugAliases.termId, term.id));
    await tx.delete(attachmentRefs).where(eq(attachmentRefs.termId, term.id));
    for (const [slug, owner] of maps.aliasOwner) if (owner === term.id) maps.aliasOwner.delete(slug);
  }

  // 정규화 키는 출처 값을 믿지 않고 이 서버의 engine으로 다시 만든다. 양쪽 버전이
  // 달라 두 표기가 같은 키로 모이면 term_surfaces_unique가 가져오기 전체를 되돌리므로 합친다.
  const seen = new Set<string>();
  const surfaces = term.surfaces.flatMap((surface) => {
    const keys = surfaceKeys(surface.text);
    const dedupe = `${keys.normLoose}:${surface.kind}`;
    if (!keys.normLoose || seen.has(dedupe)) return [];
    seen.add(dedupe);
    return [{ termId: term.id, text: surface.text, lang: surface.lang, kind: surface.kind, caseSensitive: surface.caseSensitive, ...keys }];
  });
  const saved = surfaces.length ? await tx.insert(termSurfaces).values(surfaces).returning() : [];

  const aliases = [...new Set(term.slugAliases)].filter((slug) => {
    if (slug === term.slug) return false;
    const active = maps.slugOwner.get(slug);
    const retired = maps.aliasOwner.get(slug);
    return (!active || active === term.id) && (!retired || retired === term.id);
  });
  if (aliases.length) {
    await tx.insert(termSlugAliases).values(aliases.map((slug) => ({ slug, termId: term.id }))).onConflictDoNothing();
    for (const slug of aliases) maps.aliasOwner.set(slug, term.id);
  }

  const attachmentIds = [...new Set([...extractAttachmentHashes(term.bodyMd), ...extractAttachmentHashes(term.definitionMd)])]
    .flatMap((sha) => maps.attachmentIdBySha.get(sha) ?? []);
  if (attachmentIds.length) {
    await tx.insert(attachmentRefs).values(attachmentIds.map((attachmentId) => ({ attachmentId, termId: term.id }))).onConflictDoNothing();
  }
  return saved;
}
