import { isIP } from "node:net";
import { lookup as dnsLookup, type LookupAddress, type LookupOptions } from "node:dns";
import { lookup } from "node:dns/promises";
import { Agent } from "undici";
import type { StoredAiHeader } from "./config";
import type { AiProvider } from "./config-values";
import type { AiRunContext } from "./observability-values";
import { beginAiRun, finishAiRun, providerErrorCode } from "./telemetry";

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

/** Reads a bounded provider response so a malformed endpoint cannot exhaust memory. */
export async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (declaredLength > maxBytes) {
    await response.body?.cancel().catch(() => undefined);
    throw new AiProviderError("AI 서버 응답이 허용된 크기보다 큽니다.");
  }
  if (!response.body) {
    const text = await response.text();
    if (new TextEncoder().encode(text).byteLength > maxBytes) throw new AiProviderError("AI 서버 응답이 허용된 크기보다 큽니다.");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        throw new AiProviderError("AI 서버 응답이 허용된 크기보다 큽니다.");
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    return text + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function responseError(response: Response, action: string): Promise<AiProviderError> {
  let detail = "";
  const raw = await readResponseText(response, 64_000).catch(() => null);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as { error?: { message?: unknown } };
      if (typeof parsed.error?.message === "string") {
        detail = parsed.error.message.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 500);
      }
    } catch {
      // HTML·plain text 오류는 관리자 화면에 그대로 노출하지 않는다.
    }
  }
  const summary = `AI 서버가 ${action}을 처리하지 못했습니다 (${response.status}).`;
  return new AiProviderError(detail ? `${summary} ${detail}` : summary, response.status);
}

/**
 * 사내 AI 서버는 대부분 사설망(10/8, 172.16/12, 192.168/16)에 있다. SSRF 차단이
 * 이 대역까지 넓어지면서(2026-09-17) 기존 사내 연결이 전부 막혔다 — 운영자가
 * 호스트를 명시한 경우에만 사설 대역을 다시 연다. `*`는 전부 허용(폐쇄망 배포용).
 */
function allowedPrivateHosts(): Set<string> {
  return new Set((process.env.GLOSSARY_AI_ALLOWED_PRIVATE_HOSTS ?? "")
    .split(",")
    .map((value) => value.trim().toLowerCase().replace(/^\[|\]$/g, ""))
    .filter(Boolean));
}

function ipv6Hextets(address: string): number[] | null {
  const text = address.replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/, (_match, a: string, b: string, c: string, d: string) =>
    `${((Number(a) << 8) | Number(b)).toString(16)}:${((Number(c) << 8) | Number(d)).toString(16)}`);
  const parse = (part: string) => (part ? part.split(":").map((group) => Number.parseInt(group, 16)) : []);
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const left = parse(halves[0] ?? "");
  const right = halves.length === 2 ? parse(halves[1] ?? "") : [];
  const fill = halves.length === 2 ? 8 - left.length - right.length : 0;
  if (fill < 0) return null;
  const hextets = [...left, ...Array<number>(fill).fill(0), ...right];
  return hextets.length === 8 && hextets.every((value) => Number.isInteger(value) && value >= 0 && value <= 0xffff) ? hextets : null;
}

/**
 * WHATWG URL은 `[::ffff:169.254.169.254]`를 `[::ffff:a9fe:a9fe]`로 바꿔 놓는다. 점 표기
 * 접두사만 보면 이 16진 표기와 NAT64(64:ff9b::/96) 주소가 메타데이터·사설망 검사를 그대로
 * 통과했다 — 안에 담긴 IPv4를 꺼내 IPv4 규칙으로 다시 본다.
 */
function embeddedIpv4(hextets: number[]): string | null {
  const [h0, h1, h2, h3, h4, h5, h6, h7] = hextets as [number, number, number, number, number, number, number, number];
  const zeroPrefix = h0 === 0 && h1 === 0 && h2 === 0 && h3 === 0;
  const mapped = zeroPrefix && h4 === 0 && h5 === 0xffff;
  const translated = zeroPrefix && h4 === 0xffff && h5 === 0;
  // ::1(loopback)과 ::는 IPv4 호환 주소로 해석하지 않는다 — 0.0.0.1로 읽으면 로컬 모델 서버가 막힌다.
  const compatible = zeroPrefix && h4 === 0 && h5 === 0 && h6 !== 0;
  const nat64 = h0 === 0x64 && h1 === 0xff9b && h2 === 0 && h3 === 0 && h4 === 0 && h5 === 0;
  if (!mapped && !translated && !compatible && !nat64) return null;
  return [h6 >> 8, h6 & 0xff, h7 >> 8, h7 & 0xff].join(".");
}

