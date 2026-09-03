import { expect, test } from "vitest";
import { buildTermPayload, parseSurfaceBatch, type TermFormState } from "../src/lib/terms/form-payload.js";
import { interpretResponse } from "../src/lib/terms/form-response.js";

// R116: term-form.tsx는 Client Component라 jsdom 없는 이 저장소에서는 렌더
// 테스트를 할 수 없다(R97). 화면이 실제로 쓰는 순수 함수(buildTermPayload,
// interpretResponse)를 직접 두들겨서 커버한다.

const BASE_FORM: TermFormState = {
  termType: "concept",
  qualityProfile: "auto",
  nameEn: "Auto Exposure",
  nameKo: "",
  fullNameEn: "",
  fullNameKo: "",
  domain: "",
  category: "",
  topic: "",
  ownerId: "",
  status: "active",
  definitionMd: "",
  bodyMd: "",
  surfaces: [],
};

test("추가 표기 일괄 입력은 쉼표·줄바꿈으로 나누고 빈 값과 중복을 제거한다", () => {
  expect(parseSurfaceBatch(" T/O, TO\nT/O,\n 티오 ")).toEqual(["T/O", "TO", "티오"]);
});

// --- buildTermPayload ---------------------------------------------------

test("빈 문자열 필드는 undefined로 변환된다", () => {
  const payload = buildTermPayload(BASE_FORM);
  expect(payload.nameKo).toBeUndefined();
  expect(payload.fullNameEn).toBeUndefined();
  expect(payload.fullNameKo).toBeUndefined();
  expect(payload.definitionMd).toBeUndefined();
  expect(payload.bodyMd).toBeUndefined();
});

test("공백만 있는 필드도 undefined로 변환된다(trim 후 빈 문자열)", () => {
  const payload = buildTermPayload({ ...BASE_FORM, nameKo: "   ", bodyMd: "\t\n " });
  expect(payload.nameKo).toBeUndefined();
  expect(payload.bodyMd).toBeUndefined();
});

test("값이 있는 필드는 trim되어 그대로 전달된다", () => {
  const payload = buildTermPayload({ ...BASE_FORM, nameEn: "  Auto Exposure  ", bodyMd: "  본문  " });
  expect(payload.nameEn).toBe("Auto Exposure");
  expect(payload.bodyMd).toBe("본문");
});

test("domain은 쉼표로 나뉘고 trim되며 빈 조각은 버려진다", () => {
  const payload = buildTermPayload({ ...BASE_FORM, domain: " imaging, , camera ,  " });
  expect(payload.domain).toEqual(["imaging", "camera"]);
});

test("domain이 빈 문자열이면 빈 배열이 된다(undefined가 아님)", () => {
  const payload = buildTermPayload(BASE_FORM);
  expect(payload.domain).toEqual([]);
});

test("업무 분류·주제와 담당자는 빈 값을 null로, 선택한 값은 그대로 보낸다", () => {
  expect(buildTermPayload(BASE_FORM)).toMatchObject({ category: [], topic: null, ownerId: null });
  expect(buildTermPayload({ ...BASE_FORM, category: "design", topic: "  노출 제어  ", ownerId: "11111111-1111-1111-1111-111111111111" }))
    .toMatchObject({ category: ["design"], topic: "노출 제어", ownerId: "11111111-1111-1111-1111-111111111111" });
});

test("도메인과 업무 분류를 여러 개 선택하면 배열 순서를 유지해 보낸다", () => {
  const payload = buildTermPayload({ ...BASE_FORM, domain: "ISP, Sensor", category: "design, process" });
  expect(payload.domain).toEqual(["ISP", "Sensor"]);
  expect(payload.category).toEqual(["design", "process"]);
});

test("공백뿐인 surface는 제거되고, 남은 surface의 text는 trim된다", () => {
  const payload = buildTermPayload({
    ...BASE_FORM,
    surfaces: [
      { text: "  AE  ", lang: "en", kind: "abbreviation" },
      { text: "   ", lang: "en", kind: "alias" },
      { text: "", lang: "en", kind: "alias" },
    ],
  });
  expect(payload.surfaces).toEqual([{ text: "AE", lang: "en", kind: "abbreviation" }]);
});

test("surface 언어는 사용자가 보낸 값 대신 표기 문자열로 다시 판정한다", () => {
  const payload = buildTermPayload({
    ...BASE_FORM,
    surfaces: [
      { text: "T/O", lang: "ko", kind: "abbreviation" },
      { text: "티오", lang: "en", kind: "alias" },
      { text: "123", lang: "en", kind: "alias" },
    ],
  });
  expect(payload.surfaces.map(({ text, lang }) => ({ text, lang }))).toEqual([
    { text: "T/O", lang: "en" },
    { text: "티오", lang: "ko" },
    { text: "123", lang: "neutral" },
  ]);
});

test("expectedRevision을 넘기지 않으면 페이로드에 키 자체가 없다 (R109)", () => {
  const payload = buildTermPayload(BASE_FORM);
  expect("expectedRevision" in payload).toBe(false);
});

