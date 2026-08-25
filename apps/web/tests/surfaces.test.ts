import { expect, test } from "vitest";
import { defaultCaseSensitive, deriveSurfaces } from "../src/lib/terms/surfaces.js";

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
