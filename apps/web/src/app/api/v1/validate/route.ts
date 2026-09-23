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

const MAX_CONTENT_LENGTH = 1_000_000;
const severitySchema = z.enum(["error", "warning", "info"]);
const optionsSchema = z.object({
  minSeverity: severitySchema.default("info"),
  extractUnregistered: z.boolean().default(true),
  collectCandidates: z.boolean().default(false),
  ignoredCandidates: z.array(z.string().trim().min(1).max(120)).max(1_000).default([]),
}).strict().default({});
const documentSchema = z.object({
  content: z.string().max(MAX_CONTENT_LENGTH),
  format: z.enum(["markdown", "plain"]).default("markdown"),
  path: z.string().trim().max(500).optional(),
}).strict();
const requestSchema = documentSchema.extend({ options: optionsSchema });

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "validate");
  if (isResponse(auth)) return auth;
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return apiError("validation_failed", "문서 검증 요청을 확인해 주세요.", 400, parsed.error.flatten());

  const snapshot = await loadLexiconSnapshot();
  const rawResult = validateDocument(parsed.data.content, snapshot.compiled, {
    format: parsed.data.format,
    extractUnregistered: parsed.data.options.extractUnregistered,
    ignoredCandidates: parsed.data.options.ignoredCandidates,
    includeHighlights: true,
    lexiconVersion: snapshot.version,
  });
  const result = filterResult(rawResult, parsed.data.options.minSeverity);

  if (parsed.data.options.collectCandidates) {
    scheduleAfterResponse(() => recordUnregisteredCandidates({
      content: parsed.data.content,
      findings: rawResult.findings,
      path: parsed.data.path,
      lexiconVersion: snapshot.version,
    }));
  }

  return Response.json({
    lexiconVersion: snapshot.version,
    path: parsed.data.path ?? null,
    stats: result.stats,
    findings: result.findings.map((finding) => wireFinding(parsed.data.content, finding)),
    highlights: (result.highlights ?? []).map((highlight) => ({
      kind: highlight.kind,
      matchedText: highlight.text,
      span: { start: highlight.start, end: highlight.end },
      ...(highlight.termId ? { termId: highlight.termId } : {}),
      ...(highlight.slug ? { slug: highlight.slug } : {}),
      ...(highlight.surfaceKind ? { surfaceKind: highlight.surfaceKind } : {}),
    })),
    highlightsTruncated: result.highlightsTruncated ?? false,
  });
});
