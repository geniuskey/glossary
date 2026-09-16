import "server-only";

import { eq, type InferSelectModel } from "drizzle-orm";
import { ragConfig } from "@glossary/db";
import { getDb } from "@/lib/db";
import { aiEncryptionReady, decryptAiSecret, encryptAiSecret } from "@/lib/ai/crypto";
import type {
  PublicRagConfig,
  RagHeaderInput,
  RagIndexStats,
  RagEmbeddingProvider,
  RagRerankerProvider,
} from "./config-values";
import { RAG_VECTOR_DIMENSIONS } from "@glossary/db";

export const RAG_CONFIG_ID = "default";
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const BLOCKED_HEADERS = new Set([
  "accept-encoding", "connection", "content-length", "content-type", "cookie", "host", "proxy-authorization",
  "set-cookie", "te", "trailer", "transfer-encoding", "upgrade", "x-forwarded-for",
  "x-forwarded-host", "x-forwarded-proto",
]);

type RagConfigRow = InferSelectModel<typeof ragConfig>;
export type RagDatabase = ReturnType<typeof getDb> | Parameters<Parameters<ReturnType<typeof getDb>["transaction"]>[0]>[0];
export interface StoredRagHeader { name: string; value: string }

export interface RagConfigPatch {
  enabled: boolean;
  embeddingProvider: RagEmbeddingProvider;
  embeddingBaseUrl: string;
  embeddingModel: string;
  embeddingApiKey?: string | null;
  embeddingCustomHeaders: RagHeaderInput[];
  rerankerEnabled: boolean;
  rerankerProvider: RagRerankerProvider;
  rerankerBaseUrl: string;
  rerankerModel: string;
  rerankerApiKey?: string | null;
  rerankerCustomHeaders: RagHeaderInput[];
  chunkSize: number;
  chunkOverlap: number;
  topK: number;
}

export interface RagEndpointRuntime {
  provider: RagEmbeddingProvider | RagRerankerProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  customHeaders: StoredRagHeader[];
}

export interface EmbeddingRuntimeConfig extends RagEndpointRuntime {
  provider: RagEmbeddingProvider;
  dimensions: typeof RAG_VECTOR_DIMENSIONS;
}

export interface RerankerRuntimeConfig extends RagEndpointRuntime {
  provider: RagRerankerProvider;
}

export function loadRagConfig(): Promise<RagConfigRow> {
  return loadRagConfigInternal();
}

async function loadRagConfigInternal(): Promise<RagConfigRow> {
  const db = getDb();
  const [row] = await db.select().from(ragConfig).where(eq(ragConfig.id, RAG_CONFIG_ID)).limit(1);
  if (row) return row;
  await db.insert(ragConfig).values({ id: RAG_CONFIG_ID }).onConflictDoNothing();
  const [created] = await db.select().from(ragConfig).where(eq(ragConfig.id, RAG_CONFIG_ID)).limit(1);
  if (!created) throw new Error("RAG 설정 행을 만들지 못했습니다.");
  return created;
}

function decodeHeaders(value: string): StoredRagHeader[] {
  if (!value) return [];
  const parsed = JSON.parse(decryptAiSecret(value)) as unknown;
  if (!Array.isArray(parsed)) throw new Error("저장된 RAG 헤더 형식이 올바르지 않습니다.");
  return parsed.filter((item): item is StoredRagHeader => Boolean(
    item && typeof item === "object"
    && typeof (item as StoredRagHeader).name === "string"
    && typeof (item as StoredRagHeader).value === "string",
  ));
}

function readStoredHeaders(value: string): { headers: StoredRagHeader[]; readable: boolean } {
  if (!value) return { headers: [], readable: true };
  try {
    return { headers: decodeHeaders(value), readable: true };
  } catch {
    return { headers: [], readable: false };
  }
}

function canReadSecret(value: string): boolean {
  if (!value) return true;
  try {
    decryptAiSecret(value);
    return true;
  } catch {
    return false;
  }
}

