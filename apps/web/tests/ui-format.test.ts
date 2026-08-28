import { expect, test } from "vitest";
import { cx, displayName, isoDate, relativeTime, spineHue } from "../src/lib/ui/format.js";

// 날짜 라이브러리를 들이지 않고 직접 만든 함수들이라(번들 크기가 제약), 경계는
// 여기서 고정한다. 특히 relativeTime의 "어제"는 시간 차가 아니라 달력 날짜
// 차이로 판단해야 한다 — 23:50 → 00:10이 "방금"으로 나오면 안 된다.

test("cx: falsy는 버리고 나머지만 공백으로 잇는다", () => {
  expect(cx("a", false, null, undefined, "b")).toBe("a b");
  expect(cx()).toBe("");
});

test("isoDate: 로컬 타임존 기준 연-월-일이고 0을 채운다", () => {
  expect(isoDate(new Date(2026, 0, 5))).toBe("2026-01-05");
  expect(isoDate(new Date(2026, 11, 31))).toBe("2026-12-31");
});

test("relativeTime: 1분 미만은 '방금'", () => {
  const now = new Date(2026, 7, 28, 12, 0, 0);
  expect(relativeTime(new Date(2026, 7, 28, 11, 59, 30), now)).toBe("방금");
});

test("relativeTime: 분/시간 단위", () => {
  const now = new Date(2026, 7, 28, 12, 0, 0);
  expect(relativeTime(new Date(2026, 7, 28, 11, 45, 0), now)).toBe("15분 전");
  expect(relativeTime(new Date(2026, 7, 28, 9, 0, 0), now)).toBe("3시간 전");
});

test("relativeTime: 자정을 넘겼는지로 '어제'를 판단한다(시간 차가 아니라)", () => {
  // 20분 차이지만 날짜가 바뀌었다 — 시간 차로 계산하면 "20분 전"이 나온다.
  const justAfterMidnight = new Date(2026, 7, 28, 0, 10, 0);
  const beforeMidnight = new Date(2026, 7, 27, 23, 50, 0);
  expect(relativeTime(beforeMidnight, justAfterMidnight)).toBe("20분 전");

  // 반대로 30시간 전은 달력상 이틀 전이라 "어제"가 아니다.
  const now = new Date(2026, 7, 28, 12, 0, 0);
  expect(relativeTime(new Date(2026, 7, 27, 12, 0, 0), now)).toBe("어제");
  expect(relativeTime(new Date(2026, 7, 26, 12, 0, 0), now)).toBe("2일 전");
});

test("relativeTime: 6시간 이상 지났지만 같은 날이면 시간 단위로 남는다", () => {
  const now = new Date(2026, 7, 28, 23, 0, 0);
  expect(relativeTime(new Date(2026, 7, 28, 8, 0, 0), now)).toBe("15시간 전");
});

test("relativeTime: 일주일 이상은 ISO 날짜로 되돌아간다", () => {
  const now = new Date(2026, 7, 28, 12, 0, 0);
  expect(relativeTime(new Date(2026, 7, 1, 12, 0, 0), now)).toBe("2026-08-01");
});

test("relativeTime: 미래 시각(서버-클라이언트 시계 차)은 날짜로 보여준다", () => {
  const now = new Date(2026, 7, 28, 12, 0, 0);
  expect(relativeTime(new Date(2026, 7, 29, 12, 0, 0), now)).toBe("2026-08-29");
});

test("spineHue: 같은 seed는 항상 같은 값, 범위는 0~359", () => {
  // 서버 렌더와 클라이언트 렌더가 다른 색을 내면 하이드레이션이 어긋난다.
  const a = spineHue("interstitial-slide-point");
  expect(spineHue("interstitial-slide-point")).toBe(a);
  expect(a).toBeGreaterThanOrEqual(0);
  expect(a).toBeLessThan(360);
  expect(spineHue("")).toBeGreaterThanOrEqual(0);
});

test("spineHue: 다른 seed는 (적어도 대체로) 다른 값을 낸다", () => {
  const seeds = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"];
  const hues = new Set(seeds.map(spineHue));
  expect(hues.size).toBeGreaterThan(seeds.length / 2);
});

test("displayName: 영문 → 국문 → 슬러그 순으로 물러난다", () => {
  expect(displayName({ nameEn: "Point", nameKo: "지점", slug: "point" })).toBe("Point");
  expect(displayName({ nameEn: null, nameKo: "지점", slug: "point" })).toBe("지점");
  expect(displayName({ nameEn: null, nameKo: null, slug: "point" })).toBe("point");
});
