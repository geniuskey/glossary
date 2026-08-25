import { expect, test } from "vitest";
import { slugify } from "../src/lib/terms/slug.js";

test("영문 표기를 하이픈 슬러그로 만든다", () => {
  expect(slugify("Auto Exposure")).toBe("auto-exposure");
  expect(slugify("MIPI Rx")).toBe("mipi-rx");
});

test("한글은 그대로 두고 공백만 하이픈으로 바꾼다", () => {
  expect(slugify("이미지 센서")).toBe("이미지-센서");
});

test("연속 구분자를 하나로 접고 양끝을 정리한다", () => {
  expect(slugify("  Auto -- Exposure  ")).toBe("auto-exposure");
});

test("슬러그로 만들 수 없는 입력에는 빈 문자열을 반환한다", () => {
  expect(slugify("!!!")).toBe("");
});
