import { z } from "zod/v3";
import { wikiPageStatusEnum } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { recordAuditEvent } from "@/lib/audit";
import { getDb } from "@/lib/db";
import { terms } from "@glossary/db";
import { slugify } from "@/lib/terms/slug";
import {
  getWikiPageBySlug,
  MAX_WIKI_CONTENT_LENGTH,
  toWikiPageWire,
  updateWikiPage,
} from "@/lib/wiki/store";
import { inArray } from "drizzle-orm";

const ALLOWED_METHODS = ["GET", "PATCH"];
const { POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, DELETE, OPTIONS };

const wikiSlugSchema = z.string().trim().min(1).max(120).transform(slugify).refine((value) => value.length > 0 && value !== "new" && value !== "page", "사용할 수 없는 위키 주소입니다.");
const patchSchema = z.object({
  slug: wikiSlugSchema.optional(),
  title: z.string().trim().min(1).max(240).optional(),
  summary: z.string().trim().max(600).nullable().optional(),
  sourceUrl: z.string().trim().max(2_000).refine((value) => /^https?:\/\//i.test(value), "출처 URL은 http 또는 https 주소여야 합니다.").nullable().optional(),
  content: z.string().trim().min(1).max(MAX_WIKI_CONTENT_LENGTH).optional(),
  domain: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  termSlugs: z.array(z.string().trim().min(1).max(120)).max(20).optional(),
  status: z.enum(wikiPageStatusEnum.enumValues).optional(),
}).strict();

type RouteContext = { params: Promise<{ slug: string }> };

function decodeSlug(value: string): string {
  try { return decodeURIComponent(value); } catch { return value; }
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

export const GET = withApiErrors(async (_request: Request, context: RouteContext) => {
  const auth = await requireAuth(_request, "read");
  if (isResponse(auth)) return auth;
  const slug = decodeSlug((await context.params).slug);
  const page = await getWikiPageBySlug(slug);
  if (!page) return apiError("not_found", "위키 문서를 찾을 수 없습니다.", 404);
  return Response.json({ page: toWikiPageWire(page, true) });
});

export const PATCH = withApiErrors(async (request: Request, context: RouteContext) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const slug = decodeSlug((await context.params).slug);
  const current = await getWikiPageBySlug(slug);
  if (!current) return apiError("not_found", "위키 문서를 찾을 수 없습니다.", 404);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "위키 문서 수정 내용을 확인해 주세요.", 400, parsed.error.flatten());
  const requestedStatus = parsed.data.status ?? current.status;
  if (requestedStatus !== "draft" && (auth.kind !== "user" || auth.user.role !== "admin")) {
    return apiError("forbidden", "위키 문서 공개·보관은 관리자 승인 후에만 가능합니다. 편집자는 초안으로 저장해 검토를 요청하세요.", 403);
  }
  const termIds = parsed.data.termSlugs === undefined ? undefined : await resolveTermIds(parsed.data.termSlugs);
  if (isResponse(termIds)) return termIds;
  const { termSlugs: _termSlugs, ...rest } = parsed.data;
  const updated = await updateWikiPage(current.id, {
    ...rest,
    ...(termIds !== undefined ? { termIds } : {}),
  }, auth.kind === "user" ? auth.user.id : null, auth.kind === "key" ? auth.keyId : null);
  if (!updated) return apiError("not_found", "위키 문서를 찾을 수 없습니다.", 404);
  await recordAuditEvent({
    action: updated.status === "published" ? "wiki.publish" : updated.status === "archived" ? "wiki.archive" : "wiki.update",
    targetType: "wiki_page",
    targetId: updated.id,
    actor: auth.kind === "user" ? { userId: auth.user.id } : { keyId: auth.keyId },
    metadata: { status: updated.status, revision: updated.revision },
  });
  return Response.json({ page: toWikiPageWire(updated, true), indexed: false });
});
