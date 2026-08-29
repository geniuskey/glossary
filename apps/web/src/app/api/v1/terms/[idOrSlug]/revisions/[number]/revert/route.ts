import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { revertTerm } from "@/lib/terms/revert";
import type { UpdateTermSuccess } from "@/lib/terms/update";
import { toSurfaceWire, toTermWire, toWarningWire, type TermWriteResponse } from "@/lib/terms/wire";

// R130: 되돌리기는 POST 하나다. 되돌리기 자체가 쓰기이므로 GET이어서는 안 된다 —
// R44와 같은 이유로, 이 사이트의 CSRF 방어는 SameSite=Lax 쿠키뿐이라 GET이 쓰기를
// 하면 그 방어가 즉시 뚫린다(링크 한 줄로 남의 용어를 되돌릴 수 있게 된다).
const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

// 본문은 없어도 된다. expectedRevision을 실으면 편집 경로(PATCH)와 같은 낙관적
// 동시성 제어를 받는다 — 이력 화면을 열어 둔 사이에 누가 먼저 고쳤으면 409다.
const revertBodySchema = z.object({
  expectedRevision: z.number().int().positive().optional(),
});

export const POST = withApiErrors(
  async (request: Request, ctx: { params: Promise<{ idOrSlug: string; number: string }> }) => {
    const auth = await requireAuth(request, "write");
    if (isResponse(auth)) return auth;

    const { idOrSlug, number } = await ctx.params;
    const term = await getTermByIdOrSlug(idOrSlug);
    if (!term) return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);

    // Number("")는 0, Number(" 3 ")은 3이다 — 경로 조각을 그대로 Number에 넣으면
    // "/revisions//revert"나 "/revisions/%203/revert"가 조용히 통과한다.
    const revisionNumber = /^\d+$/.test(number) ? Number(number) : NaN;
    if (!Number.isInteger(revisionNumber) || revisionNumber < 1) {
      return apiError("not_found", "리비전을 찾을 수 없습니다.", 404);
    }

    // 본문 없는 POST면 request.json()이 던진다. PATCH(null로 떨어뜨려 400)와 달리
    // 여기서는 빈 본문이 정상이므로 빈 객체로 받는다.
    const parsed = revertBodySchema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return apiError("validation_failed", "되돌리기 입력이 올바르지 않습니다.", 400, parsed.error.flatten());
    }

    const authorId = auth.kind === "user" ? auth.user.id : null;
    // R47/R55: API 키로 인증된 요청은 authorId가 항상 null이라, 리비전에 누가
    // 되돌렸는지 남기려면 authorKeyId를 별도로 넘겨야 한다.
    const authorKeyId = auth.kind === "key" ? auth.keyId : null;

    const result = await revertTerm(
      term.id,
      revisionNumber,
      authorId,
      parsed.data.expectedRevision,
      authorKeyId,
    );

    if ("revisionNotFound" in result) {
      return apiError("not_found", `리비전 #${revisionNumber}을 찾을 수 없습니다.`, 404);
    }
    if ("notFound" in result) {
      return apiError("term_not_found", "용어를 찾을 수 없습니다.", 404);
    }
    if ("invalid" in result) {
      return apiError("validation_failed", "되돌릴 수 없는 리비전입니다.", 400, { issues: result.issues });
    }
    if ("conflict" in result) {
      return apiError("revision_conflict", "다른 사람이 먼저 수정했습니다.", 409, {
        currentRevision: result.currentRevision,
      });
    }
    // R81: 분기 체인의 끝 — RevertResult에 변형이 추가됐는데 위 분기를 빠뜨리면
    // 여기서 tsc 오류가 난다. 그렇지 않으면 내부 판별자가 200으로 새어 나간다.
    const ok: UpdateTermSuccess = result;
    const body: TermWriteResponse = {
      term: toTermWire(ok.term),
      surfaces: ok.surfaces.map(toSurfaceWire),
      warnings: ok.warnings.map(toWarningWire),
    };
    return Response.json(body);
  },
);
