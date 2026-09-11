import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { listTermRows } from "@/lib/terms/query";
import type { RelationTerm } from "@/lib/terms/relation-values";
const ALLOWED_METHODS = ["GET"];
const { POST, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, PATCH, DELETE, OPTIONS };

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  const q = z.string().trim().min(1).max(200).safeParse(new URL(request.url).searchParams.get("q"));
  if (!q.success) return apiError("validation_failed", "검색어를 1~200자로 입력해 주세요.", 400);
  const result = await listTermRows({ q: q.data, page: 1, pageSize: 20 });
  const items: RelationTerm[] = result.items.map((term) => ({ id: term.id, slug: term.slug, name: term.nameKo || term.nameEn || term.slug,
    definition: term.definitionMd, domain: term.domain, revision: term.revision }));
  return Response.json({ items, total: result.total });
});
