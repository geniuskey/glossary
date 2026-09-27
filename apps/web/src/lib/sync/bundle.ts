import { createHash } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { z } from "zod";

export const SYNC_BUNDLE_FORMAT = "geniuskey.glossary.sync";
export const SYNC_BUNDLE_VERSION = 1;
export const SYNC_BUNDLE_EXTENSION = ".glossary-sync.json.gz";
/** 이미지 첨부가 번들 크기를 좌우한다. 요청 하나가 메모리에 올릴 수 있는 상한이다. */
export const MAX_SYNC_BUNDLE_BYTES = 512 * 1024 * 1024;

const isoDate = z.string().datetime({ offset: true });
const nullableText = z.string().nullable();

export const syncSurfaceSchema = z.object({
  text: z.string().min(1),
  lang: z.enum(["en", "ko", "neutral"]),
  kind: z.enum(["canonical", "abbreviation", "full_name", "alias", "discouraged", "forbidden"]),
  caseSensitive: z.boolean(),
});

export const syncTermSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  qualityProfile: z.enum(["auto", "mapping", "context", "guidance"]),
  nameEn: nullableText,
  nameKo: nullableText,
  fullNameEn: nullableText,
  fullNameKo: nullableText,
  domain: z.array(z.string()),
  category: z.array(z.string()),
  topic: nullableText,
  tags: z.array(z.string()),
  definitionMd: nullableText,
  bodyMd: nullableText,
  replacedById: z.string().uuid().nullable(),
  slugAliases: z.array(z.string()),
  surfaces: z.array(syncSurfaceSchema),
  sourceRevision: z.number().int().nonnegative(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const syncWikiPageSchema = z.object({
  id: z.string().uuid(),
  slug: z.string().min(1),
  title: z.string().min(1),
  summary: nullableText,
  sourceUrl: nullableText,
  content: z.string().min(1),
  domain: z.array(z.string()),
  status: z.enum(["draft", "published", "archived"]),
  termIds: z.array(z.string().uuid()),
  sourceRevision: z.number().int().positive(),
  reviewedAt: isoDate.nullable(),
  createdAt: isoDate,
  updatedAt: isoDate,
});

export const syncRelationSchema = z.object({
  id: z.string().uuid(),
  sourceTermId: z.string().uuid(),
  targetTermId: z.string().uuid(),
  relationType: z.enum(["related_to", "is_a", "part_of", "used_in", "prerequisite_of", "replaces"]),
  confidence: z.number().int().min(0).max(100),
  evidenceMd: nullableText,
  createdAt: isoDate,
  reviewedAt: isoDate.nullable(),
});

export const syncDomainSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  labelEn: nullableText,
  color: z.string().min(1),
  sortOrder: z.number().int(),
});

export const syncBusinessCategorySchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  labelEn: nullableText,
  sortOrder: z.number().int(),
});

export const syncAttachmentSchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  storedMime: z.string(),
  byteSize: z.number().int().nonnegative(),
  width: z.number().int(),
  height: z.number().int(),
  originalFilename: z.string(),
  originalMime: z.string(),
  originalBytes: z.number().int().nonnegative(),
  dataBase64: z.string(),
});

const hashMap = z.record(z.string(), z.string());

export const syncManifestSchema = z.object({
  terms: hashMap,
  wikiPages: hashMap,
  relations: hashMap,
  domains: hashMap,
  businessCategories: hashMap,
  attachments: z.array(z.string()),
});

export const syncBundleSchema = z.object({
  format: z.literal(SYNC_BUNDLE_FORMAT),
  version: z.literal(SYNC_BUNDLE_VERSION),
  bundleId: z.string().uuid(),
  mode: z.enum(["full", "incremental"]),
  baseBundleId: z.string().uuid().nullable(),
  source: z.object({
    instanceId: z.string().uuid(),
    label: z.string().min(1),
    appVersion: z.string().nullable(),
  }),
  exportedAt: isoDate,
  manifest: syncManifestSchema,
  data: z.object({
    domains: z.array(syncDomainSchema),
    businessCategories: z.array(syncBusinessCategorySchema),
    terms: z.array(syncTermSchema),
    wikiPages: z.array(syncWikiPageSchema),
    relations: z.array(syncRelationSchema),
    attachments: z.array(syncAttachmentSchema),
  }),
});

