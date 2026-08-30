import { expect, test } from "vitest";
import { termCompletion } from "../src/lib/terms/completion.js";

test("약어만 덩그러니 있으면 풀네임·정의·분야가 모두 정리 대상으로 나온다", () => {
  expect(termCompletion({ termType: "abbreviation", domain: [] })).toEqual({
    complete: false,
    completed: 0,
    total: 3,
    percent: 0,
    missing: ["expansion", "definition", "domain"],
  });
});

test("약어는 영문 또는 국문 풀네임 중 하나만 있어도 확장명 항목을 채운 것으로 본다", () => {
  const completion = termCompletion({
    termType: "abbreviation",
    fullNameKo: "자동 노출",
    definitionMd: "센서 노출을 자동으로 조정하는 기능",
    domain: ["ISP"],
  });
  expect(completion).toMatchObject({ complete: true, completed: 3, total: 3, percent: 100, missing: [] });
});

test("일반 용어는 풀네임을 요구하지 않고 정의와 분야만 최소 기준으로 삼는다", () => {
  const completion = termCompletion({ termType: "term", definitionMd: "설명", domain: [] });
  expect(completion).toMatchObject({ complete: false, completed: 1, total: 2, percent: 50 });
  expect(completion.missing).toEqual(["domain"]);
});

test("공백뿐인 값은 채워진 정보로 세지 않는다", () => {
  const completion = termCompletion({
    termType: "abbreviation",
    fullNameEn: "   ",
    definitionMd: "\n",
    domain: ["  "],
  });
  expect(completion.missing).toEqual(["expansion", "definition", "domain"]);
});
