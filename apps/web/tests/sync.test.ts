import { randomUUID } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { afterAll, expect, test } from "vitest";
import {
  businessCategories, createDb, domains, ragIndexQueue, syncExports, syncSources, termRelations, termRevisions,
  termSlugAliases, termSurfaces, terms, wikiPageRevisions, wikiPages, wikiPageTerms,
} from "@glossary/db";
import {
  canonicalJson, decodeSyncBundle, encodeSyncBundle, SyncBundleError, termContentHash, wikiPageContentHash,
  businessCategoryContentHash, domainContentHash, relationContentHash,
  type SyncBundle, type SyncTerm, type SyncWikiPage,
} from "../src/lib/sync/bundle.js";
import { buildSyncBundle, getInstanceId, recordSyncExport } from "../src/lib/sync/export.js";
import { applySyncBundle, SyncImportError } from "../src/lib/sync/import.js";
import { createTerm } from "../src/lib/terms/create.js";
import { updateTerm } from "../src/lib/terms/update.js";

const db = createDb(process.env.DATABASE_URL_TEST!);
const run = Math.random().toString(36).slice(2, 8);
const sourceInstanceId = randomUUID();
const createdTermIds: string[] = [];
const createdPageIds: string[] = [];
const createdDomainKeys: string[] = [];
const createdCategoryKeys: string[] = [];
const createdExportIds: string[] = [];

afterAll(async () => {
  if (createdPageIds.length) await db.delete(wikiPages).where(inArray(wikiPages.id, createdPageIds));
  if (createdTermIds.length) await db.delete(terms).where(inArray(terms.id, createdTermIds));
  if (createdDomainKeys.length) await db.delete(domains).where(inArray(domains.key, createdDomainKeys));
  if (createdCategoryKeys.length) await db.delete(businessCategories).where(inArray(businessCategories.key, createdCategoryKeys));
  if (createdExportIds.length) await db.delete(syncExports).where(inArray(syncExports.id, createdExportIds));
  await db.delete(syncSources).where(eq(syncSources.instanceId, sourceInstanceId));
});

let clock = Date.parse("2026-01-01T00:00:00Z");
function nextStamp(): string {
  clock += 60_000;
  return new Date(clock).toISOString();
}

function syncTerm(overrides: Partial<SyncTerm> = {}): SyncTerm {
  const id = overrides.id ?? randomUUID();
  createdTermIds.push(id);
  return {
    id,
    slug: `sync-${run}-${id.slice(0, 8)}`,
    qualityProfile: "auto",
    nameEn: `Sync ${run} ${id.slice(0, 4)}`,
    nameKo: `동기화 ${run}`,
    fullNameEn: null,
    fullNameKo: null,
    domain: [],
    category: [],
    topic: null,
    tags: [],
    definitionMd: "출처 서버에서 작성한 정의",
    bodyMd: null,
    replacedById: null,
    slugAliases: [],
    surfaces: [{ text: `Sync ${run} ${id.slice(0, 4)}`, lang: "en", kind: "canonical", caseSensitive: false }],
    sourceRevision: 1,
    createdAt: "2025-12-01T00:00:00.000Z",
    updatedAt: "2025-12-01T00:00:00.000Z",
    ...overrides,
  };
}

function syncPage(overrides: Partial<SyncWikiPage> = {}): SyncWikiPage {
  const id = overrides.id ?? randomUUID();
  createdPageIds.push(id);
  return {
    id,
    slug: `sync-wiki-${run}-${id.slice(0, 8)}`,
    title: "동기화 위키",
    summary: null,
    sourceUrl: null,
    content: "출처 서버의 위키 본문",
    domain: [],
    status: "published",
    termIds: [],
    sourceRevision: 1,
    reviewedAt: "2025-12-01T00:00:00.000Z",
    createdAt: "2025-12-01T00:00:00.000Z",
    updatedAt: "2025-12-01T00:00:00.000Z",
    ...overrides,
  };
}

