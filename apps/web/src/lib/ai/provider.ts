import "server-only";

import { isIP } from "node:net";
import { lookup } from "node:dns/promises";
import type { StoredAiHeader } from "./config";
import type { AiProvider } from "./config-values";

export interface AiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface AiRuntimeConfig {
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  customHeaders: StoredAiHeader[];
}

export interface AiModelOption {
  id: string;
  label: string;
}

export class AiProviderError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

async function responseError(response: Response, action: string): Promise<AiProviderError> {
  let detail = "";
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (!declaredLength || declaredLength <= 64_000) {
    const raw = await response.text().catch(() => "");
    if (raw.length <= 64_000) {
      try {
        const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
        if (typeof parsed.error?.message === "string") {
          detail = parsed.error.message.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
        }
      } catch {
        // HTML·plain text 오류는 관리자 화면에 그대로 노출하지 않는다.
      }
    }
  }
  const summary = `AI 서버가 ${action}을 처리하지 못했습니다 (${response.status}).`;
  return new AiProviderError(detail ? `${summary} ${detail}` : summary, response.status);
}

function unsafeAddress(address: string): boolean {
  const normalized = address.toLowerCase();
  return normalized === "0.0.0.0" || normalized === "::"
    || normalized.startsWith("169.254.") || normalized.startsWith("fe80:")
    || normalized === "100.100.100.200";
}

export async function assertSafeAiEndpoint(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AiProviderError("API 주소는 http 또는 https만 사용할 수 있습니다.");
  const hostname = url.hostname.toLowerCase();
  if (new Set(["metadata.google.internal", "metadata.google", "instance-data.ec2.internal"]).has(hostname)) {
    throw new AiProviderError("클라우드 메타데이터 주소에는 연결할 수 없습니다.");
  }
  try {
    const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
    if (addresses.some((entry) => unsafeAddress(entry.address))) {
      throw new AiProviderError("링크 로컬 또는 메타데이터 주소에는 연결할 수 없습니다.");
    }
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError("API 서버 주소를 확인할 수 없습니다.");
  }
  return url;
}

function requestHeaders(config: AiRuntimeConfig): Headers {
  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  if (config.provider === "gemini" && config.apiKey) headers.set("x-goog-api-key", config.apiKey);
  if (config.provider === "openai_compatible" && config.apiKey) headers.set("authorization", `Bearer ${config.apiKey}`);
  for (const header of config.customHeaders) headers.set(header.name, header.value);
  return headers;
}

function endpoint(config: AiRuntimeConfig): string {
  if (config.provider === "gemini") {
    return `${config.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(config.model)}:generateContent`;
  }
  const base = config.baseUrl.replace(/\/+$/, "");
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

function modelsEndpoint(config: AiRuntimeConfig): string {
  const base = config.baseUrl.replace(/\/+$/, "");
  if (config.provider === "gemini") return `${base}/models?pageSize=1000`;
  const root = base.endsWith("/chat/completions") ? base.slice(0, -"/chat/completions".length) : base;
  return `${root}/models`;
}

export interface AiCompletionOptions {
  jsonOutput?: boolean;
  thinkingLevel?: "minimal" | "low";
}

function body(config: AiRuntimeConfig, messages: AiMessage[], maxTokens: number, options: AiCompletionOptions): unknown {
  if (config.provider === "gemini") {
    const system = messages.filter((message) => message.role === "system").map((message) => message.content).join("\n\n");
    return {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents: messages.filter((message) => message.role !== "system").map((message) => ({
        role: message.role === "assistant" ? "model" : "user",
        parts: [{ text: message.content }],
      })),
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: maxTokens,
        ...(options.jsonOutput ? { responseMimeType: "application/json" } : {}),
        ...(options.thinkingLevel && /^gemini-3(?:\.|-|$)/i.test(config.model)
          ? { thinkingConfig: { thinkingLevel: options.thinkingLevel } }
          : {}),
      },
    };
  }
  return { model: config.model, messages, temperature: 0.2, max_tokens: maxTokens, stream: false };
}