type AddressClass = "always_unsafe" | "private" | "public";

function classifyIpv4(address: string): AddressClass {
  const [first = -1, second = -1] = address.split(".").map(Number);
  // 메타데이터·link-local은 allowlist로도 열지 않는다. 사내 호스트 이름 하나가 DNS
  // rebinding으로 169.254.169.254를 가리키면 클라우드 자격 증명이 그대로 새 나간다.
  if (first === 0 || (first === 169 && second === 254) || address === "100.100.100.200") return "always_unsafe";
  // Loopback은 로컬 모델 서버를 위해 의도적으로 허용한다.
  if (first === 10 || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168)) return "private";
  return "public";
}

function classifyAddress(address: string): AddressClass {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").replace(/%.*$/, "");
  const family = isIP(normalized);
  if (family === 4) return classifyIpv4(normalized);
  if (family !== 6) return "public";
  const hextets = ipv6Hextets(normalized);
  if (!hextets) return "always_unsafe";
  const ipv4 = embeddedIpv4(hextets);
  if (ipv4) return classifyIpv4(ipv4);
  const first = hextets[0]!;
  if (hextets.every((value) => value === 0) || (first & 0xffc0) === 0xfe80) return "always_unsafe";
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfec0) return "private";
  return "public";
}

function unsafeAddress(address: string, allowPrivate: boolean): boolean {
  const kind = classifyAddress(address);
  if (kind === "always_unsafe") return true;
  return kind === "private" && !allowPrivate;
}

const METADATA_HOSTS = new Set(["metadata.google.internal", "metadata.google", "instance-data.ec2.internal"]);

function blockedAddressMessage(hostname: string, addresses: readonly string[]): string | null {
  if (METADATA_HOSTS.has(hostname)) return "클라우드 메타데이터 주소에는 연결할 수 없습니다.";
  const allowed = allowedPrivateHosts();
  const allowPrivate = allowed.has("*") || allowed.has(hostname);
  if (!addresses.some((address) => unsafeAddress(address, allowPrivate))) return null;
  return allowPrivate
    ? "링크 로컬 또는 메타데이터 주소에는 연결할 수 없습니다."
    : "링크 로컬 또는 사설망 주소에는 연결할 수 없습니다. 사내 AI 서버라면 GLOSSARY_AI_ALLOWED_PRIVATE_HOSTS에 호스트를 추가하세요.";
}

