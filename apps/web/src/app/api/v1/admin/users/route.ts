import { methodStubs, withApiErrors } from "@/lib/api-error";
import { listManagedUsers } from "@/lib/admin/users";
import { isResponse, requireAdminUser } from "@/lib/auth/require";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

export const GET = withApiErrors(async () => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;

  return Response.json({ users: await listManagedUsers() });
});