type BundleData = SyncBundle["data"];
function bundleOf(data: Partial<BundleData>, options: { mode?: "full" | "incremental"; manifestExtra?: Partial<Record<keyof BundleData, SyncTerm[] | SyncWikiPage[]>> } = {}): SyncBundle {
  const full: BundleData = { domains: [], businessCategories: [], terms: [], wikiPages: [], relations: [], attachments: [], ...data };
  const manifestTerms = [...full.terms, ...((options.manifestExtra?.terms as SyncTerm[] | undefined) ?? [])];
  return {
    format: "geniuskey.glossary.sync",
    version: 1,
    bundleId: randomUUID(),
    mode: options.mode ?? "full",
    baseBundleId: null,
    source: { instanceId: sourceInstanceId, label: "macstudio", appVersion: "test" },
    exportedAt: nextStamp(),
    manifest: {
      terms: Object.fromEntries(manifestTerms.map((t) => [t.id, termContentHash(t)])),
      wikiPages: Object.fromEntries(full.wikiPages.map((p) => [p.id, wikiPageContentHash(p)])),
      relations: Object.fromEntries(full.relations.map((r) => [r.id, relationContentHash(r)])),
      domains: Object.fromEntries(full.domains.map((d) => [d.key, domainContentHash(d)])),
      businessCategories: Object.fromEntries(full.businessCategories.map((c) => [c.key, businessCategoryContentHash(c)])),
      attachments: [],
    },
    data: full,
  };
}

async function revisionsOf(termId: string) {
  return db.select().from(termRevisions).where(eq(termRevisions.termId, termId)).orderBy(termRevisions.revisionNumber);
}

test("해시는 객체 키 순서와 시각·리비전 번호에 흔들리지 않는다", () => {
  expect(canonicalJson({ b: 1, a: [{ d: 2, c: 3 }] })).toBe(canonicalJson({ a: [{ c: 3, d: 2 }], b: 1 }));
  const term = syncTerm();
  expect(termContentHash({ ...term, sourceRevision: 9, updatedAt: "2030-01-01T00:00:00.000Z" })).toBe(termContentHash(term));
  expect(termContentHash({ ...term, definitionMd: "다른 정의" })).not.toBe(termContentHash(term));
  expect(termContentHash({ ...term, surfaces: [...term.surfaces].reverse() })).toBe(termContentHash(term));
});

test("번들은 gzip으로 왕복하고, 형식이 다른 파일은 이유와 함께 거부한다", () => {
  const bundle = bundleOf({ terms: [syncTerm()] });
  expect(decodeSyncBundle(encodeSyncBundle(bundle))).toEqual(bundle);
  expect(decodeSyncBundle(Buffer.from(JSON.stringify(bundle)))).toEqual(bundle);
  expect(() => decodeSyncBundle(Buffer.from(JSON.stringify({ format: "geniuskey.glossary.snapshot", version: 1 })))).toThrow(SyncBundleError);
  expect(() => decodeSyncBundle(Buffer.from(JSON.stringify({ ...bundle, version: 2 })))).toThrow(/버전/);
  expect(() => decodeSyncBundle(encodeSyncBundle(bundle).subarray(0, 40))).toThrow(SyncBundleError);
});

test("전체 번들이 용어·표기·옛 주소·위키·관계·분류를 같은 id로 만들고, 다시 넣으면 아무것도 바뀌지 않는다", async () => {
  const domainLabel = `동기화도메인${run}`;
  const categoryKey = `sync-cat-${run}`;
  createdDomainKeys.push(`sync-domain-${run}`);
  createdCategoryKeys.push(categoryKey);
  const a = syncTerm({ domain: [domainLabel], category: [categoryKey], slugAliases: [`sync-old-${run}`] });
  const b = syncTerm();
  const page = syncPage({ termIds: [a.id, b.id] });
  const relation = {
    id: randomUUID(), sourceTermId: a.id, targetTermId: b.id, relationType: "related_to" as const,
    confidence: 90, evidenceMd: null, createdAt: "2025-12-01T00:00:00.000Z", reviewedAt: "2025-12-01T00:00:00.000Z",
  };
  const bundle = bundleOf({
    domains: [{ key: `sync-domain-${run}`, label: domainLabel, labelEn: null, color: `test-${run}`, sortOrder: 99 }],
    businessCategories: [{ key: categoryKey, label: `동기화분류${run}`, labelEn: null, sortOrder: 99 }],
    terms: [a, b],
    wikiPages: [page],
    relations: [relation],
  });

  const preview = await applySyncBundle(bundle, { dryRun: true });
  expect(preview.counts.terms.created).toBe(2);
  expect(await db.select().from(terms).where(eq(terms.id, a.id))).toHaveLength(0);

  const report = await applySyncBundle(bundle);
  expect(report.counts.terms.created).toBe(2);
  expect(report.counts.wikiPages.created).toBe(1);
  expect(report.counts.relations.created).toBe(1);
  expect(report.counts.domains.created).toBe(1);
  expect(report.counts.businessCategories.created).toBe(1);

  const [stored] = await db.select().from(terms).where(eq(terms.id, a.id));
  expect(stored).toMatchObject({ slug: a.slug, domain: [domainLabel], category: [categoryKey], ownerId: null });
  expect(await db.select().from(termSurfaces).where(eq(termSurfaces.termId, a.id))).toHaveLength(1);
  expect(await db.select().from(termSlugAliases).where(eq(termSlugAliases.termId, a.id))).toEqual([
    expect.objectContaining({ slug: `sync-old-${run}` }),
  ]);
  const revisions = await revisionsOf(a.id);
  expect(revisions.map((r) => r.message)).toEqual(["sync: macstudio r1"]);
  expect(await db.select().from(ragIndexQueue).where(eq(ragIndexQueue.termId, a.id))).toHaveLength(1);
  expect((await db.select().from(wikiPageTerms).where(eq(wikiPageTerms.wikiPageId, page.id))).map((r) => r.termId).sort())
    .toEqual([a.id, b.id].sort());
  expect(await db.select().from(termRelations).where(eq(termRelations.id, relation.id))).toEqual([
    expect.objectContaining({ status: "approved", sourceRevision: null }),
  ]);

  const again = await applySyncBundle({ ...bundle, bundleId: randomUUID(), exportedAt: nextStamp() });
  expect(again.counts.terms).toMatchObject({ created: 0, updated: 0, unchanged: 2 });
  expect(again.counts.wikiPages.unchanged).toBe(1);
  expect(again.counts.relations.unchanged).toBe(1);
  expect(await revisionsOf(a.id)).toHaveLength(1);
});

