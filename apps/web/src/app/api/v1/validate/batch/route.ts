import { z } from "zod/v3";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { loadLexiconSnapshot } from "@/lib/validation/lexicon";
import { validateDocument } from "@glossary/engine";
import { filterResult, wireFinding } from "@/lib/validation/response";
import { recordUnregisteredCandidates } from "@/lib/validation/candidates";
import { scheduleAfterResponse } from "@/lib/after-response";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const MAX_DOCUMENTS = 100;
const MAX_CONTENT_LENGTH = 1_000_000;
const MAX_BATCH_CONTENT_LENGTH = 10_000_000;
const requestSchema = z.object({
  documents: z.array(z.object({
    content: z.string().max(MAX_CONTENT_LENGTH),
    format: z.enum(["markdown", "plain"]).default("markdown"),
    path: z.string().trim().max(500).optional(),
  }).strict()).min(1).max(MAX_DOCUMENTS),
  options: z.object({
    minSeverity: z.enum(["error", "warning", "info"]).default("info"),
    extractUnregistered: z.boolean().default(true),
    collectCandidates: z.boolean().default(false),
    ignoredCandidates: z.array(z.string().trim().min(1).max(120)).max(1_000).default([]),
  }).strict().default({}),
}).strict().superRefine((value, context) => {
  const total = value.documents.reduce((sum, document) => sum + document.content.length, 0);
  if (total > MAX_BATCH_CONTENT_LENGTH) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["documents"], message: `문서 전체 크기는 ${MAX_BATCH_CONTENT_LENGTH.toLocaleString("en-US")}자 이하여야 합니다.` });
  }
});

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "validate");
  if (isResponse(auth)) return auth;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "문서 일괄 검증 요청을 확인해 주세요.", 400, parsed.error.flatten());

  const snapshot = await loadLexiconSnapshot();
  const results = parsed.data.documents.map((document) => {
    const rawResult = validateDocument(document.content, snapshot.compiled, {
      format: document.format,
      extractUnregistered: parsed.data.options.extractUnregistered,
      ignoredCandidates: parsed.data.options.ignoredCandidates,
      lexiconVersion: snapshot.version,
    });
    const result = filterResult(rawResult, parsed.data.options.minSeverity);
    if (parsed.data.options.collectCandidates) {
      scheduleAfterResponse(() => recordUnregisteredCandidates({
        content: document.content,
        findings: rawResult.findings,
        path: document.path,
        lexiconVersion: snapshot.version,
      }));
    }
    return {
      path: document.path ?? null,
      stats: result.stats,
      findings: result.findings.map((finding) => wireFinding(document.content, finding)),
    };
  });

  return Response.json({ lexiconVersion: snapshot.version, results });
});
