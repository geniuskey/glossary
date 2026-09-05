import { afterEach, expect, test, vi } from "vitest";
import { completeAi, listAiModels } from "../src/lib/ai/provider.js";

afterEach(() => vi.unstubAllGlobals());

test("OpenAI-compatible API는 chat/completions와 custom header를 사용한다", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ choices: [{ message: { content: "용어집 답변" } }] }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(completeAi({
    provider: "openai_compatible",
    baseUrl: "http://127.0.0.1:11434/v1",
    model: "local-model",
    apiKey: "key-value",
    customHeaders: [{ name: "X-Organization", value: "glossary" }],
  }, [{ role: "user", content: "IT란?" }])).resolves.toBe("용어집 답변");

  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("http://127.0.0.1:11434/v1/chat/completions");
  const headers = new Headers(init?.headers);
  expect(headers.get("authorization")).toBe("Bearer key-value");
  expect(headers.get("x-organization")).toBe("glossary");
  expect(JSON.parse(String(init?.body))).toMatchObject({ model: "local-model", stream: false });
});

test("Gemini native API는 generateContent 형식과 x-goog-api-key를 사용한다", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({ candidates: [{ content: { parts: [{ text: "Gemini 답변" }] } }] }));
  vi.stubGlobal("fetch", fetchMock);

  const answer = await completeAi({
    provider: "gemini",
    baseUrl: "http://127.0.0.1:9999/v1beta",
    model: "gemini-test",
    apiKey: "gemini-key",
    customHeaders: [],
  }, [
    { role: "system", content: "용어집만 사용" },
    { role: "user", content: "SW란?" },
  ]);
  expect(answer).toBe("Gemini 답변");
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("http://127.0.0.1:9999/v1beta/models/gemini-test:generateContent");
  expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("gemini-key");
  expect(JSON.parse(String(init?.body))).toMatchObject({
    systemInstruction: { parts: [{ text: "용어집만 사용" }] },
    contents: [{ role: "user", parts: [{ text: "SW란?" }] }],
  });
});

test("AI 연결은 메타데이터 주소와 redirect를 차단한다", async () => {
  await expect(completeAi({
    provider: "openai_compatible",
    baseUrl: "http://metadata.google.internal/v1",
    model: "x",
    apiKey: "",
    customHeaders: [],
  }, [{ role: "user", content: "질문" }])).rejects.toThrow(/메타데이터/);

  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })));
  await expect(completeAi({
    provider: "openai_compatible",
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "x",
    apiKey: "",
    customHeaders: [],
  }, [{ role: "user", content: "질문" }])).rejects.toThrow(/302/);
});

test("AI 생성 실패 시 공급자의 JSON 오류 원인을 관리자 진단에 남긴다", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({
    error: { message: "This model is no longer available. Choose a newer model." },
  }, { status: 404 })));

  await expect(completeAi({
    provider: "gemini",
    baseUrl: "http://127.0.0.1:9999/v1beta",
    model: "retired-model",
    apiKey: "gemini-key",
    customHeaders: [],
  }, [{ role: "user", content: "질문" }])).rejects.toThrow(/no longer available/);
});

test("AI 공급자의 일시적인 503은 한 번 재시도한다", async () => {
  const fetchMock = vi.fn()
    .mockResolvedValueOnce(Response.json({ error: { message: "temporary" } }, { status: 503 }))
    .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: "재시도 성공" } }] }));
  vi.stubGlobal("fetch", fetchMock);

  await expect(completeAi({
    provider: "openai_compatible",
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "local-model",
    apiKey: "key",
    customHeaders: [],
  }, [{ role: "user", content: "질문" }])).resolves.toBe("재시도 성공");
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

test("Gemini 모델 목록은 generateContent 지원 모델만 선택지로 만든다", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
    models: [
      { name: "models/gemini-flash", displayName: "Gemini Flash", supportedGenerationMethods: ["generateContent", "countTokens"] },
      { name: "models/text-embedding", displayName: "Embedding", supportedGenerationMethods: ["embedContent"] },
    ],
  }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(listAiModels({
    provider: "gemini",
    baseUrl: "http://127.0.0.1:9999/v1beta",
    model: "",
    apiKey: "gemini-key",
    customHeaders: [],
  })).resolves.toEqual([{ id: "gemini-flash", label: "Gemini Flash" }]);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("http://127.0.0.1:9999/v1beta/models?pageSize=1000");
  expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("gemini-key");
});

test("OpenAI-compatible 모델 목록은 /models와 기존 인증 header를 사용한다", async () => {
  const fetchMock = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => Response.json({
    data: [{ id: "model-b" }, { id: "model-a" }, { id: "model-a" }],
  }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(listAiModels({
    provider: "openai_compatible",
    baseUrl: "http://127.0.0.1:9999/v1/chat/completions",
    model: "",
    apiKey: "openai-key",
    customHeaders: [{ name: "X-Tenant", value: "team-a" }],
  })).resolves.toEqual([
    { id: "model-a", label: "model-a" },
    { id: "model-b", label: "model-b" },
  ]);
  const [url, init] = fetchMock.mock.calls[0]!;
  expect(url).toBe("http://127.0.0.1:9999/v1/models");
  const headers = new Headers(init?.headers);
  expect(headers.get("authorization")).toBe("Bearer openai-key");
  expect(headers.get("x-tenant")).toBe("team-a");
});
