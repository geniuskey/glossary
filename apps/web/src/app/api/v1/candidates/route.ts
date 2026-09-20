import { z } from "zod/v3";
import { unregisteredCandidateStatusEnum } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { listCandidates, toCandidateWire } from "@/lib/validation/candidates";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

function parsePage(raw: string | null, fallback: number, max: number): number | Response {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return apiError("validation_failed", "페이지 값이 올바르지 않습니다.", 400);
  return Math.min(max, Math.floor(value));
}

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (q.length > 120) return apiError("validation_failed", "q는 120자 이하여야 합니다.", 400);

  const rawStatus = url.searchParams.get("status");
  const status = rawStatus && rawStatus !== "" ? rawStatus : "open";
  if (status && !(unregisteredCandidateStatusEnum.enumValues as readonly string[]).includes(status)) {
    return apiError("validation_failed", "status 값이 올바르지 않습니다.", 400, { allowed: unregisteredCandidateStatusEnum.enumValues });
  }
  const page = parsePage(url.searchParams.get("page"), 1, Number.MAX_SAFE_INTEGER);
  if (isResponse(page)) return page;
  const pageSize = parsePage(url.searchParams.get("pageSize"), 30, 100);
  if (isResponse(pageSize)) return pageSize;

  const result = await listCandidates({ q: q || undefined, status: status as typeof unregisteredCandidateStatusEnum.enumValues[number] | undefined, page, pageSize });
  return Response.json({
    items: result.items.map(toCandidateWire),
    total: result.total,
    page: result.page,
    pageSize: result.pageSize,
  });
});
