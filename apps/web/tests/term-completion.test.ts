import { expect, test } from "vitest";
import { termCompletion } from "../src/lib/terms/completion.js";

test("일반 용어의 자동 기준은 정의와 도메인 또는 업무 분류를 요구한다", () => {
  expect(termCompletion({ domain: [] })).toEqual({
    complete: false,
    completed: 0,
    total: 2,
    percent: 0,
    missing: ["definition", "context"],
    configuredProfile: "auto",
    resolvedProfile: "context",
    minimums: { definitionMinChars: 1, bodyMinChars: 0 },
  });
});

test("IT처럼 Full name이 있는 영문 약어는 정의 없이 표기 매핑만으로 충분하다", () => {
  const completion = termCompletion({
    nameEn: "IT",
    fullNameEn: "Information Technology",
    domain: [],
  });
  expect(completion).toMatchObject({
    complete: true,
    completed: 1,
    total: 1,
    missing: [],
    configuredProfile: "auto",
    resolvedProfile: "mapping",
  });
});

test("업무 분류도 일반 용어의 맥락으로 인정한다", () => {
  const completion = termCompletion({ definitionMd: "조직 내부에서 사용하는 뜻", domain: [], categories: ["software"] });
  expect(completion).toMatchObject({ complete: true, completed: 2, total: 2, missing: [] });
});

test("공백뿐인 값은 채워진 정보로 세지 않는다", () => {
  const completion = termCompletion({
    fullNameEn: "   ",
    definitionMd: "\n",
    domain: ["  "],
  });
  expect(completion.missing).toEqual(["definition", "context"]);
});

test("이전 상태값은 더 이상 정리 기준을 바꾸지 않는다", () => {
  const settings = { definitionMinChars: 5, bodyMinChars: 10 };
  const short = termCompletion({
    status: "draft",
    definitionMd: "1234",
    bodyMd: "123456789",
    domain: ["IT"],
  }, settings);
  expect(short).toMatchObject({ complete: false, completed: 1, total: 2, missing: ["definition"] });

  const complete = termCompletion({
    status: "active",
    definitionMd: "12345",
    bodyMd: "1234567890",
    domain: ["IT"],
  }, settings);
  expect(complete).toMatchObject({ complete: true, completed: 2, total: 2, missing: [] });
});

test("글자 수 0도 구조적 항목을 없애지 않고 내용 존재 여부를 검사한다", () => {
  const completion = termCompletion({
    status: "draft",
    definitionMd: "",
    bodyMd: "",
    domain: ["IT"],
  }, { definitionMinChars: 0, bodyMinChars: 0 });
  expect(completion.missing).toEqual(["definition"]);
});

test("기존 명시 기준보다 플랫폼 자동 판단을 우선한다", () => {
  const completion = termCompletion({
    qualityProfile: "context",
    nameEn: "SW",
    fullNameEn: "Software",
    domain: [],
  });
  expect(completion).toMatchObject({ resolvedProfile: "mapping", complete: true, missing: [] });
});
