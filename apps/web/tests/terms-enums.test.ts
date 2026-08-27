import { surfaceKindEnum, surfaceLangEnum, termStatusEnum, termTypeEnum } from "@grossary/db";
import { expect, test } from "vitest";
import {
  EXPLICIT_SURFACE_KINDS,
  SURFACE_LANGS,
  TERM_STATUSES,
  TERM_TYPES,
} from "../src/lib/terms/enums.js";

// R114: enums.ts는 term-form.tsx(클라이언트 번들)가 @grossary/db를 직접 import하지
// 않도록 하기 위한 리터럴 배열 사본이다. 사본이라 원본(DB pgEnum)과 어긋날 수
// 있다 — 어긋나면 폼이 존재하지 않는 값을 보내 400을 받거나, 실제로 존재하는
// 값을 선택지에서 빠뜨린다. 순서는 의미가 없으므로 집합으로 비교한다.

test("TERM_TYPES는 termTypeEnum과 정확히 같은 집합이다 (R114)", () => {
  expect(new Set(TERM_TYPES)).toEqual(new Set(termTypeEnum.enumValues));
  expect(TERM_TYPES.length).toBe(termTypeEnum.enumValues.length);
});

test("TERM_STATUSES는 termStatusEnum과 정확히 같은 집합이다 (R114)", () => {
  expect(new Set(TERM_STATUSES)).toEqual(new Set(termStatusEnum.enumValues));
  expect(TERM_STATUSES.length).toBe(termStatusEnum.enumValues.length);
});

test("SURFACE_LANGS는 surfaceLangEnum과 정확히 같은 집합이다 (R114)", () => {
  expect(new Set(SURFACE_LANGS)).toEqual(new Set(surfaceLangEnum.enumValues));
  expect(SURFACE_LANGS.length).toBe(surfaceLangEnum.enumValues.length);
});

// EXPLICIT_SURFACE_KINDS는 surfaceKindEnum에서 "canonical"만 뺀 나머지다 —
// canonical은 표준 이름 필드에서만 파생되고 사용자가 직접 고르지 못한다
// (enums.ts:14-18 주석). 이 관계를 구조적으로 고정한다.
test("EXPLICIT_SURFACE_KINDS는 surfaceKindEnum에서 canonical만 뺀 것과 같다 (R114)", () => {
  const expected = new Set(surfaceKindEnum.enumValues.filter((k) => k !== "canonical"));
  expect(new Set(EXPLICIT_SURFACE_KINDS)).toEqual(expected);
  expect(EXPLICIT_SURFACE_KINDS.length).toBe(surfaceKindEnum.enumValues.length - 1);
});

test("EXPLICIT_SURFACE_KINDS는 canonical을 포함하지 않는다 (R114)", () => {
  expect(EXPLICIT_SURFACE_KINDS).not.toContain("canonical");
  expect(surfaceKindEnum.enumValues).toContain("canonical"); // DB에는 존재함을 대조 확인
});
