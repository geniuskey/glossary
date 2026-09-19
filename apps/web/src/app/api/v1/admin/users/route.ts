import { methodStubs, withApiErrors } from "@/lib/api-error";
import { listManagedUsers } from "@/lib/admin/users";
import { isResponse, requireAdminUser } from "@/lib/auth/require";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

export const GET = withApiErrors(async (request: Request = new Request("http://internal")) => {
  const admin = await requireAdminUser(request);
  if (isResponse(admin)) return admin;

  return Response.json({ users: await listManagedUsers() });
});
