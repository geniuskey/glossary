import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getTermByIdOrSlug, type TermDetailResponse } from "@/lib/terms/query";

// R44: 이 라우트는 조회만 한다 — GET 외 모든 메서드는 405 스텁이다.
const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

// R44(보안 불변식): 이 GET은 상태를 바꾸지 않는다. 이 사이트의 CSRF 방어는
// SameSite=Lax 쿠키뿐이라, GET이 쓰기를 수행하면 그 방어가 즉시 뚫린다.
export const GET = withApiErrors(
  async (request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) => {
    const auth = await requireAuth(request, "read");
    if (isResponse(auth)) return auth;

    const { idOrSlug } = await ctx.params;
    const term = await getTermByIdOrSlug(idOrSlug);
    if (!term) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);

    // R62: updatedAt은 Date로 오지만 응답에는 ISO 문자열로 실어야 한다 —
    // 타입도 그에 맞춰 TermDetailResponse로 명시한다.
    const body: TermDetailResponse = { ...term, updatedAt: term.updatedAt.toISOString() };
    return Response.json({ term: body });
  },
);
