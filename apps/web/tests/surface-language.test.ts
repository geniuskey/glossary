import { expect, test } from "vitest";
import { inferSurfaceLang } from "../src/lib/terms/surface-language.js";

test("한글이 포함된 표기는 국문으로 판정한다", () => {
  expect(inferSurfaceLang("티오")).toBe("ko");
  expect(inferSurfaceLang("A컷")).toBe("ko");
});

test("한글 없이 영문자가 있는 표기는 영문으로 판정한다", () => {
  expect(inferSurfaceLang("T/O")).toBe("en");
  expect(inferSurfaceLang("ISO 9001")).toBe("en");
});

test("숫자와 기호만 있는 표기는 공통으로 판정한다", () => {
  expect(inferSurfaceLang("123")).toBe("neutral");
  expect(inferSurfaceLang("10:1")).toBe("neutral");
});
