import { surfaceKindEnum, surfaceLangEnum, termQualityProfileEnum, termStatusEnum, termTypeEnum } from "@glossary/db";
import { expect, test } from "vitest";
import {
  EXPLICIT_SURFACE_KINDS,
  SURFACE_LANGS,
  TERM_STATUSES,
  TERM_TYPES,
} from "../src/lib/terms/enums.js";
import { TERM_QUALITY_PROFILES } from "../src/lib/workspace/term-quality-values.js";

// R114: enums.ts는 term-form.tsx(클라이언트 번들)가 @glossary/db를 직접 import하지
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

test("EXPLICIT_SURFACE_KINDS는 복수 표준명을 포함해 DB surface kind 전체와 같다 (R114)", () => {
  expect(new Set(EXPLICIT_SURFACE_KINDS)).toEqual(new Set(surfaceKindEnum.enumValues));
  expect(EXPLICIT_SURFACE_KINDS.length).toBe(surfaceKindEnum.enumValues.length);
  expect(EXPLICIT_SURFACE_KINDS).toContain("canonical");
});

test("TERM_QUALITY_PROFILES는 DB 품질 프로필 enum과 정확히 같은 집합이다", () => {
  expect(new Set(TERM_QUALITY_PROFILES)).toEqual(new Set(termQualityProfileEnum.enumValues));
  expect(TERM_QUALITY_PROFILES.length).toBe(termQualityProfileEnum.enumValues.length);
});
