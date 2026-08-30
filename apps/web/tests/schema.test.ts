import { expect, test } from "vitest";
import {
  DOMAIN_VALUE_MAX,
  TERM_DOMAIN_MAX,
  TERM_MARKDOWN_MAX,
  TERM_NAME_MAX,
  TERM_SURFACE_MAX,
} from "../src/lib/terms/limits.js";
import { termInputSchema, type TermInput } from "../src/lib/terms/schema.js";

function base(overrides: Partial<TermInput> = {}): TermInput {
  return {
    termType: "term",
    nameEn: "Probe",
    domain: [],
    status: "active",
    surfaces: [],
    ...overrides,
  };
}

test("새 용어는 명시적으로 공개하기 전까지 draft로 시작한다", () => {
  const parsed = termInputSchema.parse({ nameEn: "Draft Probe" });
  expect(parsed.status).toBe("draft");
});

test("용어 입력의 문자열과 배열은 서버 자원을 보호하는 상한을 가진다", () => {
  expect(termInputSchema.safeParse(base({ nameEn: "x".repeat(TERM_NAME_MAX + 1) })).success).toBe(false);
  expect(termInputSchema.safeParse(base({ domain: ["x".repeat(DOMAIN_VALUE_MAX + 1)] })).success).toBe(false);
  expect(termInputSchema.safeParse(base({ domain: Array(TERM_DOMAIN_MAX + 1).fill("domain") })).success).toBe(false);
  expect(
    termInputSchema.safeParse(
      base({ surfaces: Array(TERM_SURFACE_MAX + 1).fill({ text: "alias", lang: "en", kind: "alias" }) }),
    ).success,
  ).toBe(false);
  expect(termInputSchema.safeParse(base({ bodyMd: "x".repeat(TERM_MARKDOWN_MAX + 1) })).success).toBe(false);
});

// R45: 같은 정규화 키가 승인군(canonical/abbreviation/full_name/alias)과
// 비승인군(discouraged/forbidden)에 동시에 속하면 검색 결과가 스스로 모순된다.
// 리뷰가 실측: "R-Probe-One"(alias)과 "RProbe One"(forbidden)이 같은
// normLoose로 저장됐다.
test("승인군 kind와 비승인군 kind가 같은 정규화 키에 함께 있으면 거부된다 (R45)", () => {
  const result = termInputSchema.safeParse(
    base({
      nameEn: "R Probe One",
      surfaces: [{ text: "RProbe One", lang: "en", kind: "forbidden" }],
    }),
  );
  expect(result.success).toBe(false);
});

test("discouraged와 forbidden이 같은 정규화 키에 함께 있으면 거부된다 (R45)", () => {
  const result = termInputSchema.safeParse(
    base({
      nameEn: undefined,
      nameKo: "프로브",
      surfaces: [
        { text: "gain ctrl", lang: "en", kind: "discouraged" },
        { text: "GainCtrl", lang: "en", kind: "forbidden" },
      ],
    }),
  );
  expect(result.success).toBe(false);
});

test("같은 정규화 키라도 승인군끼리(canonical + abbreviation)는 허용된다 (R45)", () => {
  const result = termInputSchema.safeParse(
    base({
      nameEn: "AE",
      termType: "abbreviation",
      surfaces: [{ text: "ae", lang: "en", kind: "alias" }],
    }),
  );
  expect(result.success).toBe(true);
});

// R46: `.trim()`이 없으면 공백뿐인 문자열이 min(1)을 통과한다.
test("공백만 있는 nameEn은 trim 후 거부된다 (R46)", () => {
  const result = termInputSchema.safeParse(base({ nameEn: "   " }));
  expect(result.success).toBe(false);
});

// domain 배열은 surfaceKeys를 거치지 않으므로(용어 표기가 아니라 분류 태그다)
// checkSurfaceIntegrity의 빈-normLoose 체크가 백스톱이 되어주지 않는다. 여기서는
// domain 항목의 `.trim()` 자체가 유일한 방어선이다.
test("공백만 있는 domain 항목은 trim 후 거부된다 (R46)", () => {
  const result = termInputSchema.safeParse(base({ domain: ["ISP", "   "] }));
  expect(result.success).toBe(false);
});

test("공백만 있는 surface text는 trim 후 거부된다 (R46)", () => {
  const result = termInputSchema.safeParse(
    base({ surfaces: [{ text: "   ", lang: "en", kind: "alias" }] }),
  );
  expect(result.success).toBe(false);
});

// normalizeSurface의 구분자 집합(공백/-/_/·/・ 등)은 JS trim()보다 넓다. "---"는
// trim을 통과하지만 normLoose가 빈 문자열이 된다 — 별도의 superRefine 체크가
// 필요한 이유.
test("기호로만 이루어진 표기는 trim을 통과해도 정규화하면 빈 문자열이라 거부된다 (R46)", () => {
  const result = termInputSchema.safeParse(
    base({ surfaces: [{ text: "---", lang: "en", kind: "alias" }] }),
  );
  expect(result.success).toBe(false);
});

// re-review(Minor): "공백만 있으면 거부된다" 테스트는 `.trim()`을 지워도 통과한다 —
// checkSurfaceIntegrity의 빈-normLoose 체크가 그 경우를 독립적으로 잡아주기 때문이다.
// 하지만 `.trim()`에는 그 백스톱이 덮지 못하는 고유한 동작이 있다: 앞뒤 공백이 붙은
// 정상 값을 **다듬어서** 통과시키는 것. 실측으로 `.trim()`을 지우면 "  Gain Probe  "가
// terms.name_en과 term_surfaces.text에 공백째로 저장된다(슬러그와 normLoose는 다른
// 경로가 막아줘서 멀쩡하다). 그 값은 화면과 엑셀 내보내기에 그대로 나온다.
test("앞뒤 공백이 붙은 정상 값은 거부가 아니라 다듬어져서 통과한다 (R46)", () => {
  const result = termInputSchema.safeParse(
    base({
      nameEn: "  Gain Probe  ",
      nameKo: "  게인  ",
      fullNameEn: "  Gain Probe Full  ",
      domain: ["  ISP  "],
      surfaces: [{ text: "  GP  ", lang: "en", kind: "alias" }],
    }),
  );

  expect(result.success).toBe(true);
  if (!result.success) return;
  expect(result.data.nameEn).toBe("Gain Probe");
  expect(result.data.nameKo).toBe("게인");
  expect(result.data.fullNameEn).toBe("Gain Probe Full");
  expect(result.data.domain).toEqual(["ISP"]);
  expect(result.data.surfaces[0]!.text).toBe("GP");
});