export type SyncSurface = z.infer<typeof syncSurfaceSchema>;
export type SyncTerm = z.infer<typeof syncTermSchema>;
export type SyncWikiPage = z.infer<typeof syncWikiPageSchema>;
export type SyncRelation = z.infer<typeof syncRelationSchema>;
export type SyncDomain = z.infer<typeof syncDomainSchema>;
export type SyncBusinessCategory = z.infer<typeof syncBusinessCategorySchema>;
export type SyncAttachment = z.infer<typeof syncAttachmentSchema>;
export type SyncManifest = z.infer<typeof syncManifestSchema>;
export type SyncBundle = z.infer<typeof syncBundleSchema>;
export type SyncEntityKey = Exclude<keyof SyncManifest, "attachments">;

/** 객체 키 순서와 무관한 JSON. 같은 내용이 같은 해시를 내야 변경분 판정이 흔들리지 않는다. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function sortedSurfaces(surfaces: readonly SyncSurface[]): SyncSurface[] {
  return [...surfaces].sort((a, b) => canonicalJson(a).localeCompare(canonicalJson(b)));
}

// 해시에는 내용만 넣는다. 리비전 번호·시각은 받는 쪽에서 다시 매겨지므로 넣으면
// 내용이 같아도 매번 "변경"으로 보여 리비전만 쌓인다. status는 받는 쪽 작성 기준으로
// 다시 판정하는 캐시라 뺀다.
export function termContentHash(term: SyncTerm): string {
  return sha256(canonicalJson({
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
    slugAliases: [...term.slugAliases].sort(),
    surfaces: sortedSurfaces(term.surfaces),
  }));
}

export function wikiPageContentHash(page: SyncWikiPage): string {
  return sha256(canonicalJson({
    slug: page.slug,
    title: page.title,
    summary: page.summary,
    sourceUrl: page.sourceUrl,
    content: page.content,
    domain: page.domain,
    status: page.status,
    termIds: [...page.termIds].sort(),
  }));
}

export function relationContentHash(relation: SyncRelation): string {
  return sha256(canonicalJson({
    sourceTermId: relation.sourceTermId,
    targetTermId: relation.targetTermId,
    relationType: relation.relationType,
    confidence: relation.confidence,
    evidenceMd: relation.evidenceMd,
  }));
}

export function domainContentHash(domain: SyncDomain): string {
  return sha256(canonicalJson(domain));
}

export function businessCategoryContentHash(category: SyncBusinessCategory): string {
  return sha256(canonicalJson(category));
}

export function encodeSyncBundle(bundle: SyncBundle): Buffer {
  return gzipSync(Buffer.from(JSON.stringify(bundle), "utf8"));
}

export class SyncBundleError extends Error {}

/** gzip 여부는 매직 바이트로 판정한다 — 사람이 풀어 둔 .json도 그대로 받는다. */
export function decodeSyncBundle(bytes: Uint8Array): SyncBundle {
  let text: string;
  try {
    const raw = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes) : Buffer.from(bytes);
    text = raw.toString("utf8");
  } catch {
    throw new SyncBundleError("번들 압축을 풀 수 없습니다. 파일이 손상되었는지 확인해 주세요.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new SyncBundleError("번들이 올바른 JSON이 아닙니다. 파일이 잘렸는지 확인해 주세요.");
  }
  const record = parsed as { format?: unknown; version?: unknown } | null;
  if (record?.format !== SYNC_BUNDLE_FORMAT) {
    throw new SyncBundleError("동기화 번들이 아닙니다. 관리자 > 동기화에서 내보낸 파일을 사용해 주세요.");
  }
  if (record.version !== SYNC_BUNDLE_VERSION) {
    throw new SyncBundleError(`지원하지 않는 번들 버전입니다 (${String(record.version)}). 양쪽 서버 버전을 맞춰 주세요.`);
  }
  const result = syncBundleSchema.safeParse(parsed);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new SyncBundleError(`번들 내용이 올바르지 않습니다: ${issue ? `${issue.path.join(".")} ${issue.message}` : "알 수 없는 오류"}`);
  }
  return result.data;
}

export function syncBundleFilename(bundle: Pick<SyncBundle, "exportedAt" | "mode" | "source">): string {
  const stamp = bundle.exportedAt.replace(/\.\d+Z$/, "Z").replace(/[:]/g, "").replace("T", "-");
  const label = bundle.source.label.replace(/[^A-Za-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "glossary";
  return `${label}-${stamp}-${bundle.mode}${SYNC_BUNDLE_EXTENSION}`;
}
