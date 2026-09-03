import { expect, test } from "vitest";
import { termCompletion } from "../src/lib/terms/completion.js";

test("일반 용어의 자동 기준은 정의와 도메인 또는 업무 분류를 요구한다", () => {
  expect(termCompletion({ termType: "concept", domain: [] })).toEqual({
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
    termType: "concept",
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
  const completion = termCompletion({ termType: "concept", definitionMd: "조직 내부에서 사용하는 뜻", domain: [], categories: ["software"] });
  expect(completion).toMatchObject({ complete: true, completed: 2, total: 2, missing: [] });
});

test("공백뿐인 값은 채워진 정보로 세지 않는다", () => {
  const completion = termCompletion({
    termType: "concept",
    fullNameEn: "   ",
    definitionMd: "\n",
    domain: ["  "],
  });
  expect(completion.missing).toEqual(["definition", "context"]);
});

test("사용 지침 프로필은 정의·맥락·본문에 관리자 최소 길이를 적용한다", () => {
  const settings = { definitionMinChars: 5, bodyMinChars: 10 };
  const short = termCompletion({
    termType: "concept",
    qualityProfile: "guidance",
    definitionMd: "1234",
    bodyMd: "123456789",
    domain: ["IT"],
  }, settings);
  expect(short).toMatchObject({ complete: false, completed: 1, total: 3, missing: ["definition", "body"] });

  const complete = termCompletion({
    termType: "concept",
    qualityProfile: "guidance",
    definitionMd: "12345",
    bodyMd: "1234567890",
    domain: ["IT"],
  }, settings);
  expect(complete).toMatchObject({ complete: true, completed: 3, total: 3, missing: [] });
});

test("글자 수 0도 구조적 항목을 없애지 않고 내용 존재 여부를 검사한다", () => {
  const completion = termCompletion({
    termType: "concept",
    qualityProfile: "guidance",
    definitionMd: "",
    bodyMd: "",
    domain: ["IT"],
  }, { definitionMinChars: 0, bodyMinChars: 0 });
  expect(completion.missing).toEqual(["definition", "body"]);
});

test("용어별 명시 기준은 자동 판단보다 우선한다", () => {
  const completion = termCompletion({
    termType: "concept",
    qualityProfile: "context",
    nameEn: "SW",
    fullNameEn: "Software",
    domain: [],
  });
  expect(completion).toMatchObject({ resolvedProfile: "context", complete: false, missing: ["definition", "context"] });
});
