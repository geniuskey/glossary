import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { requireAuth, isResponse } from "@/lib/auth/require";
import { termInputSchema } from "@/lib/terms/schema";
import { createTerm } from "@/lib/terms/create";

// R25: 새 라우트도 처리하지 않는 메서드를 명시 export한다.
// Task 9가 이 파일에 GET을 추가할 것이므로, 지금은 POST만 실제로 구현하고
// 나머지는 methodStubs로 생성한다 — GET을 추가할 때 이 목록에 한 줄만 더하면 된다.
const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

// 중복이 있어도 409를 던지지 않는다. 동음이의어를 허용하기로 했으므로 저장은
// 진행하고 warnings로만 알린다.
export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;

  const parsed = termInputSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "용어 입력이 올바르지 않습니다.", 400, parsed.error.flatten());
  }

  const authorId = auth.kind === "user" ? auth.user.id : null;
  // R47: API 키로 인증된 요청은 authorId가 항상 null이라, 리비전에 누가 썼는지
  // 남기려면 authorKeyId를 별도로 넘겨야 한다.
  const authorKeyId = auth.kind === "key" ? auth.keyId : null;
  const { term, surfaces, warnings } = await createTerm(parsed.data, authorId, authorKeyId);

  return Response.json({ term, surfaces, warnings }, { status: 201 });
});
