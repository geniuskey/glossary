import { methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAdminUser } from "@/lib/auth/require";
import { buildGlossarySnapshot } from "@/lib/admin/term-snapshot";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

export const GET = withApiErrors(async () => {
  const admin = await requireAdminUser();
  if (isResponse(admin)) return admin;

  const snapshot = await buildGlossarySnapshot();
  const date = snapshot.exportedAt.slice(0, 10);
  return new Response(JSON.stringify(snapshot, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "content-disposition": `attachment; filename="glossary-snapshot-${date}.json"`,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
});
