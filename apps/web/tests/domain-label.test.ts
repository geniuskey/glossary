import { expect, test } from "vitest";
import { isValidDomainLabel, resolveDomainLabels } from "../src/lib/terms/domain-label.js";

const NFD_GENERAL = "일반".normalize("NFD");

test("화면에 같게 보이는 NFD·NBSP·대소문자 차이는 분류 체계 이름으로 맞춘다", () => {
  expect(NFD_GENERAL).not.toBe("일반");
  expect(resolveDomainLabels(["일반", "반도체 ", "it"], [NFD_GENERAL, "반도체", "IT"])).toEqual({
    labels: [NFD_GENERAL, "반도체", "IT"],
    unknown: [],
  });
});

test("없는 도메인은 정규화한 값으로 unknown에 모은다", () => {
  expect(resolveDomainLabels(["일반", ` ${NFD_GENERAL}광학 `], ["일반"])).toEqual({
    labels: ["일반"],
    unknown: ["일반광학".normalize("NFC")],
  });
});

test("이미 붙어 있던 값은 분류 체계에 없어도 통과하고, 분류 체계에 있으면 그 이름으로 바꾼다", () => {
  expect(resolveDomainLabels(["레거시", "일반"], [NFD_GENERAL], ["레거시", "일반"])).toEqual({
    labels: ["레거시", NFD_GENERAL],
    unknown: [],
  });
});

test("같은 키로 겹치는 입력은 하나만 남긴다", () => {
  expect(resolveDomainLabels(["IT", "it", " IT "], ["IT"]).labels).toEqual(["IT"]);
});

test("편집 폼이 쉼표로 쪼개므로 도메인 이름에 쉼표를 허용하지 않는다", () => {
  expect(isValidDomainLabel("메모리, 파운드리")).toBe(false);
  expect(isValidDomainLabel("메모리 / 파운드리")).toBe(true);
});
