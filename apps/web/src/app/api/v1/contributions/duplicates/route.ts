import { z } from "zod/v3";
import { sql } from "drizzle-orm";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { getDb } from "@/lib/db";
import { duplicateCandidates, duplicateInputSchema, reviewDuplicates } from "@/lib/ai/duplicate-review";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { currentRevisionNumber } from "@/lib/terms/update";
import { mergeTerms } from "@/lib/terms/merge";

const ALLOWED_METHODS = ["GET", "POST", "PATCH"];
const { PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, DELETE, OPTIONS };

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read"); if (isResponse(auth)) return auth;
  const page = Math.max(1, Math.min(100000, Number.parseInt(new URL(request.url).searchParams.get("page") ?? "1", 10) || 1));
  const items = await getDb().execute(sql`
    select t.id, t.slug, t.name_en as "nameEn", t.name_ko as "nameKo", t.definition_md as "definitionMd"
    from terms t where t.replaced_by_id is null and (
      t.slug ~ '-[0-9]+$' or exists (
        select 1 from term_surfaces a join term_surfaces b on a.norm_loose = b.norm_loose and a.term_id <> b.term_id
        join terms other on other.id = b.term_id and other.replaced_by_id is null where a.term_id = t.id
      )) order by t.slug limit 50 offset ${(page - 1) * 50}
  `);
  return Response.json({ items, page });
});

const reviewSchema = z.union([
  z.object({ termId: z.string().uuid() }),
  z.object({ source: duplicateInputSchema.extend({ id: z.string().regex(/^row:\d+$/) }), candidates: z.array(duplicateInputSchema.extend({ id: z.string().regex(/^row:\d+$/) })).max(30).default([]) }),
]);
export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write"); if (isResponse(auth)) return auth;
  const raw = await request.text();
  if (raw.length > 200000) return apiError("payload_too_large", "검토 자료가 너무 큽니다.", 413);
  let value; try { value = JSON.parse(raw); } catch { return apiError("validation_failed", "검토 자료를 확인해 주세요.", 400); }
  const parsed = reviewSchema.safeParse(value);
  if (!parsed.success) return apiError("validation_failed", "검토 자료를 확인해 주세요.", 400);
  const data = parsed.data;
  const revision = "termId" in data ? await currentRevisionNumber(data.termId) : undefined;
  const source = "termId" in data ? await getTermByIdOrSlug(data.termId) : data.source;
  if (!source) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  if ("termId" in data && await currentRevisionNumber(data.termId) !== revision) return apiError("revision_conflict", "용어가 변경되었습니다. 다시 검토해 주세요.", 409);
  const storedCandidates = await duplicateCandidates(source);
  const candidates = [...("candidates" in data ? data.candidates.filter((c) => c.id !== source.id) : []), ...storedCandidates];
  // Capture revisions before AI runs, so concurrent edits invalidate the approval.
  const revisions = new Map(storedCandidates.map((c) => [c.id, c.revision]));
  try {
    const reviewed = await reviewDuplicates(source, candidates);
    return Response.json({ source, revision, candidates: reviewed.map((c) => ({ ...c, revision: revisions.get(c.id) })) });
  } catch (error) {
    return apiError("operation_conflict", error instanceof Error && error.message.startsWith("AI 중복") ? error.message : "AI 중복 검토를 완료하지 못했습니다. AI 설정을 확인하고 다시 시도해 주세요.", 409);
  }
});

const mergeSchema = z.object({ sourceId: z.string().uuid(), targetId: z.string().uuid(), sourceRevision: z.number().int().positive(), targetRevision: z.number().int().positive() }).strict();
export const PATCH = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write"); if (isResponse(auth)) return auth;
  const parsed = mergeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "병합할 두 용어와 리비전을 확인해 주세요.", 400);
  const d = parsed.data;
  try { return Response.json(await mergeTerms(d.sourceId, d.targetId, d.sourceRevision, d.targetRevision, auth.kind === "user" ? auth.user.id : null, auth.kind === "key" ? auth.keyId : null)); }
  catch { return apiError("operation_conflict", "병합하지 못했습니다. 용어 변경·표기 충돌·이미 병합된 대상인지 확인하고 다시 검토해 주세요.", 409); }
});
