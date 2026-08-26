import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { listRevisions, type RevisionRowResponse } from "@/lib/terms/update";

// 이 라우트는 조회만 한다 — GET 외 모든 메서드는 405 스텁이다.
const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

interface RevisionListResponse {
  revisions: RevisionRowResponse[];
}

// R44(보안 불변식): 상태를 바꾸지 않는다.
export const GET = withApiErrors(
  async (request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) => {
    const auth = await requireAuth(request, "read");
    if (isResponse(auth)) return auth;

    const { idOrSlug } = await ctx.params;
    const term = await getTermByIdOrSlug(idOrSlug);
    if (!term) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);

    const revisions = await listRevisions(term.id);

    // R62/R67: createdAt은 Date로 오지만 응답에는 ISO 문자열로 실어야 한다 —
    // payload를 이 wire 타입으로 명시해서 .toISOString() 누락을 tsc가 잡게 한다.
    const payload: RevisionListResponse = {
      revisions: revisions.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
    };
    return Response.json(payload);
  },
);
