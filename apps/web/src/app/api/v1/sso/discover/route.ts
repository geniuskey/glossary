import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { discoverOidc, discoveryUrl } from "@/lib/auth/sso/config";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const bodySchema = z.object({
  issuer: z.string().trim().refine((v) => /^https?:\/\/\S+$/.test(v), { message: "http(s) 주소여야 합니다." }),
});

/**
 * R132: issuer 하나로 엔드포인트 네 개를 채워 준다. 손으로 옮겨 적으면 반드시
 * 한 글자가 틀리고, 그 결과는 로그인 화면에서야 드러난다.
 *
 * 관리자만 부를 수 있다 — 서버가 임의의 주소로 요청을 보내는 창구라서(SSRF),
 * 로그인한 편집자 누구나 부를 수 있으면 사내망 스캐너가 된다.
 */
export const POST = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "issuer 주소가 필요합니다.", 400, parsed.error.flatten());
  }

  const discovered = await discoverOidc(parsed.data.issuer).catch(() => null);
  if (!discovered) {
    return apiError("validation_failed", `${discoveryUrl(parsed.data.issuer)} 에서 설정을 읽지 못했습니다.`, 400);
  }

  return Response.json({ discovery: discovered });
});
