import "server-only";

import { eq, type InferSelectModel } from "drizzle-orm";
import { aiConfig } from "@glossary/db";
import { getDb } from "@/lib/db";
import { aiEncryptionReady, decryptAiSecret, encryptAiSecret } from "./crypto";
import type { AiHeaderInput, AiProvider, PublicAiConfig } from "./config-values";

export const AI_CONFIG_ID = "default";
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BLOCKED_HEADERS = new Set([
  "accept-encoding", "connection", "content-length", "content-type", "cookie", "host", "proxy-authorization",
  "set-cookie", "te", "trailer", "transfer-encoding", "upgrade", "x-forwarded-for",
  "x-forwarded-host", "x-forwarded-proto",
]);

type AiConfigRow = InferSelectModel<typeof aiConfig>;
export interface StoredAiHeader { name: string; value: string }

export interface AiConnectionDraft {
  provider: AiProvider;
  baseUrl: string;
  apiKey?: string | null;
  customHeaders: AiHeaderInput[];
}

export interface AiConfigPatch {
  enabled: boolean;
  autoReviewEnabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey?: string | null;
  customHeaders: AiHeaderInput[];
}

export async function loadAiConfig(): Promise<AiConfigRow> {
  const db = getDb();
  const [row] = await db.select().from(aiConfig).where(eq(aiConfig.id, AI_CONFIG_ID)).limit(1);
  if (row) return row;
  await db.insert(aiConfig).values({ id: AI_CONFIG_ID }).onConflictDoNothing();
  const [created] = await db.select().from(aiConfig).where(eq(aiConfig.id, AI_CONFIG_ID)).limit(1);
  if (!created) throw new Error("AI 설정 행을 만들지 못했습니다.");
  return created;
}

