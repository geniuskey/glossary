import { inArray } from "drizzle-orm";
import { z } from "zod/v3";
import { terms, wikiPageStatusEnum } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { getDb } from "@/lib/db";
import { slugify } from "@/lib/terms/slug";
import {
  createWikiPage,
  listWikiPages,
  MAX_WIKI_CONTENT_LENGTH,
  toWikiPageWire,
} from "@/lib/wiki/store";

const ALLOWED_METHODS = ["GET", "POST"];
const { PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, PATCH, DELETE, OPTIONS };

const wikiSlugSchema = z.string().trim().min(1).max(120).transform(slugify).refine((value) => value.length > 0 && value !== "new" && value !== "page", "사용할 수 없는 위키 주소입니다.");
const baseSchema = {
  slug: wikiSlugSchema.optional(),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().max(600).nullable().optional().default(null),
  content: z.string().trim().min(1).max(MAX_WIKI_CONTENT_LENGTH),
  domain: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
  termSlugs: z.array(z.string().trim().min(1).max(120)).max(20).optional().default([]),
  status: z.enum(wikiPageStatusEnum.enumValues).optional().default("draft"),
};
const createSchema = z.object(baseSchema).strict();

function pageParam(raw: string | null, fallback: number, max: number): number | Response {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return apiError("validation_failed", "페이지 파라미터를 확인해 주세요.", 400);
  return Math.min(max, Math.floor(value));
}

async function resolveTermIds(slugs: string[]): Promise<string[] | Response> {
  const requested = [...new Set(slugs.map((slug) => slug.trim()).filter(Boolean))];
  if (requested.length === 0) return [];
  const rows = await getDb().select({ id: terms.id, slug: terms.slug }).from(terms).where(inArray(terms.slug, requested));
  const found = new Set(rows.map((row) => row.slug));
  const missing = requested.filter((slug) => !found.has(slug));
  if (missing.length > 0) return apiError("validation_failed", "연결하려는 용어를 찾을 수 없습니다.", 400, { missingTermSlugs: missing });
  const ids = new Map(rows.map((row) => [row.slug, row.id]));
  return requested.flatMap((slug) => ids.get(slug) ? [ids.get(slug)!] : []);
}

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  const url = new URL(request.url);
  const statusRaw = url.searchParams.get("status");
  const status = statusRaw ? wikiPageStatusEnum.enumValues.find((value) => value === statusRaw) : undefined;
  if (statusRaw && !status) return apiError("validation_failed", "status 값이 올바르지 않습니다.", 400, { field: "status" });
  const page = pageParam(url.searchParams.get("page"), 1, Number.MAX_SAFE_INTEGER);
  if (isResponse(page)) return page;
  const pageSize = pageParam(url.searchParams.get("pageSize"), 20, 100);
  if (isResponse(pageSize)) return pageSize;
  const q = url.searchParams.get("q")?.trim() || undefined;
  const domain = url.searchParams.get("domain")?.trim() || undefined;
  const termId = url.searchParams.get("termId")?.trim() || undefined;
  if (q && q.length > 200) return apiError("validation_failed", "q는 200자 이하여야 합니다.", 400, { field: "q" });
  if (domain && domain.length > 200) return apiError("validation_failed", "domain은 200자 이하여야 합니다.", 400, { field: "domain" });
  if (termId && !/^[0-9a-f-]{36}$/i.test(termId)) return apiError("validation_failed", "termId를 확인해 주세요.", 400, { field: "termId" });
  const result = await listWikiPages({
    query: q,
    status,
    domain,
    termId,
    page,
    pageSize,
  });
  return Response.json({ items: result.items.map((item) => toWikiPageWire(item)), total: result.total, page, pageSize });
});

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "위키 문서 입력을 확인해 주세요.", 400, parsed.error.flatten());
  const termIds = await resolveTermIds(parsed.data.termSlugs);
  if (isResponse(termIds)) return termIds;
  const created = await createWikiPage({
    slug: parsed.data.slug,
    title: parsed.data.title,
    summary: parsed.data.summary,
    content: parsed.data.content,
    domain: parsed.data.domain,
    termIds,
    status: parsed.data.status,
  }, auth.kind === "user" ? auth.user.id : null, auth.kind === "key" ? auth.keyId : null);
  return Response.json({ page: toWikiPageWire(created, true), indexed: false }, { status: 201 });
});