test("출처가 고친 용어는 새 리비전으로 반영되고, 오래된 번들과 자기 번들은 거부된다", async () => {
  const term = syncTerm();
  await applySyncBundle(bundleOf({ terms: [term] }));
  const newer = bundleOf({ terms: [{ ...term, definitionMd: "출처에서 고친 정의", sourceRevision: 2 }] });
  const stale = bundleOf({ terms: [term] });
  stale.exportedAt = new Date(clock - 3_600_000).toISOString();

  const report = await applySyncBundle(newer);
  expect(report.counts.terms.updated).toBe(1);
  expect((await revisionsOf(term.id)).map((r) => r.message)).toEqual(["sync: macstudio r1", "sync: macstudio r2"]);

  await expect(applySyncBundle(stale)).rejects.toMatchObject({ code: "older_bundle" });
  const own = bundleOf({ terms: [] });
  own.source.instanceId = await getInstanceId();
  await expect(applySyncBundle(own)).rejects.toBeInstanceOf(SyncImportError);
});

test("이 서버에서 고친 용어: 출처가 그대로면 두고, 둘 다 바뀌면 정책에 따라 덮거나 남긴다", async () => {
  const term = syncTerm();
  await applySyncBundle(bundleOf({ terms: [term] }));
  const edited = await updateTerm(term.id, { definitionMd: "사내에서 고친 정의" }, null);
  expect("term" in edited).toBe(true);

  const untouched = await applySyncBundle(bundleOf({ terms: [term] }));
  expect(untouched.counts.terms.unchanged).toBe(1);
  expect((await db.select().from(terms).where(eq(terms.id, term.id)))[0]!.definitionMd).toBe("사내에서 고친 정의");

  const changed = { ...term, definitionMd: "출처도 고친 정의", sourceRevision: 2 };
  const kept = await applySyncBundle(bundleOf({ terms: [changed] }), { localEdits: "keep" });
  expect(kept.issueTotals.kept).toBe(1);
  expect((await db.select().from(terms).where(eq(terms.id, term.id)))[0]!.definitionMd).toBe("사내에서 고친 정의");

  const overwritten = await applySyncBundle(bundleOf({ terms: [changed] }));
  expect(overwritten.overwritten).toEqual([expect.objectContaining({ id: term.id })]);
  expect((await db.select().from(terms).where(eq(terms.id, term.id)))[0]!.definitionMd).toBe("출처도 고친 정의");
});

test("출처에서 사라진 항목은 지우지만, 이 서버에서 직접 만든 용어는 건드리지 않는다", async () => {
  const doomed = syncTerm();
  const page = syncPage();
  await applySyncBundle(bundleOf({ terms: [doomed], wikiPages: [page] }));
  const local = await createTerm({ nameEn: `Local ${run}`, nameKo: "사내 전용 용어", domain: [], category: [], surfaces: [] }, null);
  createdTermIds.push(local.term.id);

  const report = await applySyncBundle(bundleOf({}));
  expect(report.counts.terms.deleted).toBeGreaterThanOrEqual(1);
  expect(report.counts.wikiPages.deleted).toBeGreaterThanOrEqual(1);
  expect(await db.select().from(terms).where(eq(terms.id, doomed.id))).toHaveLength(0);
  expect(await db.select().from(wikiPages).where(eq(wikiPages.id, page.id))).toHaveLength(0);
  expect(await db.select().from(terms).where(eq(terms.id, local.term.id))).toHaveLength(1);
});

