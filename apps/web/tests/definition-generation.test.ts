import { expect, test, vi } from "vitest";
import { DEFINITION_GUIDELINES } from "../src/lib/ai/definition-guidelines.js";

vi.mock("../src/lib/ai/config.js", () => ({
  loadAiConfig: async () => ({ enabled: true }),
  runtimeAiConfig: () => ({}),
}));
const completeAi = vi.fn();
vi.mock("../src/lib/ai/provider.js", () => ({ completeAi: (...args: unknown[]) => completeAi(...args) }));
const { generateOneLineDefinition } = await import("../src/lib/ai/definition-review.js");

const candidate = {
  id: "example", slug: "make-to-order", name: "주문 생산", nameEn: "MTO", nameKo: "주문 생산",
  fullNameEn: "Make to Order", fullNameKo: null,
  bodyMd: "주문 들어오면 만든다. 재고 부담을 줄인다.", revision: 1,
};

test("짧은 본문에도 정의 작성 기준과 원본 맥락을 AI에 전달한다", async () => {
  completeAi.mockResolvedValueOnce("고객 주문이 확정된 뒤 제품 생산을 시작하는 생산 방식이다.");
  expect(await generateOneLineDefinition(candidate)).toBe("고객 주문이 확정된 뒤 제품 생산을 시작하는 생산 방식이다.");
  const messages = completeAi.mock.lastCall![1];
  expect(messages[0].content).toContain(DEFINITION_GUIDELINES);
  expect(messages[1].content).toContain(candidate.bodyMd);
});

test("근거가 부족하면 본문 복사로 대체하지 않고 정의 생성을 중단한다", async () => {
  completeAi.mockResolvedValueOnce("__INSUFFICIENT__");
  await expect(generateOneLineDefinition({ ...candidate, bodyMd: "다음 회의에서 확인 필요" })).rejects.toThrow("INSUFFICIENT_BODY");
});