function readText(config: AiRuntimeConfig, value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  if (config.provider === "gemini") {
    const candidates = (value as { candidates?: Array<{ content?: { parts?: Array<{ text?: unknown; thought?: unknown }> } }> }).candidates;
    // Gemini thinking 모델은 사용자에게 보여 줄 답과 별개로 thought=true인 text part를
    // 반환할 수 있다. 둘을 이어 붙이면 구조화 JSON 앞에 사고 과정이 붙어 파싱이 깨진다.
    const text = candidates?.[0]?.content?.parts
      ?.filter((part) => part.thought !== true)
      .map((part) => typeof part.text === "string" ? part.text : "")
      .join("")
      .trim();
    return text || null;
  }
  const content = (value as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

function waitBeforeRetry(response?: Response): Promise<void> {
  const retryAfter = Number(response?.headers.get("retry-after") || 0);
  const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1_000, 2_000) : 400;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export async function completeAi(
  config: AiRuntimeConfig,
  messages: AiMessage[],
  maxTokens = 800,
  options: AiCompletionOptions = {},
): Promise<string> {
  const target = endpoint(config);
  await assertSafeAiEndpoint(target);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(target, {
        method: "POST",
        headers: requestHeaders(config),
        body: JSON.stringify(body(config, messages, maxTokens, options)),
        signal: AbortSignal.timeout(45_000),
        redirect: "error",
      });
    } catch (error) {
      if (error instanceof AiProviderError) throw error;
      if (attempt === 0) {
        await waitBeforeRetry();
        continue;
      }
      throw new AiProviderError("AI 서버에 연결하지 못했습니다.");
    }
    if (!response.ok) {
      if (attempt === 0 && new Set([500, 502, 503, 504]).has(response.status)) {
        await response.body?.cancel().catch(() => undefined);
        await waitBeforeRetry(response);
        continue;
      }
      throw await responseError(response, "생성 요청");
    }
    const parsed = await response.json().catch(() => null);
    const text = readText(config, parsed);
    if (!text) throw new AiProviderError("AI 서버가 텍스트 응답을 반환하지 않았습니다.");
    return text;
  }
  throw new AiProviderError("AI 서버에 연결하지 못했습니다.");
}

/** 공급자가 현재 자격 증명에 허용한 모델을 조회한다. */
export async function listAiModels(config: AiRuntimeConfig): Promise<AiModelOption[]> {
  const target = modelsEndpoint(config);
  await assertSafeAiEndpoint(target);
  let response: Response;
  try {
    response = await fetch(target, {
      method: "GET",
      headers: requestHeaders(config),
      signal: AbortSignal.timeout(30_000),
      redirect: "error",
    });
  } catch (error) {
    if (error instanceof AiProviderError) throw error;
    throw new AiProviderError("모델 목록을 불러오기 위해 AI 서버에 연결하지 못했습니다.");
  }
  if (!response.ok) throw await responseError(response, "모델 목록 요청");
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > 2_000_000) throw new AiProviderError("AI 서버의 모델 목록 응답이 너무 큽니다.");
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new AiProviderError("AI 서버의 모델 목록 응답이 너무 큽니다.");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AiProviderError("AI 서버가 올바른 모델 목록을 반환하지 않았습니다.");
  }

  const geminiRows = (parsed as { models?: unknown })?.models;
  const openAiRows = (parsed as { data?: unknown })?.data;
  const models: AiModelOption[] = config.provider === "gemini"
    ? (Array.isArray(geminiRows) ? geminiRows as Array<{ name?: unknown; displayName?: unknown; supportedGenerationMethods?: unknown }> : [])
      .filter((item) => Array.isArray(item.supportedGenerationMethods) && item.supportedGenerationMethods.includes("generateContent"))
      .flatMap((item) => {
        if (typeof item.name !== "string") return [];
        const id = item.name.replace(/^models\//, "");
        if (!id || id.length > 200) return [];
        const label = typeof item.displayName === "string" && item.displayName.trim()
          ? item.displayName.trim().slice(0, 128)
          : id;
        return [{ id, label }];
      })
    : (Array.isArray(openAiRows) ? openAiRows as Array<{ id?: unknown }> : [])
      .flatMap((item) => typeof item.id === "string" && item.id.trim() && item.id.trim().length <= 200
        ? [{ id: item.id.trim(), label: item.id.trim() }]
        : []);

  const unique = new Map(models.map((item) => [item.id, item]));
  return [...unique.values()].sort((a, b) => a.label.localeCompare(b.label, "en")).slice(0, 1_000);
}