test("주소가 이 서버의 다른 용어와 겹치면 건너뛰고 충돌로 알린다", async () => {
  const local = await createTerm({ nameEn: `Clash ${run}`, nameKo: "사내 충돌 용어", domain: [], category: [], surfaces: [] }, null);
  createdTermIds.push(local.term.id);
  const incoming = syncTerm({ slug: local.term.slug });
  const report = await applySyncBundle(bundleOf({ terms: [incoming] }));
  expect(report.conflicts).toEqual([expect.objectContaining({ id: incoming.id, type: "term" })]);
  expect(await db.select().from(terms).where(eq(terms.id, incoming.id))).toHaveLength(0);
});

test("변경분 번들 하나를 건너뛰면 manifest와 어긋난 항목을 누락으로 알린다", async () => {
  const known = syncTerm();
  await applySyncBundle(bundleOf({ terms: [known] }));
  const missed = { ...known, definitionMd: "놓친 변경분의 정의", sourceRevision: 2 };
  const neverSeen = syncTerm();
  const report = await applySyncBundle(bundleOf({}, { mode: "incremental", manifestExtra: { terms: [missed, neverSeen] } }));
  expect(report.stale.map((item) => item.id).sort()).toEqual([known.id, neverSeen.id].sort());
  expect(report.counts.terms.deleted).toBe(0);
});

test("업무 분류는 이름이 같으면 이 서버의 키로 옮겨 적는다", async () => {
  const localKey = `local-cat-${run}`;
  const label = `사내분류${run}`;
  createdCategoryKeys.push(localKey, `remote-cat-${run}`);
  await db.insert(businessCategories).values({ key: localKey, label, sortOrder: 0 });
  const term = syncTerm({ category: [`remote-cat-${run}`] });
  const report = await applySyncBundle(bundleOf({
    businessCategories: [{ key: `remote-cat-${run}`, label, labelEn: null, sortOrder: 0 }],
    terms: [term],
  }));
  expect(report.counts.businessCategories.unchanged).toBe(1);
  expect((await db.select().from(terms).where(eq(terms.id, term.id)))[0]!.category).toEqual([localKey]);
  expect(await db.select().from(businessCategories).where(eq(businessCategories.key, `remote-cat-${run}`))).toHaveLength(0);
});

test("내보내기: 전체 번들은 이 서버의 용어를 싣고, 변경분은 기준 이후 바뀐 용어만 싣는다", async () => {
  const created = await createTerm({ nameEn: `Export ${run}`, nameKo: "내보내기 확인", domain: [], category: [], surfaces: [] }, null);
  createdTermIds.push(created.term.id);

  const full = await buildSyncBundle({ mode: "full", label: "test" });
  createdExportIds.push(full.bundleId);
  expect(full.data.terms.map((t) => t.id)).toContain(created.term.id);
  expect(full.manifest.terms[created.term.id]).toBe(termContentHash(full.data.terms.find((t) => t.id === created.term.id)!));
  await recordSyncExport(full, 0);

  await updateTerm(created.term.id, { definitionMd: "내보낸 뒤 고친 정의" }, null);
  const incremental = await buildSyncBundle({ mode: "incremental", label: "test" });
  createdExportIds.push(incremental.bundleId);
  expect(incremental.baseBundleId).toBe(full.bundleId);
  expect(incremental.data.terms.map((t) => t.id)).toEqual([created.term.id]);
  expect(Object.keys(incremental.manifest.terms)).toEqual(Object.keys(full.manifest.terms));
  expect(decodeSyncBundle(encodeSyncBundle(incremental)).bundleId).toBe(incremental.bundleId);
});

test("위키 수정은 위키 리비전을 올리고 연결 용어를 교체한다", async () => {
  const term = syncTerm();
  const page = syncPage();
  await applySyncBundle(bundleOf({ terms: [term], wikiPages: [page] }));
  await applySyncBundle(bundleOf({ terms: [term], wikiPages: [{ ...page, content: "고친 본문", termIds: [term.id], sourceRevision: 2 }] }));
  const [stored] = await db.select().from(wikiPages).where(eq(wikiPages.id, page.id));
  expect(stored).toMatchObject({ content: "고친 본문", revision: 2 });
  expect(await db.select().from(wikiPageRevisions).where(eq(wikiPageRevisions.wikiPageId, page.id))).toHaveLength(2);
  expect(await db.select().from(wikiPageTerms).where(eq(wikiPageTerms.wikiPageId, page.id))).toEqual([
    expect.objectContaining({ termId: term.id }),
  ]);
});