export async function assertSafeAiEndpoint(raw: string): Promise<URL> {
  const url = new URL(raw);
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new AiProviderError("API 주소는 http 또는 https만 사용할 수 있습니다.");
  // URL.hostname은 IPv6 리터럴을 대괄호까지 담아 돌려준다. 벗기지 않으면 isIP가 0을
  // 내고 DNS lookup으로 내려가 http://[::1]/ 같은 주소가 조회 실패로 잘못 막힌다.
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (METADATA_HOSTS.has(hostname)) throw new AiProviderError("클라우드 메타데이터 주소에는 연결할 수 없습니다.");
  let addresses: string[];
  try {
    addresses = isIP(hostname) ? [hostname] : (await lookup(hostname, { all: true })).map((entry) => entry.address);
  } catch {
    throw new AiProviderError("API 서버 주소를 확인할 수 없습니다.");
  }
  const blocked = blockedAddressMessage(hostname, addresses);
  if (blocked) throw new AiProviderError(blocked);
  return url;
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
export type LookupAll = (
  hostname: string,
  options: LookupOptions & { all: true },
  callback: (error: NodeJS.ErrnoException | null, addresses: LookupAddress[]) => void,
) => void;

/**
 * assertSafeAiEndpoint만으로는 DNS rebinding을 막지 못한다 — 검사 때 공인 IP를 준 DNS가
 * fetch의 두 번째 조회에서 169.254.169.254를 주면 그대로 연결됐다. 소켓이 실제로 붙을
 * 주소를 같은 규칙으로 여기서 다시 거른다. IP 리터럴은 net이 lookup을 건너뛰지만, 바뀔
 * 수 없는 주소라 사전 검사로 충분하다.
 */
export function createGuardedLookup(resolve: LookupAll = dnsLookup as LookupAll) {
  return (hostname: string, options: LookupOptions, callback: LookupCallback): void => {
    resolve(hostname, { ...options, all: true }, (error, addresses) => {
      if (error) return callback(error, "");
      const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
      const blocked = blockedAddressMessage(host, addresses.map((entry) => entry.address));
      if (blocked) return callback(new AiProviderError(blocked), "");
      const first = addresses[0];
      if (!first) return callback(Object.assign(new Error("API 서버 주소를 확인할 수 없습니다."), { code: "ENOTFOUND" }), "");
      if (options.all) callback(null, addresses);
      else callback(null, first.address, first.family);
    });
  };
}

let guardedDispatcher: Agent | undefined;

/** 모든 AI·RAG 공급자 요청은 이 함수로 나가야 연결 시점 주소 검사를 받는다. */
export function providerFetch(target: string, init: RequestInit): Promise<Response> {
  guardedDispatcher ??= new Agent({ connect: { lookup: createGuardedLookup() } });
  // DOM lib의 RequestInit에는 dispatcher가 없다. Node 22 fetch는 undici 6 Agent를 그대로 받는다.
  return fetch(target, { ...init, dispatcher: guardedDispatcher } as RequestInit);
}

/** undici는 lookup 오류를 TypeError("fetch failed")의 cause로 감싼다 — 차단 사유가 재시도·일반 문구에 묻히지 않게 꺼낸다. */
export function blockedConnectionError(error: unknown): AiProviderError | null {
  if (error instanceof AiProviderError) return error;
  const cause = error instanceof Error ? error.cause : undefined;
  return cause instanceof AiProviderError ? cause : null;
}

function requestHeaders(config: AiRuntimeConfig): Headers {
  const headers = new Headers({ "content-type": "application/json", accept: "application/json" });
  if (config.provider === "gemini" && config.apiKey) headers.set("x-goog-api-key", config.apiKey);
  if (config.provider === "openai_compatible" && config.apiKey) headers.set("authorization", `Bearer ${config.apiKey}`);
  for (const header of config.customHeaders) headers.set(header.name, header.value);
  return headers;
}

function ollamaUsesOpenAiCompatibility(config: AiRuntimeConfig): boolean {
  if (config.provider !== "ollama") return false;
  try {
    return new URL(config.baseUrl).pathname.replace(/\/+$/, "").endsWith("/v1");
  } catch {
    return false;
  }
}

function endpoint(config: AiRuntimeConfig): string {
  if (config.provider === "gemini") {
    return `${config.baseUrl.replace(/\/+$/, "")}/models/${encodeURIComponent(config.model)}:generateContent`;
  }
  const base = config.baseUrl.replace(/\/+$/, "");
  if (config.provider === "ollama" && !ollamaUsesOpenAiCompatibility(config)) return `${base}/api/chat`;
  return base.endsWith("/chat/completions") ? base : `${base}/chat/completions`;
}

function modelsEndpoint(config: AiRuntimeConfig): string {
  const base = config.baseUrl.replace(/\/+$/, "");
  if (config.provider === "gemini") return `${base}/models?pageSize=1000`;
  if (config.provider === "ollama" && !ollamaUsesOpenAiCompatibility(config)) return `${base}/api/tags`;
  const root = base.endsWith("/chat/completions") ? base.slice(0, -"/chat/completions".length) : base;
  return `${root}/models`;
}

export interface AiCompletionOptions {
  jsonOutput?: boolean;
  thinkingLevel?: "minimal" | "low";
  context?: AiRunContext;
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
  if (config.provider === "ollama" && !ollamaUsesOpenAiCompatibility(config)) {
    return {
      model: config.model,
      messages,
      stream: false,
      options: { temperature: 0.2, num_predict: maxTokens },
      ...(options.jsonOutput ? { format: "json" } : {}),
    };
  }
  return {
    model: config.model,
    messages,
    temperature: 0.2,
    max_tokens: maxTokens,
    stream: false,
    ...(options.jsonOutput ? { response_format: { type: "json_object" } } : {}),
  };
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
  if (config.provider === "ollama" && !ollamaUsesOpenAiCompatibility(config)) {
    const content = (value as { message?: { content?: unknown } }).message?.content;
    return typeof content === "string" && content.trim() ? content.trim() : null;
  }
  const content = (value as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content;
  return typeof content === "string" && content.trim() ? content.trim() : null;
}

function waitBeforeRetry(response?: Response): Promise<void> {
  const retryAfter = Number(response?.headers.get("retry-after") || 0);
  const delay = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter * 1_000, 2_000) : 400;
  return new Promise((resolve) => setTimeout(resolve, delay));
}

interface ProviderUsage {
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
}

function providerUsage(config: AiRuntimeConfig, value: unknown): ProviderUsage {
  if (!value || typeof value !== "object") return { inputTokens: null, outputTokens: null, totalTokens: null };
  if (config.provider === "gemini") {
    const usage = (value as { usageMetadata?: { promptTokenCount?: unknown; candidatesTokenCount?: unknown; totalTokenCount?: unknown } }).usageMetadata;
    return {
      inputTokens: typeof usage?.promptTokenCount === "number" ? usage.promptTokenCount : null,
      outputTokens: typeof usage?.candidatesTokenCount === "number" ? usage.candidatesTokenCount : null,
      totalTokens: typeof usage?.totalTokenCount === "number" ? usage.totalTokenCount : null,
    };
  }
  if (config.provider === "ollama" && !ollamaUsesOpenAiCompatibility(config)) {
    const usage = value as { prompt_eval_count?: unknown; eval_count?: unknown };
    const inputTokens = typeof usage.prompt_eval_count === "number" ? usage.prompt_eval_count : null;
    const outputTokens = typeof usage.eval_count === "number" ? usage.eval_count : null;
    return {
      inputTokens,
      outputTokens,
      totalTokens: inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null,
    };
  }
  const usage = (value as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown } }).usage;
  return {
    inputTokens: typeof usage?.prompt_tokens === "number" ? usage.prompt_tokens : null,
    outputTokens: typeof usage?.completion_tokens === "number" ? usage.completion_tokens : null,
    totalTokens: typeof usage?.total_tokens === "number" ? usage.total_tokens : null,
  };
}

