import "server-only";

import { z } from "zod/v3";
import { apiError } from "@/lib/api-error";
import { scheduleRagIndexing } from "@/lib/rag/indexer";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { updateTerm } from "@/lib/terms/update";
import { AiProviderError } from "./provider";
import { listDefinitionReviewCandidates, prepareOneLineDefinition } from "./definition-review";

const generateSchema = z.object({ termId: z.string().uuid(), force: z.boolean().optional() }).strict();
const approveSchema = z.object({
  termId: z.string().uuid(),
  definitionMd: z.string().trim().min(1).max(1_000).refine((value) => !/[\r\n]/.test(value), "한줄 정의에는 줄바꿈을 넣을 수 없습니다."),
  expectedRevision: z.number().int().positive(),
}).strict();

export async function listDefinitionReviewResponse(userId: string | null = null): Promise<Response> {
  const items = await listDefinitionReviewCandidates(100, userId);
  return Response.json({ items, total: items.length });
}

export async function generateDefinitionResponse(request: Request, userId: string | null = null): Promise<Response> {
  const parsed = generateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "정리할 용어를 확인해 주세요.", 400, parsed.error.flatten());
  const candidate = (await listDefinitionReviewCandidates(200, userId)).find((item) => item.id === parsed.data.termId);
  if (!candidate) return apiError("operation_conflict", "이 용어는 더 이상 한줄 정의 정리 대상이 아닙니다.", 409);
  if (candidate.revision < 1) return apiError("operation_conflict", "용어 이력을 확인할 수 없어 한줄 정의를 준비하지 못했습니다.", 409);
  try {
    const suggestion = await prepareOneLineDefinition(candidate, parsed.data.force === true);
    if (!suggestion) return apiError("operation_conflict", "용어가 변경되어 한줄 정의를 다시 준비해야 합니다.", 409);
    return Response.json({ suggestion });
  } catch (error) {
    if (error instanceof Error && error.message === "AI_NOT_ENABLED") {
      return apiError("ai_not_enabled", "AI 연결을 먼저 활성화해 주세요.", 409);
    }
    if (error instanceof Error && error.message === "INSUFFICIENT_BODY") {
      return apiError(
        "operation_conflict",
        "본문만으로 한줄 정의를 만들 근거가 충분하지 않습니다. 용어 본문에 용도나 맥락을 보충한 뒤 다시 시도해 주세요.",
        422,
        { reason: "insufficient_body", field: "bodyMd", termId: candidate.id },
      );
    }
    if (error instanceof AiProviderError) {
      return apiError(
        "ai_provider_error",
        "AI에서 한줄 정의를 받지 못했습니다. 관리자 화면의 ‘AI 운영’에서 최근 실패를 확인해 주세요.",
        502,
        { providerStatus: error.status ?? null },
      );
    }
    throw error;
  }
}

export async function approveDefinitionResponse(
  request: Request,
  authorId: string | null,
  authorKeyId: string | null,
): Promise<Response> {
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
    authorId,
    parsed.data.expectedRevision,
    authorKeyId,
    "AI 한줄 정의 승인",
  );
  if ("conflict" in result) return apiError("revision_conflict", "다른 사람이 먼저 수정했습니다.", 409, { currentRevision: result.currentRevision });
  if ("notFound" in result) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
  if ("invalid" in result) return apiError("validation_failed", "용어의 표기 구성을 먼저 확인해 주세요.", 400, { issues: result.issues });
  if ("representativeConflict" in result || "slugConflict" in result) {
    return apiError("operation_conflict", "용어의 다른 충돌을 먼저 해결해 주세요.", 409);
  }
  scheduleRagIndexing(1);
  return Response.json({ ok: true, termId: existing.id, definitionMd: parsed.data.definitionMd });
}
