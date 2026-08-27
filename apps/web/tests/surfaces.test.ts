import { expect, test } from "vitest";
import { defaultCaseSensitive, deriveSurfaces, pickExplicitSurfaces } from "../src/lib/terms/surfaces.js";

// M3(리뷰): surfaces.ts는 create.ts를 거쳐 간접적으로만 두들겨졌고, createTerm에
// 비어있지 않은 surfaces를 넘기는 테스트가 하나도 없었다. 순수 함수라 DB 없이
// 직접 테스트한다.

test("nameEn은 termType이 term이면 canonical, abbreviation이면 abbreviation kind로 파생된다", () => {
  const canonical = deriveSurfaces({ termType: "term", nameEn: "Auto Exposure" }, []);
  expect(canonical.find((s) => s.text === "Auto Exposure")?.kind).toBe("canonical");

  const abbrev = deriveSurfaces({ termType: "abbreviation", nameEn: "AE" }, []);
  expect(abbrev.find((s) => s.text === "AE")?.kind).toBe("abbreviation");
});

// term_surfaces_unique는 (term_id, norm_loose, kind)로 걸려 있다. deriveSurfaces의
// 중복 제거 키는 이 인덱스와 정확히 같아야 한다 — text나 lang이 달라도 normLoose+kind가
// 같으면 하나만 남아야 저장 시 unique violation을 피한다.
test("명시 표기가 파생 표기와 같은 정규화 키 + kind이면 하나로 합쳐진다", () => {
  const result = deriveSurfaces(
    { termType: "term", nameEn: "Auto Exposure" },
    [{ text: "auto-exposure", lang: "en", kind: "canonical" }],
  );
  const canonicalSurfaces = result.filter((s) => s.kind === "canonical");
  expect(canonicalSurfaces).toHaveLength(1);
  // 파생 표기가 명시 표기보다 앞에 온다(...derived, ...explicit) → 먼저 seen에
  // 들어간 파생 표기가 살아남는다.
  expect(canonicalSurfaces[0]!.text).toBe("Auto Exposure");
});

test("같은 정규화 키라도 kind가 다르면 둘 다 남는다", () => {
  const result = deriveSurfaces(
    { termType: "term", nameEn: "Auto Exposure" },
    [{ text: "Auto Exposure", lang: "en", kind: "alias" }],
  );
  expect(result).toHaveLength(2);
  expect(result.map((s) => s.kind).sort()).toEqual(["alias", "canonical"]);
});

test("defaultCaseSensitive는 2~6자 대문자/숫자 조합에서만 참이다", () => {
  expect(defaultCaseSensitive("AE")).toBe(true);
  expect(defaultCaseSensitive("Auto Exposure")).toBe(false);
  expect(defaultCaseSensitive("PROBEAE")).toBe(false); // 7자라 길이 상한을 넘는다
});

// R110: pickExplicitSurfaces는 update.ts(updateTerm)와 Task 13 편집 폼 초기값
// 계산이 공유하는 분류 함수다 — "저장된 표기 중 표준 이름에서 파생 가능한
// 것"을 뺀 나머지만 명시 표기로 본다. deriveSurfaces와 반대 방향의 연산이므로
// 여기서 직접 왕복시켜 확인한다.

test("표준 이름에서 파생된 표기는 명시 표기 목록에서 빠진다 (R110)", () => {
  const names = { termType: "term", nameEn: "Auto Exposure", nameKo: "자동노출" };
  const stored = [
    { text: "Auto Exposure", kind: "canonical" },
    { text: "자동노출", kind: "canonical" },
  ];
  expect(pickExplicitSurfaces(names, stored)).toEqual([]);
});

test("사용자가 직접 추가한 표기는 명시 표기 목록에 남는다 (R110)", () => {
  const names = { termType: "term", nameEn: "Auto Exposure" };
  const stored = [
    { text: "Auto Exposure", kind: "canonical" }, // 파생 가능 → 제외
    { text: "AE-legacy", kind: "alias" }, // 파생 불가 → 유지
  ];
  const result = pickExplicitSurfaces(names, stored);
  expect(result).toHaveLength(1);
  expect(result[0]!.text).toBe("AE-legacy");
});

// abbreviation 타입은 nameEn이 canonical이 아니라 abbreviation kind로 파생된다
// (deriveSurfaces:27) — 같은 텍스트라도 kind가 canonical로 저장돼 있으면 파생
// 키(`정규화:abbreviation`)와 안 맞아서 명시 표기로 잘못 남을 수 있다. kind까지
// 맞아야 정확히 걸러지는지 확인한다.
test("kind가 파생 결과와 다르면(같은 텍스트라도) 명시 표기로 남는다 (R110)", () => {
  const names = { termType: "abbreviation", nameEn: "AE" };
  const stored = [{ text: "AE", kind: "canonical" }]; // 파생은 abbreviation kind
  expect(pickExplicitSurfaces(names, stored)).toEqual(stored);
});

// updateTerm의 실제 사용처는 T가 normLoose 등 추가 필드를 가진 DB 행이다 —
// pickExplicitSurfaces가 필터만 하고 원본 객체를 그대로 돌려주는지(제네릭
// T가 유지되는지) 확인한다.
test("여분 필드가 있는 행도 그대로 유지된 채 걸러진다 (R110)", () => {
  const names = { termType: "term", nameEn: "Auto Exposure" };
  const stored = [
    { text: "Auto Exposure", kind: "canonical", normLoose: "autoexposure", lang: "en", caseSensitive: false },
    { text: "AE-legacy", kind: "alias", normLoose: "aelegacy", lang: "en", caseSensitive: true },
  ];
  const result = pickExplicitSurfaces(names, stored);
  expect(result).toEqual([stored[1]]);
});
