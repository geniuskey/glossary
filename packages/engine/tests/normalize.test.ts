import { describe, expect, test } from "vitest";
import { normalizeSurface } from "../src/normalize.js";

describe("normalizeSurface", () => {
  test("표기 변형이 하나로 수렴한다", () => {
    const variants = ["Auto Exposure", "auto-exposure", "AutoExposure", "auto_exposure"];
    for (const v of variants) {
      expect(normalizeSurface(v)).toEqual({ loose: "autoexposure", space: "auto exposure" });
    }
  });

  test("대문자 약어는 그대로 소문자화된다", () => {
    expect(normalizeSurface("AE")).toEqual({ loose: "ae", space: "ae" });
    expect(normalizeSurface("AWB")).toEqual({ loose: "awb", space: "awb" });
  });

  test("연속 대문자 뒤 단어 경계를 분리한다", () => {
    expect(normalizeSurface("MIPIRx")).toEqual({ loose: "mipirx", space: "mipi rx" });
    expect(normalizeSurface("MIPI Rx")).toEqual({ loose: "mipirx", space: "mipi rx" });
  });

  test("숫자와 문자 경계를 분리하지 않는다", () => {
    expect(normalizeSurface("IMX999")).toEqual({ loose: "imx999", space: "imx999" });
  });

  test("한글은 결합 형태로 유지하고 공백만 처리한다", () => {
    expect(normalizeSurface("이미지 센서")).toEqual({ loose: "이미지센서", space: "이미지 센서" });
    expect(normalizeSurface("이미지센서")).toEqual({ loose: "이미지센서", space: "이미지센서" });
  });

  test("전각 문자를 반각으로 정규화한다", () => {
    expect(normalizeSurface("ＡＥ")).toEqual({ loose: "ae", space: "ae" });
  });

  test("앞뒤 공백과 연속 공백을 정리한다", () => {
    expect(normalizeSurface("  Auto   Exposure  ")).toEqual({
      loose: "autoexposure",
      space: "auto exposure",
    });
  });

  test("빈 문자열과 구분자만 있는 입력을 견딘다", () => {
    expect(normalizeSurface("")).toEqual({ loose: "", space: "" });
    expect(normalizeSurface(" - _ ")).toEqual({ loose: "", space: "" });
  });
});
