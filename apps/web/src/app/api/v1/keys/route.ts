import { desc, eq } from "drizzle-orm";
import { z } from "zod/v3";
import { apiKeys } from "@glossary/db";
import { recordAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireSessionUser } from "@/lib/auth/require";
import { getCurrentUser } from "@/lib/auth/current-user";
import { generateApiKey } from "@/lib/auth/api-key";

const createSchema = z.object({
  name: z.string().trim().min(1).max(100),
  scopes: z.array(z.enum(["read", "write", "validate"])).min(1).max(3),
});

// R25: 신규 라우트도 methodNotAllowed를 명시 export한다 — 이 규칙에 예외는 없다.
const ALLOWED_METHODS = ["GET", "POST"];
const { PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, PATCH, DELETE, OPTIONS };

export const GET = withApiErrors(async () => {
  const user = await getCurrentUser();
  if (!user) return apiError("unauthorized", "로그인이 필요합니다.", 401);

  const rows = await getDb()
    .select({
      id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix,
      scopes: apiKeys.scopes, createdAt: apiKeys.createdAt,
      lastUsedAt: apiKeys.lastUsedAt, revokedAt: apiKeys.revokedAt,
    })
    .from(apiKeys)
    // API 키는 개인 자격 증명이다. 전체 행을 반환하면 로그인한 편집자가
    // 다른 사람의 키 이름·접두사·사용 시각을 볼 수 있다.
    .where(eq(apiKeys.createdBy, user.id))
    .orderBy(desc(apiKeys.createdAt));

  return Response.json({ keys: rows });
});

// 평문 토큰은 이 응답에서만 나온다. 이후로는 해시만 남으므로 복구할 수 없다.
export const POST = withApiErrors(async (request: Request) => {
  const user = await requireSessionUser(request);
  if (isResponse(user)) return user;

  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiError("validation_failed", "키 이름과 scope가 필요합니다.", 400, parsed.error.flatten());
  }

  const { token, prefix, hash } = generateApiKey();
  // R28: prefix 유니크 인덱스 충돌(23505)은 여기서 잡지 않는다 — withApiErrors가
  // internal_error 500으로 규약을 지킨다. 4바이트 prefix 공간에 사내 키 수십 개
  // 규모라 재시도 로직을 넣을 만큼의 확률이 아니다.
  const [row] = await getDb()
    .insert(apiKeys)
    .values({ name: parsed.data.name, prefix, keyHash: hash, scopes: parsed.data.scopes, createdBy: user.id })
    .returning({ id: apiKeys.id, name: apiKeys.name, prefix: apiKeys.prefix, scopes: apiKeys.scopes });
  await recordAuditEvent({
    action: "api_key.created",
    targetType: "api_key",
    targetId: row!.id,
    actor: { userId: user.id },
    metadata: { scopes: parsed.data.scopes },
  });

  return Response.json({ key: row, token }, { status: 201 });
});
