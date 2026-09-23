import { z } from "zod/v3";
import { meetingDocumentStatusEnum } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { resolveDomains, unknownDomainsResponse } from "@/lib/terms/domains";
import {
  createMeetingDocument,
  listMeetingDocuments,
  MAX_MEETING_CONTENT_LENGTH,
  toMeetingDocumentWire,
} from "@/lib/meetings/store";

const ALLOWED_METHODS = ["GET", "POST"];
const { PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { PUT, PATCH, DELETE, OPTIONS };

const dateSchema = z.string().trim().min(1).max(80).nullable().optional();
const createSchema = z.object({
  title: z.string().trim().min(1).max(240),
  meetingDate: dateSchema,
  source: z.string().trim().max(200).optional().default(""),
  team: z.string().trim().max(200).optional().default(""),
  domain: z.array(z.string().trim().min(1).max(200)).max(20).optional().default([]),
  content: z.string().trim().min(1).max(MAX_MEETING_CONTENT_LENGTH),
}).strict();

function parseDate(raw: string | null | undefined): Date | null | Response {
  if (!raw) return null;
  const date = new Date(raw);
  if (!Number.isFinite(date.getTime())) return apiError("validation_failed", "meetingDate는 ISO 날짜 형식이어야 합니다.", 400, { field: "meetingDate" });
  return date;
}

function pageParam(raw: string | null, fallback: number, max: number): number | Response {
  if (raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1) return apiError("validation_failed", "페이지 파라미터를 확인해 주세요.", 400);
  return Math.min(max, Math.floor(value));
}

export const GET = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "read");
  if (isResponse(auth)) return auth;
  const url = new URL(request.url);
  const statusRaw = url.searchParams.get("status");
  const status = statusRaw ? meetingDocumentStatusEnum.enumValues.find((value) => value === statusRaw) : "active";
  if (statusRaw && !status) return apiError("validation_failed", "status 값이 올바르지 않습니다.", 400, { field: "status" });
  const page = pageParam(url.searchParams.get("page"), 1, Number.MAX_SAFE_INTEGER);
  if (isResponse(page)) return page;
  const pageSize = pageParam(url.searchParams.get("pageSize"), 20, 100);
  if (isResponse(pageSize)) return pageSize;
  const q = url.searchParams.get("q")?.trim() || undefined;
  const domain = url.searchParams.get("domain")?.trim() || undefined;
  const team = url.searchParams.get("team")?.trim() || undefined;
  if (q && q.length > 200) return apiError("validation_failed", "q는 200자 이하여야 합니다.", 400, { field: "q" });
  if (domain && domain.length > 200) return apiError("validation_failed", "domain은 200자 이하여야 합니다.", 400, { field: "domain" });
  if (team && team.length > 200) return apiError("validation_failed", "team은 200자 이하여야 합니다.", 400, { field: "team" });
  const result = await listMeetingDocuments({
    query: q,
    status: status as (typeof meetingDocumentStatusEnum.enumValues)[number] | undefined,
    domain,
    team,
    page,
    pageSize,
  });
  return Response.json({
    items: result.items.map((item) => toMeetingDocumentWire(item)),
    total: result.total,
    page,
    pageSize,
  });
});

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "회의록 입력을 확인해 주세요.", 400, parsed.error.flatten());
  const meetingDate = parseDate(parsed.data.meetingDate);
  if (isResponse(meetingDate)) return meetingDate;
  const resolved = await resolveDomains(parsed.data.domain);
  if (resolved.unknown.length) return unknownDomainsResponse(resolved.unknown);
  const domain = resolved.labels;
  const created = await createMeetingDocument({ ...parsed.data, meetingDate, domain }, auth.kind === "user" ? auth.user.id : null);
  return Response.json({ meeting: toMeetingDocumentWire(created, true), indexed: false }, { status: 201 });
});
