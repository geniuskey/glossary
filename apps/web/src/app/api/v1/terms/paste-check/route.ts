import { surfaceKeys } from "@glossary/db";
import { z } from "zod";
import { apiError, methodStubs, withApiErrors } from "@/lib/api-error";
import { isResponse, requireAuth } from "@/lib/auth/require";
import { listBusinessCategories } from "@/lib/terms/categories";
import { findRepresentativeDuplicates } from "@/lib/terms/create";
import { listDomains } from "@/lib/terms/domains";
import { getTermByIdOrSlug } from "@/lib/terms/query";
import { termInputSchema, termPatchSchema } from "@/lib/terms/schema";
import { currentRevisionNumber } from "@/lib/terms/update";

const ALLOWED_METHODS = ["POST"];
const { GET, PUT, PATCH, DELETE, OPTIONS } = methodStubs(ALLOWED_METHODS);
export { GET, PUT, PATCH, DELETE, OPTIONS };

const requestSchema = z.object({
  updates: z.array(z.object({
    rowId: z.string().uuid(),
    line: z.number().int().positive(),
    expectedRevision: z.number().int().positive(),
    values: z.record(z.unknown()),
  }).strict()).max(200),
  creates: z.array(z.object({
    line: z.number().int().positive(),
    values: z.record(z.unknown()),
  }).strict()).max(200),
}).strict().superRefine((value, ctx) => {
  if (value.updates.length + value.creates.length > 200) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: "한 번에 200줄까지 검사할 수 있습니다." });
  }
});

const FIELD_LABELS: Record<string, string> = {
  nameEn: "대표 영문 표기",
  nameKo: "대표 국문 표기",
  fullNameEn: "영문 확장명",
  fullNameKo: "국문 확장명",
  status: "상태",
  domain: "도메인",
  category: "업무 분류",
  topic: "주제",
  definitionMd: "한줄 정의",
  bodyMd: "본문",
};

function issueMessages(error: z.ZodError, line: number): string[] {
  return error.issues.map((issue) => {
    const field = typeof issue.path[0] === "string" ? FIELD_LABELS[issue.path[0]] ?? issue.path[0] : null;
    let message = issue.message;
    if (issue.code === "too_big") {
      message = issue.type === "array"
        ? `최대 ${issue.maximum}개까지 입력할 수 있습니다.`
        : `최대 ${issue.maximum}자까지 입력할 수 있습니다.`;
    } else if (issue.code === "invalid_enum_value") {
      message = `허용된 값(${issue.options.join(", ")}) 중 하나를 입력해 주세요.`;
    } else if (issue.code === "invalid_type") {
      message = "입력 형식이 올바르지 않습니다.";
    }
    return `${line}번째 줄${field ? ` · ${field}` : ""}: ${message}`;
  });
}

function duplicateMessages(
  line: number,
  duplicates: Awaited<ReturnType<typeof findRepresentativeDuplicates>>,
): string[] {
  return duplicates.flatMap((duplicate) => duplicate.matches.map((match) =>
    `${line}번째 줄 · ${FIELD_LABELS[duplicate.field]}: “${duplicate.text}” 표기가 기존 용어 ${match.conflictingSlug}에 이미 등록되어 있습니다.`,
  ));
}

export const POST = withApiErrors(async (request: Request) => {
  const auth = await requireAuth(request, "write");
  if (isResponse(auth)) return auth;

  const requestBody = requestSchema.safeParse(await request.json().catch(() => null));
  if (!requestBody.success) {
    return apiError("validation_failed", "붙여넣기 검사 요청이 올바르지 않습니다.", 400, requestBody.error.flatten());
  }

  const [domains, categories] = await Promise.all([listDomains(), listBusinessCategories()]);
  const knownDomains = new Set(domains.map((domain) => domain.label));
  const knownCategories = new Set(categories.map((category) => category.key));
  const errors: string[] = [];
  const representatives: Array<{ operation: string; line: number; text: string; key: string }> = [];

  for (const operation of requestBody.data.updates) {
    const existing = await getTermByIdOrSlug(operation.rowId);
    if (!existing) {
      errors.push(`${operation.line}번째 줄: 수정할 용어를 찾을 수 없습니다.`);
      continue;
    }
    const parsed = termPatchSchema.safeParse({ ...operation.values, expectedRevision: operation.expectedRevision });
    if (!parsed.success) {
      errors.push(...issueMessages(parsed.error, operation.line));
      continue;
    }
    const revision = await currentRevisionNumber(existing.id);
    if (revision !== operation.expectedRevision) {
      errors.push(`${operation.line}번째 줄: 다른 사람이 먼저 수정했습니다. 새로고침한 뒤 다시 붙여넣어 주세요.`);
    }
    if (parsed.data.domain) {
      for (const domain of parsed.data.domain) if (!knownDomains.has(domain)) {
        errors.push(`${operation.line}번째 줄 · 도메인: “${domain}”은 분류 체계에 없는 도메인입니다.`);
      }
    }
    if (parsed.data.category) {
      for (const category of parsed.data.category) if (!knownCategories.has(category)) {
        errors.push(`${operation.line}번째 줄 · 업무 분류: “${category}”을(를) 찾을 수 없습니다.`);
      }
    }
    const desired = {
      nameEn: parsed.data.nameEn !== undefined ? parsed.data.nameEn : existing.nameEn,
      nameKo: parsed.data.nameKo !== undefined ? parsed.data.nameKo : existing.nameKo,
    };
    errors.push(...duplicateMessages(
      operation.line,
      await findRepresentativeDuplicates(desired, existing.id),
    ));
    for (const text of [desired.nameEn, desired.nameKo]) {
      const key = surfaceKeys(text ?? "").normLoose;
      if (key) representatives.push({ operation: `update:${existing.id}`, line: operation.line, text: text!, key });
    }
  }

  for (const operation of requestBody.data.creates) {
    const parsed = termInputSchema.safeParse(operation.values);
    if (!parsed.success) {
      errors.push(...issueMessages(parsed.error, operation.line));
      continue;
    }
    for (const domain of parsed.data.domain) if (!knownDomains.has(domain)) {
      errors.push(`${operation.line}번째 줄 · 도메인: “${domain}”은 분류 체계에 없는 도메인입니다.`);
    }
    for (const category of parsed.data.category ?? []) if (!knownCategories.has(category)) {
      errors.push(`${operation.line}번째 줄 · 업무 분류: “${category}”을(를) 찾을 수 없습니다.`);
    }
    errors.push(...duplicateMessages(operation.line, await findRepresentativeDuplicates(parsed.data)));
    for (const text of [parsed.data.nameEn, parsed.data.nameKo]) {
      const key = surfaceKeys(text ?? "").normLoose;
      if (key) representatives.push({ operation: `create:${operation.line}`, line: operation.line, text: text!, key });
    }
  }

  const byKey = new Map<string, typeof representatives>();
  for (const representative of representatives) {
    const entries = byKey.get(representative.key) ?? [];
    entries.push(representative);
    byKey.set(representative.key, entries);
  }
  for (const entries of byKey.values()) {
    const operations = [...new Set(entries.map((entry) => entry.operation))];
    if (operations.length < 2) continue;
    const lines = [...new Set(entries.map((entry) => entry.line))].sort((a, b) => a - b);
    errors.push(`${lines.join(", ")}번째 줄: 붙여넣을 대표 표기 “${entries[0]!.text}”가 서로 중복됩니다.`);
  }

  return Response.json({ ok: errors.length === 0, errors: [...new Set(errors)] });
});
