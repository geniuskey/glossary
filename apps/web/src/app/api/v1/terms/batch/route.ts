import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v3";
import { surfaceKeys, termBatchReceipts } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { getDb } from "@/lib/db";
import { isUniqueViolation } from "@/lib/postgres-error";
import { businessCategoriesExist } from "@/lib/terms/categories";
import { resolveDomains } from "@/lib/terms/domains";
import { createTerm, findDuplicates, findRepresentativeDuplicates } from "@/lib/terms/create";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { termInputSchema, termPatchSchema, type TermInput } from "@/lib/terms/schema";
import { deriveSurfaces } from "@/lib/terms/surfaces";
import { currentRevisionNumber, updateTerm } from "@/lib/terms/update";
import { toSurfaceWire, toTermWire, toWarningWire } from "@/lib/terms/wire";
import { isAssignableUserId } from "@/lib/terms/owners";
import { recordAuditEvent } from "@/lib/audit";
import { scheduleAfterResponse } from "@/lib/after-response";
import { prepareAutoReview } from "@/lib/ai/auto-review";
import { scheduleRagIndexing } from "@/lib/rag/indexer";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const rowSchema = z.object({
  key: z.string().min(1).max(100),
  operation: z.enum(["create", "update"]),
  idOrSlug: z.string().min(1).optional(),
  expectedRevision: z.number().int().positive().optional(),
  term: z.unknown(),
}).strict();
const batchSchema = z.object({
  dryRun: z.boolean().default(true),
  items: z.array(rowSchema).min(1).max(100),
}).strict();

type BatchRow = z.infer<typeof rowSchema>;
type RowResult = Record<string, unknown> & { key: string; outcome: string };

function hash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function receiptWhere(actor: string, batchKey: string, rowKey: string) {
  return and(eq(termBatchReceipts.actor, actor), eq(termBatchReceipts.batchKey, batchKey), eq(termBatchReceipts.rowKey, rowKey));
}

async function priorResult(actor: string, batchKey: string, row: BatchRow): Promise<RowResult | Response | null> {
  const [prior] = await getDb().select().from(termBatchReceipts).where(receiptWhere(actor, batchKey, row.key));
  if (!prior) return null;
  if (prior.payloadHash !== hash(row)) return apiError("operation_conflict", "같은 Idempotency-Key와 행 key에 다른 입력을 사용할 수 없습니다.", 409);
  return prior.result as RowResult;
}

async function validateRow(row: BatchRow): Promise<
  | { error: RowResult }
  | { data: Record<string, unknown>; existingId?: string; warnings?: ReturnType<typeof toWarningWire>[] }