export function publicRagConfig(row: RagConfigRow, stats: RagIndexStats): PublicRagConfig {
  const embeddingHeaders = readStoredHeaders(row.embeddingCustomHeadersEncrypted);
  const rerankerHeaders = readStoredHeaders(row.rerankerCustomHeadersEncrypted);
  const secretsReadable = embeddingHeaders.readable && rerankerHeaders.readable
    && canReadSecret(row.embeddingApiKeyEncrypted) && canReadSecret(row.rerankerApiKeyEncrypted);
  const encryptionReady = aiEncryptionReady();
  const readable = secretsReadable;
  return {
    enabled: row.enabled,
    embedding: {
      provider: row.embeddingProvider,
      baseUrl: row.embeddingBaseUrl,
      model: row.embeddingModel,
      dimensions: RAG_VECTOR_DIMENSIONS,
      hasApiKey: Boolean(row.embeddingApiKeyEncrypted),
      customHeaders: embeddingHeaders.headers.map((header) => ({ name: header.name, configured: true })),
      secretsReadable: readable,
    },
    reranker: {
      enabled: row.rerankerEnabled,
      provider: row.rerankerProvider,
      baseUrl: row.rerankerBaseUrl,
      model: row.rerankerModel,
      hasApiKey: Boolean(row.rerankerApiKeyEncrypted),
      customHeaders: rerankerHeaders.headers.map((header) => ({ name: header.name, configured: true })),
      secretsReadable: readable,
    },
    chunkSize: row.chunkSize,
    chunkOverlap: row.chunkOverlap,
    topK: row.topK,
    encryptionReady,
    secretsReadable: readable,
    stats,
  };
}

function validateUrl(raw: string, label: string, problems: string[]): void {
  try {
    const url = new URL(raw.trim());
    if (!new Set(["http:", "https:"]).has(url.protocol)) problems.push(`${label}는 http 또는 https만 사용할 수 있습니다.`);
    if (url.username || url.password) problems.push(`${label}에 사용자 이름이나 비밀번호를 넣지 마세요.`);
  } catch {
    problems.push(`${label}을 올바른 URL로 입력해 주세요.`);
  }
}

export function validateRagHeaders(headers: RagHeaderInput[], label: string): string[] {
  const problems: string[] = [];
  if (headers.length > 20) problems.push(`${label} custom header는 최대 20개까지 설정할 수 있습니다.`);
  const seen = new Set<string>();
  for (const header of headers) {
    const name = header.name.trim();
    if (!HEADER_NAME.test(name)) problems.push(`${label} header 이름 “${header.name}”이 올바르지 않습니다.`);
    const normalized = name.toLowerCase();
    if (BLOCKED_HEADERS.has(normalized) || normalized.startsWith("x-forwarded-")) {
      problems.push(`보안을 위해 ${name} header는 설정할 수 없습니다.`);
    }
    if (seen.has(normalized)) problems.push(`${name} header가 중복되었습니다.`);
    seen.add(normalized);
    if (header.value.length > 4_096 || /[\r\n]/.test(header.value)) problems.push(`${name} header 값을 확인해 주세요.`);
  }
  return problems;
}

export function validateRagConfigInput(input: RagConfigPatch): string[] {
  const problems: string[] = [];
  if (!input.embeddingModel.trim()) problems.push("Embedding 모델 이름을 입력해 주세요.");
  if (!input.rerankerModel.trim()) problems.push("Reranker 모델 이름을 입력해 주세요.");
  validateUrl(input.embeddingBaseUrl, "Embedding API 주소", problems);
  validateUrl(input.rerankerBaseUrl, "Reranker API 주소", problems);
  problems.push(...validateRagHeaders(input.embeddingCustomHeaders, "Embedding"));
  problems.push(...validateRagHeaders(input.rerankerCustomHeaders, "Reranker"));
  if (input.chunkSize < 400 || input.chunkSize > 8_000) problems.push("청크 크기는 400~8000자여야 합니다.");
  if (input.chunkOverlap < 0 || input.chunkOverlap > 2_000 || input.chunkOverlap >= input.chunkSize) {
    problems.push("청크 겹침은 0 이상이고 청크 크기보다 작아야 합니다.");
  }
  if (input.topK < 1 || input.topK > 50) problems.push("기본 검색 개수는 1~50 사이여야 합니다.");
  return [...new Set(problems)];
}

function currentSecrets(row: RagConfigRow, kind: "embedding" | "reranker"): { apiKey: string; headers: StoredRagHeader[] } {
  const apiKeyEncrypted = kind === "embedding" ? row.embeddingApiKeyEncrypted : row.rerankerApiKeyEncrypted;
  const headersEncrypted = kind === "embedding" ? row.embeddingCustomHeadersEncrypted : row.rerankerCustomHeadersEncrypted;
  return { apiKey: apiKeyEncrypted ? decryptAiSecret(apiKeyEncrypted) : "", headers: decodeHeaders(headersEncrypted) };
}

