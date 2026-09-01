import { z } from "zod";
import { surfaceKeys } from "@grossary/db";
import {
  DOMAIN_VALUE_MAX,
  TERM_DOMAIN_MAX,
  TERM_MARKDOWN_MAX,
  TERM_NAME_MAX,
  TERM_SURFACE_MAX,
} from "./limits";
import { deriveSurfaces } from "./surfaces";
import { slugify, slugValidationMessage } from "./slug";
import { BUSINESS_CATEGORIES, TERM_TYPES } from "./enums";

// R46: `.trim()`이 없으면 `z.string().min(1)`은 공백뿐인 문자열("   ")을 통과시킨다.
// 그 값은 surfaceKeys(...).normLoose === ""로 정규화되는데, findDuplicates가
// `.filter(Boolean)`으로 빈 키를 걸러내기 때문에 그런 표기는 절대 경고 대상이
// 될 수 없고, 검색에서도 영원히 보이지 않으면서 term/term-2 슬러그 네임스페이스만
// 잠식한다. text/nameEn/nameKo/fullNameEn/fullNameKo/domain 각 항목에 trim을 건다.
export const surfaceInputSchema = z.object({
  text: z.string().trim().min(1).max(TERM_NAME_MAX),
  lang: z.enum(["en", "ko", "neutral"]).default("neutral"),
  kind: z.enum(["canonical", "abbreviation", "full_name", "alias", "discouraged", "forbidden"]),
  caseSensitive: z.boolean().optional(),
});

// R117: 표준명/풀네임은 nullable이다. `.min(1).optional()`만으로는 "값을
// 지운다"를 표현할 방법이 없다 — 빈 문자열은 400이고, 필드를 빼면 PATCH에서는
// "안 건드림"을 뜻하기 때문이다. 표에서 셀을 비우는 동작(엑셀에서 Delete)이
// 바로 이 경우라서, 명시적인 null을 "지운다"로 받는다. 공백만 남은 값도
// 여전히 400이다(R46 — trim 후 min(1)).
const LEGACY_TERM_TYPE: Record<string, (typeof TERM_TYPES)[number]> = {
  term: "concept",
  abbreviation: "concept",
  project: "proper_name",
  product_id: "identifier",
  code: "identifier",
  unit: "unit",
};

/** v0.1.x 요청을 새 2축 분류로 옮긴다. 자유 입력 category는 topic으로 보존한다. */
export function normalizeLegacyTermInput(raw: unknown): unknown {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const next = { ...(raw as Record<string, unknown>) };
  const oldType = typeof next.termType === "string" ? next.termType : undefined;
  if (oldType && LEGACY_TERM_TYPE[oldType]) next.termType = LEGACY_TERM_TYPE[oldType];

  if (
    oldType && LEGACY_TERM_TYPE[oldType]
    && typeof next.category === "string"
    && !(BUSINESS_CATEGORIES as readonly string[]).includes(next.category)
  ) {
    if (next.topic === undefined) next.topic = next.category;
    delete next.category;
  }
  if ((next.category === undefined || next.category === null) && oldType === "project") next.category = "project";
  if ((next.category === undefined || next.category === null) && oldType === "product_id") next.category = "product";
  return next;
}

export const termInputBaseSchema = z.object({
  termType: z.enum(TERM_TYPES).default("concept"),
  nameEn: z.string().trim().min(1).max(TERM_NAME_MAX).nullable().optional(),
  nameKo: z.string().trim().min(1).max(TERM_NAME_MAX).nullable().optional(),
  fullNameEn: z.string().trim().min(1).max(TERM_NAME_MAX).nullable().optional(),
  fullNameKo: z.string().trim().min(1).max(TERM_NAME_MAX).nullable().optional(),
  domain: z.array(z.string().trim().min(1).max(DOMAIN_VALUE_MAX)).max(TERM_DOMAIN_MAX).default([]),
  category: z.string().trim().min(1).max(64).regex(/^[\p{Letter}\p{Number}]+(?:-[\p{Letter}\p{Number}]+)*$/u).nullable().optional(),
  topic: z.string().trim().min(1).max(DOMAIN_VALUE_MAX).nullable().optional(),
  ownerId: z.string().uuid().nullable().optional(),
  status: z.enum(["draft", "active", "deprecated", "forbidden"]).default("draft"),
  definitionMd: z.string().max(TERM_MARKDOWN_MAX).optional(),
  // R33: terms.body_md 컬럼은 Task 9의 상세 API가 읽어서 그대로 반환하지만, 이
  // 필드가 없으면 어떤 API/폼으로도 채울 방법이 없어 영원히 null로 남는다.
  // 용어 페이지는 마크다운으로 작성·열람되어야 한다는 요구를 만족하려면 쓰기
  // 경로에 필드가 있어야 한다. Task 10(patch)과 Task 13(폼)이 이어받는다.
  bodyMd: z.string().max(TERM_MARKDOWN_MAX).optional(),
  surfaces: z.array(surfaceInputSchema).max(TERM_SURFACE_MAX).default([]),
});

