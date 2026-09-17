import { randomUUID } from "node:crypto";
import { desc, eq } from "drizzle-orm";
import { afterEach, expect, test, vi } from "vitest";
import { aiRuns } from "@glossary/db";
import { getDb } from "../src/lib/db.js";
import { completeAi } from "../src/lib/ai/provider.js";
import { providerErrorCode, reconcileStaleAiRuns } from "../src/lib/ai/telemetry.js";

afterEach(() => vi.unstubAllGlobals());

test("provider 실패를 운영 대시보드용 안정적인 코드로 분류한다", () => {
  expect(providerErrorCode({ status: 401 })).toBe("authentication");
  expect(providerErrorCode({ status: 404 })).toBe("model_not_found");
  expect(providerErrorCode({ status: 429 })).toBe("rate_limited");
  expect(providerErrorCode(new Error("The operation timed out"))).toBe("timeout");
});

test("LLM 호출은 원문 없이 trace·시도·토큰·지연 메타데이터를 남긴다", async () => {
  const traceId = "00000000-0000-4000-8000-000000000099";
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    choices: [{ message: { content: "안전한 답변" } }],
    usage: { prompt_tokens: 17, completion_tokens: 5, total_tokens: 22 },
  })));

  await expect(completeAi({
    provider: "openai_compatible",
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "telemetry-test",
    apiKey: "",
    customHeaders: [],
  }, [{ role: "user", content: "원문은 저장하지 않아야 하는 질문" }], 128, {
    context: { operation: "test.observability", traceId },
  })).resolves.toBe("안전한 답변");

  const [row] = await getDb().select().from(aiRuns).where(eq(aiRuns.traceId, traceId)).orderBy(desc(aiRuns.startedAt)).limit(1);
  expect(row).toMatchObject({
    operation: "test.observability",
    provider: "openai_compatible",
    model: "telemetry-test",
    status: "succeeded",
    attempts: 1,
    inputTokens: 17,
    outputTokens: 5,
    totalTokens: 22,
  });
  expect(row?.metadata).toEqual({});
});

test("프로세스 중단으로 남은 running 실행은 모니터링 집계에서 실패로 정리한다", async () => {
  const traceId = randomUUID();
  const startedAt = new Date(Date.now() - 20 * 60 * 1_000);
  await getDb().insert(aiRuns).values({
    traceId,
    operation: "test.stale",
    provider: "test",
    model: "test",
    status: "running",
    startedAt,
  });

  expect(await reconcileStaleAiRuns()).toBeGreaterThanOrEqual(1);
  const [row] = await getDb().select().from(aiRuns).where(eq(aiRuns.traceId, traceId)).limit(1);
  expect(row).toMatchObject({ status: "failed", errorCode: "stale_run" });
});
