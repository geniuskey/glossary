import { methodStubs, withApiErrors } from "@/lib/api-error";
import { openApiSpec } from "@/lib/openapi";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

// 스펙은 공개 문서다 — 인증을 걸지 않는다. 순수 읽기라 CSRF 불변식과 무관하다.
export const GET = withApiErrors(async () => Response.json(openApiSpec));
