import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { loadSsoConfig, publicSsoConfig, saveSsoConfig, SSO_PROTOCOLS } from "@/lib/auth/sso/config";
import { redirectUriFor } from "@/lib/auth/sso/flow";

const ALLOWED_METHODS = ["GET", "PUT"];
const { POST, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PATCH, DELETE, OPTIONS };

// 엔드포인트는 http(s)만 받는다. 서버가 이 주소로 직접 요청을 보내므로(토큰 교환),
// file:이나 이상한 스킴이 설정에 들어갈 수 있으면 그 자체가 공격면이 된다.
const endpoint = z
  .string()
  .trim()
  .refine((v) => v === "" || /^https?:\/\/\S+$/.test(v), { message: "http(s) 주소여야 합니다." });

const nameList = z.array(z.string().trim().min(1)).max(20);

// .strict()가 중요하다 — lastClaimKeys나 updatedBy 같은 "서버가 채우는 값"이
// 본문으로 들어와 덮어써지지 않게 한다.
const patchSchema = z
  .object({
    enabled: z.boolean(),
    protocol: z.enum(SSO_PROTOCOLS),
    buttonLabel: z.string().trim().min(1).max(60),
    issuer: endpoint,
    jwksUri: endpoint,
    authorizationEndpoint: endpoint,
    tokenEndpoint: endpoint,
    userinfoEndpoint: endpoint,
    clientId: z.string().trim().max(200),
    // 빈 문자열은 "그대로 두기", null은 "지우기"다(config.ts의 saveSsoConfig 참고).
    clientSecret: z.string().max(400).nullable(),
    scopes: nameList,
    tokenAuthMethod: z.enum(["client_secret_post", "client_secret_basic"]),
    baseUrl: endpoint,
    subjectClaims: nameList,
    emailClaims: nameList,
    nameClaims: nameList,
    groupClaims: nameList,
    allowedGroups: nameList,
    adminGroups: nameList,
    autoCreate: z.boolean(),
  })
  .partial()
  .strict();

export const GET = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;

  const cfg = await loadSsoConfig();
  // IdP에 등록해야 하는 주소를 운영자가 손으로 조립하지 않게 계산해서 함께 준다.
  // 인가·토큰 요청에 실제로 실리는 값과 같은 함수로 만든다(한 글자만 달라도 IdP가 거절한다).
  return Response.json({ sso: publicSsoConfig(cfg), redirectUri: redirectUriFor(request, cfg) });
});

export const PUT = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "SSO 설정 값이 올바르지 않습니다.", 400, parsed.error.flatten());
  }

  const result = await saveSsoConfig(parsed.data, admin.id);
  if (!result.ok) {
    // 켜기 전에 갖춰야 하는 값이 빠진 경우다. 무엇이 빠졌는지 그대로 돌려준다.
    return apiError("validation_failed", result.problems.join(" "), 400, { problems: result.problems });
  }

  return Response.json({ sso: publicSsoConfig(result.config), redirectUri: redirectUriFor(request, result.config) });
});
