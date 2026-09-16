import { methodStubs, withApiErrors } from "@/lib/api-error";
import {
  approveDefinitionResponse,
  generateDefinitionResponse,
  listDefinitionReviewResponse,
} from "@/lib/ai/definition-review-api";
import { isResponse, requireAdminUser } from "@/lib/auth/require";

const ALLOWED_METHODS = ["GET", "POST", "PATCH"];
const { PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, DELETE, OPTIONS };

export const GET = withApiErrors(async () => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  return listDefinitionReviewResponse();
});

export const POST = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  return generateDefinitionResponse(request);
});

export const PATCH = withApiErrors(async (request: Request) => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;
  return approveDefinitionResponse(request, admin.id, null);
});
