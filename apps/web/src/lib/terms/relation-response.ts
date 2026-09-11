import { apiError } from "@/lib/api-error";

export function relationResponse(result: { ok: true; id: string } | { error: string }, successStatus = 200) {
  if ("ok" in result) return Response.json({ id: result.id }, { status: successStatus });
  if (result.error === "not_found") return apiError("not_found", "관계 또는 용어를 찾을 수 없습니다. 목록을 새로고침해 주세요.", 404);
  if (result.error === "stale") return apiError("revision_conflict", "용어가 변경되었습니다. 최신 정의를 확인하고 근거를 수정해 다시 검토해 주세요.", 409);
  if (result.error === "duplicate") return apiError("operation_conflict", "같은 방향과 종류의 관계가 이미 있습니다. 기존 관계를 찾아 수정해 주세요.", 409);
  if (result.error === "invalid") return apiError("validation_failed", "서로 다른 용어와 관계의 근거를 확인해 주세요.", 400);
  return apiError("operation_conflict", "다른 사용자가 관계를 변경했습니다. 목록을 새로고침하고 다시 검토해 주세요.", 409);
}