const APPROVED_KINDS = new Set(["canonical", "abbreviation", "full_name", "alias"]);
const DISALLOWED_KINDS = new Set(["discouraged", "forbidden"]);

/**
 * R45/R46: 파생 + 명시 표기를 합쳐서 정규화 키 단위로 검증한다.
 * - R45: 같은 정규화 키가 승인군(canonical/abbreviation/full_name/alias)과
 *   비승인군(discouraged/forbidden)에 동시에 속하면 안 된다. 비승인군 두
 *   kind가 같은 키에 함께 있는 것도 금지한다("PROBE-AE"가 discouraged이자
 *   forbidden일 수는 없다). 리뷰가 실측한 회귀: "R-Probe-One"(alias)과
 *   "RProbe One"(forbidden)이 같은 normLoose로 저장되어 검색에서 어느 쪽이
 *   맞는지 모순되게 나타났다.
 * - R46: text/nameEn/nameKo/fullNameEn/fullNameKo가 trim 후에도 기호로만
 *   이루어져("---") surfaceKeys(...).normLoose가 빈 문자열이 되는 경우를
 *   막는다. `.trim().min(1)`만으로는 못 잡는다 — normalizeSurface의 구분자
 *   집합(공백/–/_/·/・ 등)은 JS의 trim()보다 넓다.
 *
 * R52(Task 10): termPatchSchema는 `.partial()`이라 여기 붙는 superRefine을
 * 재사용할 수 없고(termInputSchema는 이미 ZodEffects라 `.partial()`을 부를 수
 * 없다), 더 근본적으로 patch의 최종 표기 집합은 "기존 행 + patch"를 병합해야만
 * 알 수 있어 zod 스키마 시점에는 아예 보이지 않는다. 이 검증 로직 자체를 순수
 * 함수로 분리해서, updateTerm이 병합된 표기 집합에 대해 직접 호출할 수 있게
 * 한다. 아래 checkSurfaceIntegrity는 그 함수를 termInputSchema용으로 얇게
 * 감싼 어댑터일 뿐이다.
 */
export function checkSurfaceConflicts(surfaces: SurfaceInput[]): string[] {
  const issues: string[] = [];

  for (const s of surfaces) {
    if (surfaceKeys(s.text).normLoose === "") {
      issues.push(`"${s.text}"는 정규화하면 빈 문자열이 되어 표기로 쓸 수 없습니다.`);
    }
  }

  const kindsByKey = new Map<string, Set<string>>();
  for (const s of surfaces) {
    const key = surfaceKeys(s.text).normLoose;
    if (!key) continue;
    if (!kindsByKey.has(key)) kindsByKey.set(key, new Set());
    kindsByKey.get(key)!.add(s.kind);
  }

  for (const [key, kinds] of kindsByKey) {
    const hasApproved = [...kinds].some((k) => APPROVED_KINDS.has(k));
    const hasDisallowed = [...kinds].some((k) => DISALLOWED_KINDS.has(k));
    const bothDisallowed = kinds.has("discouraged") && kinds.has("forbidden");
    if ((hasApproved && hasDisallowed) || bothDisallowed) {
      issues.push(`표기 "${key}"에 서로 모순되는 kind가 함께 지정되었습니다: ${[...kinds].join(", ")}`);
    }
  }

  return issues;
}

function checkSurfaceIntegrity(v: z.infer<typeof termInputBaseSchema>, ctx: z.RefinementCtx) {
  const surfaces = deriveSurfaces(v, v.surfaces);
  for (const message of checkSurfaceConflicts(surfaces)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message, path: ["surfaces"] });
  }
}

/** 생성용. 표준 표기가 최소 하나는 있어야 한다. */
const currentTermInputSchema = termInputBaseSchema
  .refine((v) => Boolean(v.nameEn ?? v.nameKo), {
    message: "nameEn 또는 nameKo 중 최소 하나가 필요합니다.",
    path: ["nameEn"],
  })
  .superRefine(checkSurfaceIntegrity);

export const termInputSchema = z.preprocess(normalizeLegacyTermInput, currentTermInputSchema);

/**
 * 수정용. 부분 갱신이라 표준 표기 필수 조건을 걸지 않는다.
 * termInputSchema는 .refine()이 붙은 ZodEffects라서 .partial()을 부를 수 없다.
 * base를 따로 두고 여기서 파생시키는 이유가 이것이다.
 */
const currentTermPatchSchema = termInputBaseSchema.partial().extend({
  slug: z.string().trim().transform(slugify).superRefine((slug, ctx) => {
    const message = slugValidationMessage(slug);
    if (message) ctx.addIssue({ code: z.ZodIssueCode.custom, message });
  }).optional(),
  expectedRevision: z.number().int().positive().optional(),
});

export const termPatchSchema = z.preprocess(normalizeLegacyTermInput, currentTermPatchSchema);

export type TermInput = z.infer<typeof termInputBaseSchema>;
export type SurfaceInput = z.infer<typeof surfaceInputSchema>;
