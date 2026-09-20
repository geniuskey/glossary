import { methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { loadLexiconSnapshot } from "@/lib/validation/lexicon";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;

  const snapshot = await loadLexiconSnapshot();
  const etag = `"${snapshot.version}"`;
  const headers = {
    etag,
    "cache-control": "private, max-age=0, must-revalidate",
  };
  const ifNoneMatch = request.headers.get("if-none-match")?.split(",").map((value) => value.trim()) ?? [];
  if (ifNoneMatch.includes(etag) || ifNoneMatch.includes(snapshot.version)) {
    return new Response(null, { status: 304, headers });
  }

  return Response.json({
    lexiconVersion: snapshot.version,
    entries: snapshot.entries,
    total: snapshot.entries.length,
  }, { headers });
});