function responseTruncated(config: AiRuntimeConfig, value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (config.provider === "gemini") {
    return (value as { candidates?: Array<{ finishReason?: unknown }> }).candidates?.[0]?.finishReason === "MAX_TOKENS";
  }
  if (config.provider === "ollama" && !ollamaUsesOpenAiCompatibility(config)) {
    return (value as { done_reason?: unknown }).done_reason === "length";
  }
  return (value as { choices?: Array<{ finish_reason?: unknown }> }).choices?.[0]?.finish_reason === "length";
}

export async function completeAi(
  config: AiRuntimeConfig,
  messages: AiMessage[],
  maxTokens = 800,
  options: AiCompletionOptions = {},
): Promise<string> {
  const target = endpoint(config);
  const inputChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  const safeMaxTokens = Number.isFinite(maxTokens) ? Math.max(1, Math.min(32_000, Math.floor(maxTokens))) : 800;
  const startedAt = performance.now();
  const run = await beginAiRun({
    ...options.context,
    operation: options.context?.operation ?? "llm.completion",
    provider: config.provider,
    model: config.model,
    inputChars,
  });
  let lastStatus: number | null = null;
  let attempts = 0;
  try {
    await assertSafeAiEndpoint(target);
    if (inputChars > 240_000) throw new AiProviderError("AI 요청 본문이 허용된 크기보다 큽니다.");
    for (let attempt = 0; attempt < 2; attempt += 1) {
      attempts = attempt + 1;
      let response: Response;
      try {
        response = await providerFetch(target, {
          method: "POST",
          headers: requestHeaders(config),
          body: JSON.stringify(body(config, messages, safeMaxTokens, options)),
          signal: AbortSignal.timeout(45_000),
          redirect: "error",
        });
        lastStatus = response.status;
      } catch (error) {
        const blocked = blockedConnectionError(error);
        if (blocked) throw blocked;
        if (attempt === 0) {
          await waitBeforeRetry();
          continue;
        }
        throw new AiProviderError("AI 서버에 연결하지 못했습니다.");
      }
      if (!response.ok) {
        if (attempt === 0 && new Set([408, 429, 500, 502, 503, 504]).has(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          await waitBeforeRetry(response);
          continue;
        }
        throw await responseError(response, "생성 요청");
      }
      const raw = await readResponseText(response, 2_000_000).catch((error) => {
        if (error instanceof AiProviderError) throw error;
        throw new AiProviderError("AI 서버가 올바른 응답을 반환하지 않았습니다.");
      });
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch { parsed = null; }
      if (responseTruncated(config, parsed)) throw new AiProviderError("AI 응답이 토큰 상한에서 잘렸습니다.");
      const text = readText(config, parsed);
      if (!text) throw new AiProviderError("AI 서버가 텍스트 응답을 반환하지 않았습니다.");
      const usage = providerUsage(config, parsed);
      await finishAiRun(run?.id ?? null, startedAt, {
        status: "succeeded",
        attempts,
        outputChars: text.length,
        ...usage,
        httpStatus: lastStatus,
      });
      return text;
    }
    throw new AiProviderError("AI 서버에 연결하지 못했습니다.");
  } catch (error) {
    await finishAiRun(run?.id ?? null, startedAt, {
      status: "failed",
      attempts,
      httpStatus: lastStatus,
      errorCode: providerErrorCode(error),
      errorMessage: error instanceof Error ? error.message : "AI 호출에 실패했습니다.",
    });
    throw error;
  }
}

/** 공급자가 현재 자격 증명에 허용한 모델을 조회한다. */
export async function listAiModels(config: AiRuntimeConfig, context?: AiRunContext): Promise<AiModelOption[]> {
  const target = modelsEndpoint(config);
  const startedAt = performance.now();
  const run = await beginAiRun({
    ...context,
    operation: context?.operation ?? "llm.models",
    provider: config.provider,
    model: config.model || "(model-list)",
    inputChars: 0,
  });
  let httpStatus: number | null = null;
  let attempts = 0;
  try {
    await assertSafeAiEndpoint(target);
    for (let attempt = 0; attempt < 2; attempt += 1) {
      attempts = attempt + 1;
      let response: Response;
      try {
        response = await providerFetch(target, {
          method: "GET",
          headers: requestHeaders(config),
          signal: AbortSignal.timeout(30_000),
          redirect: "error",
        });
        httpStatus = response.status;
      } catch (error) {
        const blocked = blockedConnectionError(error);
        if (blocked) throw blocked;
        if (attempt === 0) {
          await waitBeforeRetry();
          continue;
        }
        throw new AiProviderError("모델 목록을 불러오기 위해 AI 서버에 연결하지 못했습니다.");
      }
      if (!response.ok) {
        if (attempt === 0 && new Set([408, 429, 500, 502, 503, 504]).has(response.status)) {
          await response.body?.cancel().catch(() => undefined);
          await waitBeforeRetry(response);
          continue;
        }
        throw await responseError(response, "모델 목록 요청");
      }
      const raw = await readResponseText(response, 2_000_000);
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new AiProviderError("AI 서버가 올바른 모델 목록을 반환하지 않았습니다.");
      }

      const geminiRows = (parsed as { models?: unknown })?.models;
      const ollamaRows = (parsed as { models?: unknown })?.models;
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
        : config.provider === "ollama" && !ollamaUsesOpenAiCompatibility(config)
          ? (Array.isArray(ollamaRows) ? ollamaRows as Array<{ name?: unknown; model?: unknown; capabilities?: unknown }> : [])
            .flatMap((item) => {
              const id = typeof item.name === "string" ? item.name : typeof item.model === "string" ? item.model : "";
              if (!id || id.length > 200) return [];
              const capabilities = Array.isArray(item.capabilities) ? item.capabilities : [];
              if (capabilities.includes("embedding") && !capabilities.includes("completion")) return [];
              return [{ id, label: id }];
            })
        : (Array.isArray(openAiRows) ? openAiRows as Array<{ id?: unknown }> : [])
          .flatMap((item) => typeof item.id === "string" && item.id.trim() && item.id.trim().length <= 200
            && !(config.provider === "ollama" && /embed(?:ding)?/i.test(item.id))
            ? [{ id: item.id.trim(), label: item.id.trim() }]
            : []);

      const unique = new Map(models.map((item) => [item.id, item]));
      const result = [...unique.values()].sort((a, b) => a.label.localeCompare(b.label, "en")).slice(0, 1_000);
      await finishAiRun(run?.id ?? null, startedAt, { status: "succeeded", attempts, outputChars: raw.length, httpStatus });
      return result;
    }
    throw new AiProviderError("AI 서버에 연결하지 못했습니다.");
  } catch (error) {
    await finishAiRun(run?.id ?? null, startedAt, {
      status: "failed",
      attempts,
      httpStatus,
      errorCode: providerErrorCode(error),
      errorMessage: error instanceof Error ? error.message : "모델 목록 요청에 실패했습니다.",
    });
    throw error;
  }
}
