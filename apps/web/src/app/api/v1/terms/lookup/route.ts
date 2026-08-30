import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { lookupTerms } from "@/lib/terms/lookup";
import { TERM_NAME_MAX } from "@/lib/terms/limits";

// R83: 이 라우트는 POST만 처리한다. 나머지는 405 스텁으로 명시 export한다 —
// 이 구멍(Next 기본 405의 0바이트 본문)이 이 저장소에서 네 번째로 반복되는
// 실수라 실수할 여지를 아예 없앤다.
const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

// R99/R87: z.string().trim()은 zod 3.25에서 검증이 아니라 변환(transform)이다
// — safeParse가 돌려주는 parsed.data.texts 자체가 trim된 문자열로 바뀐다.
// lookupTerms는 그 값을 그대로 응답의 text에 echo하므로, trim()을 쓰면 "응답의
// text는 요청 원문 그대로"라는 R87을 어기게 된다("  ZDK  " → 응답 text: "ZDK").
// refine으로 "공백뿐인 문자열"만 거부하고 값 자체는 원문 그대로 통과시킨다.
const bodySchema = z.object({
  texts: z
    .array(
      z
        .string()
        .min(1)
        .max(TERM_NAME_MAX)
        .refine((s) => s.trim().length > 0, "공백뿐인 표기는 사용할 수 없습니다."),
    )
    .min(1)
    .max(500),
});

// 읽기 동작이지만 문서 전체를 훑는 배치 요청이라 본문이 커서 GET 쿼리스트링에
// 담을 수 없다. 이 POST는 상태를 바꾸지 않는다 — CSRF 불변식("상태를 바꾸는
// GET을 만들지 마라")과 무관하다.
export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "texts 배열이 필요합니다 (최대 500개).", 400, parsed.error.flatten());
  }

  return Response.json({ results: await lookupTerms(parsed.data.texts) });
});
