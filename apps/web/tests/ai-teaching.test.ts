import { afterEach, expect, test, vi } from "vitest";
import { collectTermTeaching, extractPastedGlossary, looksLikeGlossaryPaste } from "../src/lib/ai/teaching.js";
import { missingTeachingFields, type TermTeachingDraft } from "../src/lib/ai/teaching-values.js";

const config = {
  provider: "openai_compatible" as const,
  baseUrl: "http://127.0.0.1:9999/v1",
  model: "teaching-model",
  apiKey: "test-key",
  customHeaders: [],
};

afterEach(() => vi.unstubAllGlobals());

function aiJson(value: unknown) {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    choices: [{ message: { content: JSON.stringify(value) } }],
  })));
}

test("모르는 용어 질문에서는 표기만 수집하고 AI 지식으로 뜻을 채우지 않는다", async () => {
  aiJson({
    nameEn: "T/O",
    nameKo: null,
    fullNameEn: null,
    fullNameKo: null,
    definitionMd: null,
    bodyMd: null,
    skipped: { fullName: false, definition: false, body: false },
  });

  const result = await collectTermTeaching(config, "T/O가 뭐야?", [], null);
  expect(result.ready).toBe(false);
  expect(result.draft).toMatchObject({ nameEn: "T/O", definitionMd: null, bodyMd: null });
  expect(result.answer).toContain("Full name");
  expect(result.answer).toContain("한줄 정의");
  expect(result.answer).toContain("상세 설명");
});

test("사용자가 알려준 내용을 기존 초안에 누적하면 등록 준비 상태가 된다", async () => {
  const previous: TermTeachingDraft = {
    nameEn: "T/O",
    nameKo: null,
    fullNameEn: null,
    fullNameKo: null,
    definitionMd: null,
    bodyMd: null,
    skipped: { fullName: false, definition: false, body: false },
  };
  aiJson({
    nameEn: "T/O",
    nameKo: null,
    fullNameEn: "Turn Over",
    fullNameKo: null,
    definitionMd: "공정 단계가 전환되는 시점",
    bodyMd: "인수인계가 끝난 뒤 다음 담당자가 작업을 시작할 때 사용한다.",
    skipped: { fullName: false, definition: false, body: false },
  });

  const result = await collectTermTeaching(config, "T/O는 Turn Over이고 공정 단계가 전환되는 시점이야. 인수인계 후 다음 담당자가 시작할 때 써.", [], previous);
  expect(result.ready).toBe(true);
  expect(result.draft).toMatchObject({
    nameEn: "T/O",
    fullNameEn: "Turn Over",
    definitionMd: "공정 단계가 전환되는 시점",
  });
  expect(result.answer).toContain("용어로 추가");
});

test("생략 의사를 반영하되 의미 정보가 전혀 없는 용어는 준비 완료로 보지 않는다", () => {
  const empty: TermTeachingDraft = {
    nameEn: "XYZ",
    nameKo: null,
    fullNameEn: null,
    fullNameKo: null,
    definitionMd: null,
    bodyMd: null,
    skipped: { fullName: true, definition: true, body: true },
  };
  expect(missingTeachingFields(empty)).toEqual(["definition"]);
  expect(missingTeachingFields({ ...empty, fullNameEn: "Example Yield Zone" })).toEqual([]);
});

test("여러 줄 표·CSV는 용어집 붙여넣기로 감지하고 일반 질문은 감지하지 않는다", () => {
  expect(looksLikeGlossaryPaste("용어\tFull Name\t정의\nT/O\tTurn Over\t공정 전환\nSW\tSoftware\t소프트웨어")).toBe(true);
  expect(looksLikeGlossaryPaste('[{"term":"T/O","fullName":"Turn Over"},{"term":"SW","fullName":"Software"}]')).toBe(true);
  expect(looksLikeGlossaryPaste("IT와 SW는 무엇이 달라?")).toBe(false);
});

test("서로 다른 형식으로 붙여넣은 여러 용어를 등록 가능한 공통 초안으로 바꾼다", async () => {
  aiJson({
    terms: [
      {
        nameEn: "T/O", nameKo: null, fullNameEn: "Turn Over", fullNameKo: null,
        definitionMd: "공정 전환", bodyMd: null,
        skipped: { fullName: false, definition: false, body: false },
      },
      {
        nameEn: "SW", nameKo: "소프트웨어", fullNameEn: "Software", fullNameKo: null,
        definitionMd: "프로그램과 관련 데이터", bodyMd: "조직에서는 제품 소프트웨어를 가리킨다.",
        skipped: { fullName: false, definition: false, body: false },
      },
    ],
  });

  const result = await extractPastedGlossary(config, "용어\tFull Name\t정의\nT/O\tTurn Over\t공정 전환\nSW\tSoftware\t프로그램과 관련 데이터");
  expect(result.batch?.drafts).toHaveLength(2);
  expect(result.batch?.drafts[0]).toMatchObject({ nameEn: "T/O", fullNameEn: "Turn Over" });
  expect(result.answer).toContain("2개 용어");
});
