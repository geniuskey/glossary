import { z } from "zod/v3";
import { meetingDocumentStatusEnum } from "@glossary/db";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { resolveDomains, unknownDomainsResponse } from "@/lib/terms/domains";
import { getMeetingDocument, MAX_MEETING_CONTENT_LENGTH, toMeetingDocumentWire, updateMeetingDocument } from "@/lib/meetings/store";

const ALLOWED_METHODS = ["GET", "PATCH"];
const { POST, PUT, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { POST, PUT, DELETE, OPTIONS };

const dateSchema = z.string().trim().min(1).max(80).nullable().optional();
const patchSchema = z.object({
  title: z.string().trim().min(1).max(240).optional(),
  meetingDate: dateSchema,
  source: z.string().trim().max(200).optional(),
  team: z.string().trim().max(200).optional(),
  domain: z.array(z.string().trim().min(1).max(200)).max(20).optional(),
  content: z.string().trim().min(1).max(MAX_MEETING_CONTENT_LENGTH).optional(),
  status: z.enum(meetingDocumentStatusEnum.enumValues).optional(),
}).strict();

function parseDate(raw: string | null | undefined): Date | null | undefined | Response {
  if (raw === undefined) return undefined;
  if (raw === null || raw === "") return null;
  const value = new Date(raw);
  if (!Number.isFinite(value.getTime())) return apiError("validation_failed", "meetingDate는 ISO 날짜 형식이어야 합니다.", 400, { field: "meetingDate" });
  return value;
}

function validId(id: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id);
}

type RouteContext = { params: Promise<{ id: string }> };

export const GET = withApiErrors(async (_request: Request, context: RouteContext) => {
  const auth = await requireAuth(_request, "read");
  if (isResponse(auth)) return auth;
  const { id } = await context.params;
  if (!validId(id)) return apiError("not_found", "회의록을 찾을 수 없습니다.", 404);
  const meeting = await getMeetingDocument(id);
  if (!meeting) return apiError("not_found", "회의록을 찾을 수 없습니다.", 404);
  return Response.json({ meeting: toMeetingDocumentWire(meeting, true) });
});

export const PATCH = withApiErrors(async (request: Request, context: RouteContext) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;
  const { id } = await context.params;
  if (!validId(id)) return apiError("not_found", "회의록을 찾을 수 없습니다.", 404);
  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "회의록 수정 내용을 확인해 주세요.", 400, parsed.error.flatten());
  if (parsed.data.domain) {
    const resolved = await resolveDomains(parsed.data.domain);
    if (resolved.unknown.length) return unknownDomainsResponse(resolved.unknown);
    parsed.data.domain = resolved.labels;
  }
  const meetingDate = parseDate(parsed.data.meetingDate);
  if (meetingDate instanceof Response) return meetingDate;
  const { meetingDate: _rawMeetingDate, ...rest } = parsed.data;
  const updated = await updateMeetingDocument(id, {
    ...rest,
    ...(rest.domain ? { domain: [...new Set(rest.domain)] } : {}),
    ...(parsed.data.meetingDate !== undefined ? { meetingDate } : {}),
  });
  if (!updated) return apiError("not_found", "회의록을 찾을 수 없습니다.", 404);
  return Response.json({ meeting: toMeetingDocumentWire(updated, true), indexed: false });
});