function decodeHeaders(value: string): StoredAiHeader[] {
  if (!value) return [];
  const parsed = JSON.parse(decryptAiSecret(value)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("저장된 AI 헤더 형식이 올바르지 않습니다.");
  return parsed.filter((item): item is StoredAiHeader => Boolean(
    item && typeof item === "object"
    && typeof (item as StoredAiHeader).name === "string"
    && typeof (item as StoredAiHeader).value === "string",
  ));
}

export function publicAiConfig(row: AiConfigRow): PublicAiConfig {
  let headers: StoredAiHeader[] = [];
  let secretsReadable = true;
  if (row.customHeadersEncrypted) {
    try {
      headers = decodeHeaders(row.customHeadersEncrypted);
    } catch {
      secretsReadable = false;
    }
  }
  if ((row.apiKeyEncrypted || row.customHeadersEncrypted) && !aiEncryptionReady()) secretsReadable = false;
  return {
    enabled: row.enabled,
    autoReviewEnabled: row.autoReviewEnabled,
    provider: row.provider,
    baseUrl: row.baseUrl,
    model: row.model,
    hasApiKey: Boolean(row.apiKeyEncrypted),
    customHeaders: headers.map((header) => ({ name: header.name, configured: true })),
    encryptionReady: aiEncryptionReady(),
    secretsReadable,
  };
}

function validateHeaderName(name: string): string | null {
  const normalized = name.trim().toLowerCase();
  if (!HEADER_NAME.test(name.trim())) return `헤더 이름 “${name}”이 올바르지 않습니다.`;
  if (BLOCKED_HEADERS.has(normalized) || normalized.startsWith("x-forwarded-")) {
    return `보안을 위해 ${name} 헤더는 설정할 수 없습니다.`;
  }
  return null;
}

export function validateAiConfigInput(input: AiConfigPatch, hasApiKey: boolean): string[] {
  const problems: string[] = [];
  const baseUrl = input.baseUrl.trim();
  if (!input.model.trim()) problems.push("모델 이름을 입력해 주세요.");
  try {
    const url = new URL(baseUrl);
    if (!new Set(["http:", "https:"]).has(url.protocol)) problems.push("API 주소는 http 또는 https만 사용할 수 있습니다.");
    if (url.username || url.password) problems.push("API 주소에 사용자 이름이나 비밀번호를 넣지 마세요.");
  } catch {
    problems.push("API 주소를 올바른 URL로 입력해 주세요.");
  }
  if (input.provider === "gemini" && input.enabled && !hasApiKey) problems.push("Gemini를 활성화하려면 API 키를 입력해 주세요.");
  if (input.provider === "gemini" && input.customHeaders.length > 0) problems.push("Custom header는 OpenAI-compatible 연결에서만 사용할 수 있습니다.");
  if (input.customHeaders.length > 20) problems.push("Custom header는 최대 20개까지 설정할 수 있습니다.");
  const seen = new Set<string>();
  for (const header of input.customHeaders) {
    const name = header.name.trim();
    const issue = validateHeaderName(name);
    if (issue) problems.push(issue);
    const normalized = name.toLowerCase();
    if (seen.has(normalized)) problems.push(`${name} 헤더가 중복되었습니다.`);
    seen.add(normalized);
    if (header.value.length > 4096 || /[\r\n]/.test(header.value)) problems.push(`${name} 헤더 값을 확인해 주세요.`);
  }
  return [...new Set(problems)];
}

function currentSecrets(row: AiConfigRow): { apiKey: string; headers: StoredAiHeader[] } {
  return {
    apiKey: row.apiKeyEncrypted ? decryptAiSecret(row.apiKeyEncrypted) : "",
    headers: decodeHeaders(row.customHeadersEncrypted),
  };
}

/** 저장하지 않은 관리자 입력과 기존 암호문을 합쳐 연결 시험·모델 조회에 사용한다. */
export function runtimeAiConfigFromDraft(row: AiConfigRow, input: AiConnectionDraft, model = ""): ReturnType<typeof runtimeAiConfig> {
  const suppliedApiKey = input.apiKey?.trim() ?? "";
  const apiKey = input.apiKey === null
    ? ""
    : suppliedApiKey || (row.apiKeyEncrypted ? decryptAiSecret(row.apiKeyEncrypted) : "");
  const needsSavedHeaders = input.customHeaders.some((header) => !header.value);
  const savedHeaders = needsSavedHeaders ? decodeHeaders(row.customHeadersEncrypted) : [];
  const savedByName = new Map(savedHeaders.map((header) => [header.name.toLowerCase(), header.value]));
  const customHeaders = input.customHeaders.map((header) => ({
    name: header.name.trim(),
    value: header.value || savedByName.get(header.name.trim().toLowerCase()) || "",
  }));
  return {
    enabled: row.enabled,
    provider: input.provider,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    model,
    apiKey,
    customHeaders,
  };
}

export async function saveAiConfig(input: AiConfigPatch, updatedBy: string): Promise<{ ok: true; row: AiConfigRow } | { ok: false; problems: string[] }> {
  const current = await loadAiConfig();
  const touchesSecrets = input.apiKey !== undefined || input.customHeaders.length > 0 || Boolean(current.apiKeyEncrypted || current.customHeadersEncrypted);
  if (touchesSecrets && !aiEncryptionReady()) {
    return { ok: false, problems: ["서버에 GLOSSARY_ENCRYPTION_KEY를 32자 이상으로 설정한 뒤 다시 시도해 주세요."] };
  }

  let existing: { apiKey: string; headers: StoredAiHeader[] } = { apiKey: "", headers: [] };
  try {
    existing = currentSecrets(current);
  } catch {
    return { ok: false, problems: ["저장된 AI 비밀값을 읽을 수 없습니다. 서버의 암호화 키를 확인해 주세요."] };
  }

  const apiKey = input.apiKey === null ? "" : input.apiKey?.trim() || existing.apiKey;
  const existingByName = new Map(existing.headers.map((header) => [header.name.toLowerCase(), header.value]));
  const headers = input.customHeaders.map((header) => ({
    name: header.name.trim(),
    value: header.value || existingByName.get(header.name.trim().toLowerCase()) || "",
  }));
  const problems = validateAiConfigInput(input, Boolean(apiKey));
  for (const header of headers) {
    if (!header.value) problems.push(`${header.name} 헤더 값을 입력해 주세요.`);
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  const [saved] = await getDb().insert(aiConfig).values({
    id: AI_CONFIG_ID,
    enabled: input.enabled,
    autoReviewEnabled: input.autoReviewEnabled,
    provider: input.provider,
    baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
    model: input.model.trim(),
    apiKeyEncrypted: encryptAiSecret(apiKey),
    customHeadersEncrypted: headers.length ? encryptAiSecret(JSON.stringify(headers)) : "",
    updatedBy,
    updatedAt: new Date(),
  }).onConflictDoUpdate({
    target: aiConfig.id,
    set: {
      enabled: input.enabled,
      autoReviewEnabled: input.autoReviewEnabled,
      provider: input.provider,
      baseUrl: input.baseUrl.trim().replace(/\/+$/, ""),
      model: input.model.trim(),
      apiKeyEncrypted: encryptAiSecret(apiKey),
      customHeadersEncrypted: headers.length ? encryptAiSecret(JSON.stringify(headers)) : "",
      updatedBy,
      updatedAt: new Date(),
    },
  }).returning();
  if (!saved) throw new Error("AI 설정을 저장하지 못했습니다.");
  return { ok: true, row: saved };
}

export function runtimeAiConfig(row: AiConfigRow): { enabled: boolean; provider: AiProvider; baseUrl: string; model: string; apiKey: string; customHeaders: StoredAiHeader[] } {
  const secrets = currentSecrets(row);
  return { enabled: row.enabled, provider: row.provider, baseUrl: row.baseUrl, model: row.model, apiKey: secrets.apiKey, customHeaders: secrets.headers };
}
