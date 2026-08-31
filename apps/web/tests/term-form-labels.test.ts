import { expect, test } from "vitest";
import { TERM_TYPES } from "../src/lib/terms/enums.js";
import { TERM_FIELD_LABELS } from "../src/lib/terms/form-labels.js";

test("모든 용어 종류에 전용 대표 표기 문구가 있다", () => {
  expect(Object.keys(TERM_FIELD_LABELS).sort()).toEqual([...TERM_TYPES].sort());
  expect(TERM_FIELD_LABELS.term.nameEn).toContain("용어");
  expect(TERM_FIELD_LABELS.abbreviation.nameEn).toContain("약어");
  expect(TERM_FIELD_LABELS.product_id.nameEn).toContain("제품 ID");
  expect(TERM_FIELD_LABELS.unit.nameEn).toContain("단위 기호");
});

test("풀네임 고정 필드는 약어에서만 기본 노출한다", () => {
  expect(TERM_FIELD_LABELS.abbreviation.showFullNames).toBe(true);
  expect(TERM_FIELD_LABELS.term.showFullNames).toBe(false);
});