function mergeSecret(
  row: RagConfigRow,
  kind: "embedding" | "reranker",
  suppliedApiKey: string | null | undefined,
  suppliedHeaders: RagHeaderInput[],
): { apiKey: string; headers: StoredRagHeader[] } {
  const existing = currentSecrets(row, kind);
  const apiKey = suppliedApiKey === null ? "" : suppliedApiKey?.trim() || existing.apiKey;
  const existingByName = new Map(existing.headers.map((header) => [header.name.toLowerCase(), header.value]));
  const headers = suppliedHeaders.map((header) => ({
    name: header.name.trim(),
    value: header.value || existingByName.get(header.name.trim().toLowerCase()) || "",
  }));
  return { apiKey, headers };
}

export async function saveRagConfig(
  input: RagConfigPatch,
  updatedBy: string,
): Promise<{ ok: true; row: RagConfigRow } | { ok: false; problems: string[] }> {
  const current = await loadRagConfig();
  const touchesSecrets = input.embeddingApiKey !== undefined || input.rerankerApiKey !== undefined
    || input.embeddingCustomHeaders.length > 0 || input.rerankerCustomHeaders.length > 0
    || Boolean(current.embeddingApiKeyEncrypted || current.rerankerApiKeyEncrypted
      || current.embeddingCustomHeadersEncrypted || current.rerankerCustomHeadersEncrypted);
  if (touchesSecrets && !aiEncryptionReady()) {
    return { ok: false, problems: ["서버에 GLOSSARY_ENCRYPTION_KEY를 32자 이상으로 설정한 뒤 다시 시도해 주세요."] };
  }

  let embedding: { apiKey: string; headers: StoredRagHeader[] };
  let reranker: { apiKey: string; headers: StoredRagHeader[] };
  try {
    embedding = mergeSecret(current, "embedding", input.embeddingApiKey, input.embeddingCustomHeaders);
    reranker = mergeSecret(current, "reranker", input.rerankerApiKey, input.rerankerCustomHeaders);
  } catch {
    return { ok: false, problems: ["저장된 RAG 비밀값을 읽을 수 없습니다. 서버의 암호화 키를 확인해 주세요."] };
  }

  const problems = validateRagConfigInput(input);
  for (const header of [...embedding.headers, ...reranker.headers]) {
    if (!header.value) problems.push(`${header.name} header 값을 입력해 주세요.`);
  }
  if (input.enabled && input.embeddingProvider === "gemini" && !embedding.apiKey) {
    problems.push("Gemini Embedding을 활성화하려면 API 키를 입력해 주세요.");
  }
  if (problems.length > 0) return { ok: false, problems: [...new Set(problems)] };

  const values = {
    id: RAG_CONFIG_ID,
    enabled: input.enabled,
    embeddingProvider: input.embeddingProvider,
    embeddingBaseUrl: input.embeddingBaseUrl.trim().replace(/\/+$/, ""),
    embeddingModel: input.embeddingModel.trim(),
    embeddingApiKeyEncrypted: encryptAiSecret(embedding.apiKey),
    embeddingCustomHeadersEncrypted: embedding.headers.length ? encryptAiSecret(JSON.stringify(embedding.headers)) : "",
    rerankerEnabled: input.rerankerEnabled,
    rerankerProvider: input.rerankerProvider,
    rerankerBaseUrl: input.rerankerBaseUrl.trim().replace(/\/+$/, ""),
    rerankerModel: input.rerankerModel.trim(),
    rerankerApiKeyEncrypted: encryptAiSecret(reranker.apiKey),
    rerankerCustomHeadersEncrypted: reranker.headers.length ? encryptAiSecret(JSON.stringify(reranker.headers)) : "",
    chunkSize: input.chunkSize,
    chunkOverlap: input.chunkOverlap,
    topK: input.topK,
    updatedBy,
    updatedAt: new Date(),
  };
  const [saved] = await getDb().insert(ragConfig).values(values).onConflictDoUpdate({
    target: ragConfig.id,
    set: values,
  }).returning();
  if (!saved) throw new Error("RAG 설정을 저장하지 못했습니다.");
  return { ok: true, row: saved };
}

export function runtimeEmbeddingConfig(row: RagConfigRow): EmbeddingRuntimeConfig {
  const secrets = currentSecrets(row, "embedding");
  return {
    provider: row.embeddingProvider,
    baseUrl: row.embeddingBaseUrl,
    model: row.embeddingModel,
    apiKey: secrets.apiKey,
    customHeaders: secrets.headers,
    dimensions: RAG_VECTOR_DIMENSIONS,
  };
}

export function runtimeRerankerConfig(row: RagConfigRow): RerankerRuntimeConfig {
  const secrets = currentSecrets(row, "reranker");
  return {
    provider: row.rerankerProvider,
    baseUrl: row.rerankerBaseUrl,
    model: row.rerankerModel,
    apiKey: secrets.apiKey,
    customHeaders: secrets.headers,
  };
}
