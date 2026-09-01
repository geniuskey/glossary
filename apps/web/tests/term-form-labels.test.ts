import { expect, test } from "vitest";
import { TERM_TYPES } from "../src/lib/terms/enums.js";
import { TERM_FIELD_LABELS } from "../src/lib/terms/form-labels.js";

test("모든 Type에 전용 대표 표기 문구가 있다", () => {
  expect(Object.keys(TERM_FIELD_LABELS).sort()).toEqual([...TERM_TYPES].sort());
  expect(TERM_FIELD_LABELS.concept.nameEn).toContain("용어");
  expect(TERM_FIELD_LABELS.proper_name.nameEn).toContain("고유명칭");
  expect(TERM_FIELD_LABELS.identifier.nameEn).toContain("식별자");
  expect(TERM_FIELD_LABELS.unit.nameEn).toContain("단위 기호");
});

test("풀네임은 Type이 아니라 추가 표기로 관리한다", () => {
  expect(Object.values(TERM_FIELD_LABELS).every((labels) => !labels.showFullNames)).toBe(true);
});
