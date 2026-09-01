import { expect, test } from "vitest";
import { termCompletion } from "../src/lib/terms/completion.js";

test("Type과 무관하게 정의·분야를 정리 대상으로 본다", () => {
  expect(termCompletion({ termType: "concept", domain: [] })).toEqual({
    complete: false,
    completed: 0,
    total: 2,
    percent: 0,
    missing: ["definition", "domain"],
  });
});

test("풀네임은 완성도의 별도 필수값이 아니다", () => {
  const completion = termCompletion({
    termType: "concept",
    fullNameKo: "자동 노출",
    definitionMd: "센서 노출을 자동으로 조정하는 기능",
    domain: ["ISP"],
  });
  expect(completion).toMatchObject({ complete: true, completed: 2, total: 2, percent: 100, missing: [] });
});

test("일반 용어는 풀네임을 요구하지 않고 정의와 분야만 최소 기준으로 삼는다", () => {
  const completion = termCompletion({ termType: "concept", definitionMd: "설명", domain: [] });
  expect(completion).toMatchObject({ complete: false, completed: 1, total: 2, percent: 50 });
  expect(completion.missing).toEqual(["domain"]);
});

test("공백뿐인 값은 채워진 정보로 세지 않는다", () => {
  const completion = termCompletion({
    termType: "concept",
    fullNameEn: "   ",
    definitionMd: "\n",
    domain: ["  "],
  });
  expect(completion.missing).toEqual(["definition", "domain"]);
});
