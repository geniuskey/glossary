import { createHash } from "node:crypto";
import { asc, eq, sql } from "drizzle-orm";
import { terms, termSurfaces, termRevisions } from "@glossary/db";
import { getDb } from "@/lib/db";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { methodStubs, withApiErrors } from "@/lib/api-error";
import { toSurfaceWire, toTermWire } from "@/lib/terms/wire";

const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;

  const db = getDb();
  const [termRows, surfaceRows, revisionRows] = await db.transaction(async (tx) => {
    const termRows = await tx.select().from(terms).where(sql`${terms.replacedById} is null`).orderBy(asc(terms.id));
    const surfaceRows = await tx.select().from(termSurfaces).innerJoin(terms, eq(termSurfaces.termId, terms.id))
      .where(sql`${terms.replacedById} is null`).orderBy(asc(termSurfaces.termId), asc(termSurfaces.id));
    const revisionRows = await tx.select({ termId: termRevisions.termId, revision: sql<number>`max(${termRevisions.revisionNumber})::int` })
      .from(termRevisions).groupBy(termRevisions.termId);
    return [termRows, surfaceRows, revisionRows] as const;
  }, { isolationLevel: "repeatable read" });
  const byTerm = new Map<string, ReturnType<typeof toSurfaceWire>[]>();
  for (const row of surfaceRows) {
    const list = byTerm.get(row.term_surfaces.termId) ?? [];
    list.push(toSurfaceWire(row.term_surfaces));
    byTerm.set(row.term_surfaces.termId, list);
  }
  const revisions = new Map(revisionRows.map((row) => [row.termId, row.revision]));
  const items = termRows.map((term) => ({
    ...toTermWire(term),
    revision: revisions.get(term.id) ?? 0,
    surfaces: byTerm.get(term.id) ?? [],
  }));
  const serialized = JSON.stringify({ items });
  const catalogVersion = createHash("sha256").update(serialized).digest("hex");
  const etag = `"${catalogVersion}"`;
  const headers = { ETag: etag, "Cache-Control": "private, no-cache", "X-Catalog-Version": catalogVersion };
  if (request.headers.get("if-none-match")?.split(",").map((value) => value.trim()).includes(etag)) {
    return new Response(null, { status: 304, headers });
  }
  return Response.json({ catalogVersion, items }, { headers });
});