> {
  if (row.operation === "create" && row.idOrSlug) return { error: { key: row.key, outcome: "invalid", message: "create에는 idOrSlug를 보내지 마세요." } };
  if (row.operation === "update" && (!row.idOrSlug || !row.expectedRevision)) {
    return { error: { key: row.key, outcome: "invalid", message: "update에는 idOrSlug와 expectedRevision이 필요합니다." } };
  }
  const parsed = (row.operation === "create" ? termInputSchema : termPatchSchema).safeParse(row.term);
  if (!parsed.success) return { error: { key: row.key, outcome: "invalid", details: parsed.error.flatten() } };
  const data = parsed.data as Record<string, unknown>;
  if (typeof data.ownerId === "string" && !(await isAssignableUserId(data.ownerId))) {
    return { error: { key: row.key, outcome: "invalid", field: "ownerId" } };
  }
  let existingId: string | undefined;
  if (row.operation === "update") {
    const existing = await getTermByIdOrSlug(row.idOrSlug!);
    if (!existing) return { error: { key: row.key, outcome: "not_found" } };
    existingId = existing.id;
    const currentRevision = await currentRevisionNumber(existing.id);
    if (currentRevision !== row.expectedRevision) return { error: { key: row.key, outcome: "revision_conflict", currentRevision } };
  }
  if (Array.isArray(data.domain)) {
    const existing = existingId ? await getTermByIdOrSlug(existingId) : null;
    const domains = await resolveDomains(data.domain as string[], existing?.domain ?? []);
    if (domains.unknown.length) return { error: { key: row.key, outcome: "invalid", field: "domain", unknown: domains.unknown } };
    data.domain = domains.labels;
  }
  if (Array.isArray(data.category) && !(await businessCategoriesExist(data.category as string[]))) {
    return { error: { key: row.key, outcome: "invalid", field: "category" } };
  }
  if (row.operation === "create") {
    const duplicates = await findRepresentativeDuplicates(data as Parameters<typeof findRepresentativeDuplicates>[0]);
    if (duplicates.length) return { error: { key: row.key, outcome: "duplicate", conflicts: duplicates.map((d) => ({ field: d.field, text: d.text, slugs: d.matches.map((m) => m.conflictingSlug) })) } };
    const input = data as TermInput;
    const warnings = (await findDuplicates(deriveSurfaces(input, input.surfaces))).map(toWarningWire);
    return { data, warnings };
  } else if (data.nameEn !== undefined || data.nameKo !== undefined) {
    const duplicates = await findRepresentativeDuplicates({
      nameEn: typeof data.nameEn === "string" ? data.nameEn : undefined,
      nameKo: typeof data.nameKo === "string" ? data.nameKo : undefined,
    }, existingId);
    if (duplicates.length) return { error: { key: row.key, outcome: "duplicate", conflicts: duplicates.map((d) => ({ field: d.field, text: d.text, slugs: d.matches.map((m) => m.conflictingSlug) })) } };
  }
  return { data, existingId };
}

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const size = Number(request.headers.get("content-length") ?? "0");
  if (size > 2_000_000) return apiError("payload_too_large", "JSON 본문은 2MB 이하여야 합니다.", 413);
  const raw = await request.text();
  if (Buffer.byteLength(raw) > 2_000_000) return apiError("payload_too_large", "JSON 본문은 2MB 이하여야 합니다.", 413);
  let body: unknown;
  try { body = JSON.parse(raw); } catch { return apiError("validation_failed", "JSON 본문이 올바르지 않습니다.", 400); }
  const parsed = batchSchema.safeParse(body);
  if (!parsed.success) return apiError("validation_failed", "일괄 입력이 올바르지 않습니다.", 400, parsed.error.flatten());
  const { dryRun, items } = parsed.data;
  if (new Set(items.map((row) => row.key)).size !== items.length) return apiError("validation_failed", "행 key가 중복되었습니다.", 400);
  const batchKey = request.headers.get("Idempotency-Key")?.trim();
  if (!dryRun && (!batchKey || batchKey.length > 200)) return apiError("validation_failed", "반영 요청에는 Idempotency-Key 헤더가 필요합니다(최대 200자).", 400);
  const actor = auth.kind === "user" ? `user:${auth.user.id}` : `key:${auth.keyId}`;
  const authorId = auth.kind === "user" ? auth.user.id : null;
  const authorKeyId = auth.kind === "key" ? auth.keyId : null;
  const results: RowResult[] = [];
  const seenNames = new Map<string, string>();

  for (const row of items) {
    if (!dryRun) {
      const prior = await priorResult(actor, batchKey!, row);
      if (prior instanceof Response) return prior;
      if (prior) { results.push({ ...prior, replayed: true }); continue; }
    }
    const validation = await validateRow(row);
    if ("error" in validation) {
      if (!dryRun) {
        const prior = await priorResult(actor, batchKey!, row);
        if (prior instanceof Response) return prior;
        if (prior) { results.push({ ...prior, replayed: true }); continue; }
      }
      results.push(validation.error);
      continue;
    }
    if (dryRun && row.operation === "create") {
      const names = [validation.data.nameEn, validation.data.nameKo]
        .filter((value): value is string => typeof value === "string")
        .map((value) => surfaceKeys(value).normLoose);
      const earlier = names.map((name) => seenNames.get(name)).find(Boolean);
      if (earlier) { results.push({ key: row.key, outcome: "duplicate", conflictingRowKey: earlier }); continue; }
      for (const name of names) seenNames.set(name, row.key);
    }
    if (dryRun) { results.push({ key: row.key, outcome: row.operation === "create" ? "would_create" : "would_update", warnings: validation.warnings ?? [] }); continue; }
    const saveReceipt = async (tx: Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0], result: RowResult) => {
      await tx.insert(termBatchReceipts).values({ actor, batchKey: batchKey!, rowKey: row.key, payloadHash: hash(row), result });
    };
    try {
      let result: RowResult;
      if (row.operation === "create") {
        const saved = await createTerm(validation.data as Parameters<typeof createTerm>[0], authorId, authorKeyId,
          async (tx, term, surfaces, warnings) => saveReceipt(tx, { key: row.key, outcome: "created", term: toTermWire(term), surfaces: surfaces.map(toSurfaceWire), warnings: warnings.map(toWarningWire) }));
        result = { key: row.key, outcome: "created", term: toTermWire(saved.term), surfaces: saved.surfaces.map(toSurfaceWire), warnings: saved.warnings.map(toWarningWire) };
      } else {
        const saved = await updateTerm(validation.existingId!, validation.data as Parameters<typeof updateTerm>[1], authorId, row.expectedRevision, authorKeyId, "batch update",
          async (tx, revision, term, surfaces, warnings) => saveReceipt(tx, { key: row.key, outcome: "updated", revision, term: toTermWire(term), surfaces: surfaces.map(toSurfaceWire), warnings: warnings.map(toWarningWire) }));
        if ("conflict" in saved) { results.push({ key: row.key, outcome: "revision_conflict", currentRevision: saved.currentRevision }); continue; }
        if ("notFound" in saved) { results.push({ key: row.key, outcome: "not_found" }); continue; }
        if ("invalid" in saved) { results.push({ key: row.key, outcome: "invalid", issues: saved.issues }); continue; }
        if ("representativeConflict" in saved) { results.push({ key: row.key, outcome: "duplicate", conflicts: saved.duplicates }); continue; }
        if ("slugConflict" in saved) { results.push({ key: row.key, outcome: "slug_conflict" }); continue; }
        result = { key: row.key, outcome: "updated", revision: row.expectedRevision! + 1, term: toTermWire(saved.term), surfaces: saved.surfaces.map(toSurfaceWire), warnings: saved.warnings.map(toWarningWire) };
      }
      results.push(result);
      const term = result.term as { id: string; status: string };
      await recordAuditEvent({ action: row.operation === "create" ? "term.create" : "term.update", targetType: "term", targetId: term.id,
        actor: auth.kind === "user" ? { userId: auth.user.id } : { keyId: auth.keyId }, metadata: { status: term.status } });
      scheduleAfterResponse(() => prepareAutoReview(term.id));
      scheduleRagIndexing(1);
    } catch (error) {
      if (isUniqueViolation(error, ["term_batch_receipts_pk"])) {
        const prior = await priorResult(actor, batchKey!, row);
        if (prior instanceof Response) return prior;
        if (prior) { results.push({ ...prior, replayed: true }); continue; }
      }
      throw error;
    }
  }
  return Response.json({ dryRun, results });
});
