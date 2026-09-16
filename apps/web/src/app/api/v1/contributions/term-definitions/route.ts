import { methodStubs, withApiErrors } from "@/lib/api-error";
import {
  approveDefinitionResponse,
  generateDefinitionResponse,
  listDefinitionReviewResponse,
} from "@/lib/ai/definition-review-api";
import { isResponse, requireAuth } from "@/lib/auth/require";

const ALLOWED_METHODS = ["GET", "POST", "PATCH"];
const { PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, DELETE, OPTIONS };

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  return listDefinitionReviewResponse();
});

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  return generateDefinitionResponse(request);
});

export const PATCH = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  return approveDefinitionResponse(
    request,
    auth.kind === "user" ? auth.user.id : null,
    auth.kind === "key" ? auth.keyId : null,
  );
});