test("expectedRevision을 넘기면 페이로드에 그대로 실린다 (R109)", () => {
  const payload = buildTermPayload(BASE_FORM, 3);
  expect("expectedRevision" in payload).toBe(true);
  expect(payload.expectedRevision).toBe(3);
});

test("expectedRevision이 0이어도 키가 포함된다 (falsy 값 누락 방지)", () => {
  const payload = buildTermPayload(BASE_FORM, 0);
  expect("expectedRevision" in payload).toBe(true);
  expect(payload.expectedRevision).toBe(0);
});

test("termType/status는 변환 없이 그대로 전달된다(pass-through)", () => {
  const payload = buildTermPayload({ ...BASE_FORM, termType: "concept", status: "active" });
  expect(payload.termType).toBe("concept");
  expect(payload.status).toBe("active");
});

// --- interpretResponse ---------------------------------------------------

test("성공 + 경고 없음 → success, warnings는 빈 배열", () => {
  const outcome = interpretResponse(201, true, { term: { slug: "auto-exposure" }, surfaces: [], warnings: [] });
  expect(outcome).toEqual({ kind: "success", term: { slug: "auto-exposure" }, surfaces: [], warnings: [] });
});

test("성공 + 경고 있음 → success, warnings가 그대로 보존된다 (R108)", () => {
  const warnings = [{ surfaceText: "AE", conflictingSlug: "another-term" }];
  const outcome = interpretResponse(200, true, { term: { slug: "auto-exposure" }, surfaces: [], warnings });
  expect(outcome.kind).toBe("success");
  if (outcome.kind === "success") {
    expect(outcome.warnings).toEqual(warnings);
  }
});

test("성공인데 바디에 term.slug가 없으면 error로 안전하게 fallback한다", () => {
  const outcome = interpretResponse(200, true, { term: {} });
  expect(outcome.kind).toBe("error");
});

test("성공인데 바디가 null이면 error로 fallback한다(예외를 던지지 않는다)", () => {
  const outcome = interpretResponse(200, true, null);
  expect(outcome.kind).toBe("error");
});

test("409 + currentRevision 숫자 있음 → conflict (R109)", () => {
  const outcome = interpretResponse(409, false, { error: { code: "conflict", message: "x", details: { currentRevision: 5 } } });
  expect(outcome).toEqual({
    kind: "conflict",
    message: "다른 사람이 먼저 수정했습니다. 새로고침 후 다시 시도하세요.",
    currentRevision: 5,
  });
});

test("409인데 currentRevision이 없으면 conflict.currentRevision은 null이다", () => {
  const outcome = interpretResponse(409, false, { error: { code: "conflict", message: "x" } });
  expect(outcome.kind).toBe("conflict");
  if (outcome.kind === "conflict") {
    expect(outcome.currentRevision).toBeNull();
  }
});

test("400 + details.issues 배열 → issues (updateTerm의 표기 모순, R52/R113)", () => {
  const outcome = interpretResponse(400, false, {
    error: { code: "invalid", message: "표기 충돌", details: { issues: ["a", "b"] } },
  });
  expect(outcome).toEqual({ kind: "issues", message: "표기 충돌", issues: ["a", "b"] });
});

test("400 + details.fieldErrors → fieldErrors (zod flatten, R113)", () => {
  const outcome = interpretResponse(400, false, {
    error: { code: "invalid", message: "검증 실패", details: { fieldErrors: { nameEn: ["필수입니다"] }, formErrors: [] } },
  });
  expect(outcome).toEqual({
    kind: "fieldErrors",
    message: "검증 실패",
    fieldErrors: { nameEn: ["필수입니다"] },
    formErrors: [],
  });
});

test("400인데 issues도 fieldErrors도 없으면 일반 error로 fallback한다", () => {
  const outcome = interpretResponse(400, false, { error: { code: "invalid", message: "알 수 없는 오류" } });
  expect(outcome).toEqual({ kind: "error", message: "알 수 없는 오류" });
});

test("issues와 fieldErrors가 둘 다 있으면 issues가 우선한다(interpretResponse:64 순서)", () => {
  const outcome = interpretResponse(400, false, {
    error: { code: "invalid", message: "x", details: { issues: ["a"], fieldErrors: { nameEn: ["필수"] } } },
  });
  expect(outcome.kind).toBe("issues");
});

test("바디가 null인 오류 응답도 예외 없이 기본 메시지로 처리된다", () => {
  const outcome = interpretResponse(500, false, null);
  expect(outcome).toEqual({ kind: "error", message: "저장에 실패했습니다." });
});

test("알 수 없는 상태 코드(예: 500)는 message만 있는 일반 error가 된다", () => {
  const outcome = interpretResponse(500, false, { error: { code: "internal", message: "서버 오류" } });
  expect(outcome).toEqual({ kind: "error", message: "서버 오류" });
});
