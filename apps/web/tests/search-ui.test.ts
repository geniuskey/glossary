import { expect, test } from "vitest";
import {
  groupSuggestions,
  matchedPrefixLength,
  moveActive,
  termHref,
  type Suggestion,
} from "../src/lib/terms/search-ui.js";

// search-ui.ts는 DB를 보지 않는다(R114). 그래서 여기 있는 것은 전부 순수 함수
// 테스트다 — jsdom이 없는 저장소에서 드롭다운의 동작을 잠글 수 있는 유일한
// 지점이 이 함수들이다.

function hit(over: Partial<Suggestion>): Suggestion {
  return {
    id: over.id ?? "x",
    slug: "soc",
    matchedText: "SoC",
    matchedKind: "alias",
    nameEn: "System on Chip",
    nameKo: null,
    status: "active",
    exact: false,
    prefix: true,
    ...over,
  };
}

test("termHref: 표준명으로 맞았으면 ?from=을 붙이지 않는다", () => {
  const base = { slug: "soc", nameEn: "System on Chip", nameKo: "시스템 온 칩" };
  expect(termHref({ ...base, matchedText: "System on Chip" })).toBe("/w/soc");
  expect(termHref({ ...base, matchedText: "시스템 온 칩" })).toBe("/w/soc");
});

test("termHref: 다른 표기로 맞았으면 그 표기를 ?from=으로 싣는다", () => {
  const href = termHref({ slug: "soc", nameEn: "System on Chip", nameKo: null, matchedText: "SoC 칩" });
  const url = new URL(href, "http://x");
  expect(url.pathname).toBe("/w/soc");
  // 공백·한글이 그대로 실리면 주소가 깨진다.
  expect(url.searchParams.get("from")).toBe("SoC 칩");
});

test("groupSuggestions: 자동완성과 비슷한 표기를 나누고, 각 묶음 안의 순서는 서버 랭킹 그대로다", () => {
  const items = [
    hit({ id: "a", prefix: true }),
    hit({ id: "b", prefix: false }),
    hit({ id: "c", prefix: true }),
  ];
  const { completions, similar } = groupSuggestions(items);

  // 서버가 매긴 순서를 다시 정렬하면 "가장 가까운 것이 맨 위"가 조용히 깨진다.
  expect(completions.map((s) => s.id)).toEqual(["a", "c"]);
  expect(similar.map((s) => s.id)).toEqual(["b"]);
});

test("moveActive: 목록 끝에서 한 번 더 내리면 입력창(-1)으로 돌아온다", () => {
  expect(moveActive(-1, 1, 3)).toBe(0);
  expect(moveActive(0, 1, 3)).toBe(1);
  // 끝에서 멈추면 사용자가 직접 친 문자열로 제출할 방법이 사라진다.
  expect(moveActive(2, 1, 3)).toBe(-1);
  expect(moveActive(-1, 1, 3)).toBe(0);
});

test("moveActive: 위로도 같은 고리를 돈다", () => {
  expect(moveActive(-1, -1, 3)).toBe(2);
  expect(moveActive(0, -1, 3)).toBe(-1);
});

test("moveActive: 후보가 없으면 어디로도 가지 않는다", () => {
  // 후보 0개에서 나머지 연산을 그대로 돌리면 0으로 나누는 꼴이 되어 NaN이 되고,
  // aria-activedescendant가 존재하지 않는 id를 가리킨다.
  expect(moveActive(-1, 1, 0)).toBe(-1);
  expect(moveActive(2, -1, 0)).toBe(-1);
});

test("matchedPrefixLength: 대소문자만 무시하고 앞부분을 센다", () => {
  expect(matchedPrefixLength("System on Chip", "sys")).toBe(3);
  expect(matchedPrefixLength("SoC", "  so ")).toBe(2);
  expect(matchedPrefixLength("SoC", "   ")).toBe(0);
});

test("matchedPrefixLength: 정규화로만 맞은 경우에는 아무것도 칠하지 않는다", () => {
  // "sysonchip"은 norm_loose로는 "System on Chip"과 같지만, 눈에 보이는
  // 문자열의 접두사는 아니다. 길이만 믿고 잘라 칠하면 "System on"이 굵어진다.
  expect(matchedPrefixLength("System on Chip", "sysonchip")).toBe(0);
  expect(matchedPrefixLength("SoC", "systm")).toBe(0);
});
