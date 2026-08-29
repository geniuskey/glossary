import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { suggestTerms } from "@/lib/terms/search";

// R25/R83: 처리하지 않는 메서드는 405 스텁으로 명시 export한다.
const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

/**
 * R136: 검색창 자동완성. 홈의 Client Component가 한 글자마다 부르는 자리라
 * 응답을 작게 유지한다(정의문·도메인·리비전 없이 표기와 이름만, 최대
 * SUGGEST_LIMIT개). 개수를 쿼리 파라미터로 열지 않은 것은 의도적이다 — 드롭다운
 * 하나가 유일한 소비자이고, 더 넓게 보려는 요청은 이미 `GET /terms?q=`가 받는다.
 */
export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;

  const q = new URL(request.url).searchParams.get("q");
  // R64는 "값이 빈 파라미터는 지정 안 함으로 취급하라"였지만 그건 **필터**
  // 이야기다. 여기서 q는 요청 그 자체라 뺄 수 있는 것이 없다 — 빈 q로 재시도해도
  // 영원히 성공하지 않으므로 400이 맞다(R41/R65와 같은 판단).
  if (q === null || q.trim() === "") {
    return apiError("validation_failed", "q가 필요합니다.", 400, { field: "q" });
  }

  return Response.json({ items: await suggestTerms(q) });
});
