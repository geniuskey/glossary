import { z } from "zod";

export const surfaceInputSchema = z.object({
  text: z.string().min(1),
  lang: z.enum(["en", "ko", "neutral"]).default("neutral"),
  kind: z.enum(["canonical", "abbreviation", "full_name", "alias", "discouraged", "forbidden"]),
  caseSensitive: z.boolean().optional(),
});

export const termInputBaseSchema = z.object({
  termType: z.enum(["term", "abbreviation", "project", "product_id", "code", "unit"]).default("term"),
  nameEn: z.string().min(1).optional(),
  nameKo: z.string().min(1).optional(),
  fullNameEn: z.string().min(1).optional(),
  fullNameKo: z.string().min(1).optional(),
  domain: z.array(z.string().min(1)).default([]),
  status: z.enum(["draft", "approved", "deprecated", "forbidden"]).default("draft"),
  definitionMd: z.string().optional(),
  // R33: terms.body_md 컬럼은 Task 9의 상세 API가 읽어서 그대로 반환하지만, 이
  // 필드가 없으면 어떤 API/폼으로도 채울 방법이 없어 영원히 null로 남는다.
  // 용어 페이지는 마크다운으로 작성·열람되어야 한다는 요구를 만족하려면 쓰기
  // 경로에 필드가 있어야 한다. Task 10(patch)과 Task 13(폼)이 이어받는다.
  bodyMd: z.string().optional(),
  surfaces: z.array(surfaceInputSchema).default([]),
});

/** 생성용. 표준 표기가 최소 하나는 있어야 한다. */
export const termInputSchema = termInputBaseSchema.refine(
  (v) => Boolean(v.nameEn ?? v.nameKo),
  { message: "nameEn 또는 nameKo 중 최소 하나가 필요합니다.", path: ["nameEn"] },
);

/**
 * 수정용. 부분 갱신이라 표준 표기 필수 조건을 걸지 않는다.
 * termInputSchema는 .refine()이 붙은 ZodEffects라서 .partial()을 부를 수 없다.
 * base를 따로 두고 여기서 파생시키는 이유가 이것이다.
 */
export const termPatchSchema = termInputBaseSchema.partial().extend({
  expectedRevision: z.number().int().positive().optional(),
});

export type TermInput = z.infer<typeof termInputBaseSchema>;
export type SurfaceInput = z.infer<typeof surfaceInputSchema>;
