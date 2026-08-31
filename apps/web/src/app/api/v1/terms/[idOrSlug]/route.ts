import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getTermByIdOrSlug, type TermDetailResponse } from "@/lib/terms/query";
import { termPatchSchema } from "@/lib/terms/schema";
import { isAssignableUserId } from "@/lib/terms/owners";
import { deleteTerm, updateTerm, type UpdateTermSuccess } from "@/lib/terms/update";
import { toSurfaceWire, toTermWire, toWarningWire, type TermWriteResponse } from "@/lib/terms/wire";

// Task 10: GET/PATCH/DELETE 세 메서드를 처리한다. 나머지는 405 스텁이다.
const ALLOWED_METHODS = ["GET", "PATCH", "DELETE"];
const { POST, PUT, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, OPTIONS };

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

// 중복이 있어도 409를 던지지 않는다(POST와 동일). 동음이의어를 허용하므로 저장은
// 진행하고 warnings로만 알린다. 표기 모순(R52)이나 리비전 경합(R54)만 각각
// 400/409로 거부한다.
export const PATCH = withApiErrors(
  async (request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) => {
    const auth = await requireAuth(request, "write");
    if (isResponse(auth)) return auth;

    const { idOrSlug } = await ctx.params;
    const existing = await getTermByIdOrSlug(idOrSlug);
    if (!existing) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);

    const parsed = termPatchSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return apiError("validation_failed", "수정 입력이 올바르지 않습니다.", 400, parsed.error.flatten());
    }
    if (parsed.data.ownerId && !(await isAssignableUserId(parsed.data.ownerId))) {
      return apiError("validation_failed", "담당자 계정을 찾을 수 없습니다.", 400, { field: "ownerId" });
    }

    const { expectedRevision, ...patchInput } = parsed.data;
    const authorId = auth.kind === "user" ? auth.user.id : null;
    // R47/R55: API 키로 인증된 요청은 authorId가 항상 null이라, 리비전에 누가
    // 썼는지 남기려면 authorKeyId를 별도로 넘겨야 한다.
    const authorKeyId = auth.kind === "key" ? auth.keyId : null;

    const result = await updateTerm(existing.id, patchInput, authorId, expectedRevision, authorKeyId);

    // R75: 이 라우트는 위에서 이미 idOrSlug를 존재하는 term으로 확인했으므로
    // 여기서 notFound가 나올 일은 실질적으로 없다 — 그래도 updateTerm은 export된
    // 함수라 다른 호출자(Task 13 등)가 오래된/잘못된 id로 직접 부를 수 있고,
    // 그 계약을 지키려면 라우트도 이 분기를 무시하면 안 된다.
    if ("notFound" in result) {
      return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
    }
    if ("invalid" in result) {
      return apiError("validation_failed", "표기 구성이 올바르지 않습니다.", 400, { issues: result.issues });
    }
    if ("slugConflict" in result) {
      return apiError("slug_conflict", "이미 사용 중인 URL 주소입니다.", 409, { field: "slug" });
    }
    if ("conflict" in result) {
      return apiError("revision_conflict", "다른 사람이 먼저 수정했습니다.", 409, {
        currentRevision: result.currentRevision,
      });
    }
    // R81: 분기 체인의 끝. 남아 있어야 하는 변형은 성공 하나뿐이며, 이 명시
    // 주석이 그것을 tsc로 강제한다. UpdateTermResult에 변형이 하나 추가됐는데
    // 위 분기를 빠뜨리면 여기서 컴파일 오류가 난다 — 그렇지 않으면 내부 판별자가
    // 200 성공 응답으로 클라이언트에 그대로 새어 나간다(리뷰가 실측한 회귀).
    const ok: UpdateTermSuccess = result;
    // R77(F9) — 해소됨(R112, Task 13): POST/PATCH 양쪽을 wire.ts의
    // TermWriteResponse/toTermWire/toSurfaceWire/toWarningWire로 통일해
    // createdBy/updatedBy/replacedById/normLoose/normSpace 같은 내부 컬럼이
    // 새지 않게 한다. POST(../route.ts)와 정확히 같은 변환을 쓴다.
    const body: TermWriteResponse = {
      term: toTermWire(ok.term),
      surfaces: ok.surfaces.map(toSurfaceWire),
      warnings: ok.warnings.map(toWarningWire),
    };
    return Response.json(body);
  },
);

// 역할은 admin | editor다. 삭제는 admin 전용 — API 키에는 역할 개념이 없으므로
// (스코프만 있다) 사용자 인증이 아니면 무조건 거부한다.
export const DELETE = withApiErrors(
  async (request: Request, ctx: { params: Promise<{ idOrSlug: string }> }) => {
    const auth = await requireAuth(request, "write");
    if (isResponse(auth)) return auth;
    if (auth.kind !== "user" || auth.user.role !== "admin") {
      return apiError("forbidden", "삭제는 관리자만 할 수 있습니다.", 403);
    }

    const { idOrSlug } = await ctx.params;
    const existing = await getTermByIdOrSlug(idOrSlug);
    if (!existing) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);

    await deleteTerm(existing.id);
    return new Response(null, { status: 204 });
  },
);
