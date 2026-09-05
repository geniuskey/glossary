import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { generateOneLineDefinition, listDefinitionReviewCandidates } from "@/lib/ai/definition-review";
import { AiProviderError } from "@/lib/ai/provider";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { updateTerm } from "@/lib/terms/update";

const ALLOWED_METHODS = ["GET", "POST", "PATCH"];
const { PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, DELETE, OPTIONS };

const generateSchema = z.object({ termId: z.string().uuid() }).strict();
const approveSchema = z.object({
  termId: z.string().uuid(),
  definitionMd: z.string().trim().min(1).max(1_000).refine((value) => !/[\r\n]/.test(value), "한줄 정의에는 줄바꿈을 넣을 수 없습니다."),
  expectedRevision: z.number().int().positive(),
}).strict();

export const GET = withApiErrors(async () => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const items = await listDefinitionReviewCandidates();
  return Response.json({ items, total: items.length });
});

export const POST = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const parsed = generateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "정리할 용어를 확인해 주세요.", 400, parsed.error.flatten());
  const candidate = (await listDefinitionReviewCandidates(200)).find((item) => item.id === parsed.data.termId);
  if (!candidate) return apiError("operation_conflict", "이 용어는 더 이상 한줄 정의 정리 대상이 아닙니다.", 409);
  try {
    return Response.json({ suggestion: await generateOneLineDefinition(candidate) });
  } catch (error) {
    if (error instanceof Error && error.message === "AI_NOT_ENABLED") {
      return apiError("ai_not_enabled", "AI 연결을 먼저 활성화해 주세요.", 409);
    }
    if (error instanceof Error && error.message === "INSUFFICIENT_BODY") {
      return apiError("operation_conflict", "본문만으로 한줄 정의를 만들 근거가 충분하지 않습니다.", 422);
    }
    if (error instanceof AiProviderError) {
      return apiError("ai_provider_error", "AI에서 한줄 정의를 받지 못했습니다. 연결과 모델을 확인해 주세요.", 502);
    }
    throw error;
  }
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  const parsed = approveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "승인할 한줄 정의를 확인해 주세요.", 400, parsed.error.flatten());
  const existing = await getTermByIdOrSlug(parsed.data.termId);
  if (!existing) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  if (existing.definitionMd?.trim()) {
    return apiError("operation_conflict", "이미 한줄 정의가 입력된 용어입니다.", 409);
  }
  const result = await updateTerm(
    existing.id,
    { definitionMd: parsed.data.definitionMd },
    admin.id,
    parsed.data.expectedRevision,
    null,
    "AI 한줄 정의 승인",
  );
  if ("conflict" in result) return apiError("revision_conflict", "다른 사람이 먼저 수정했습니다.", 409, { currentRevision: result.currentRevision });
  if ("notFound" in result) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  if ("invalid" in result) return apiError("validation_failed", "용어의 표기 구성을 먼저 확인해 주세요.", 400, { issues: result.issues });
  if ("representativeConflict" in result || "slugConflict" in result) {
    return apiError("operation_conflict", "용어의 다른 충돌을 먼저 해결해 주세요.", 409);
  }
  return Response.json({ ok: true, termId: existing.id, definitionMd: parsed.data.definitionMd });
});
