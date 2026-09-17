import "server-only";

import { randomUUID } from "node:crypto";
import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { aiRuns } from "@glossary/db";
import { getDb } from "@/lib/db";
import type {
  AiObservabilitySnapshot,
  AiOperationSummary,
  AiRecentFailure,
  AiRunContext,
} from "./observability-values";

const MAX_OPERATION_LENGTH = 120;
const MAX_PROVIDER_LENGTH = 80;
const MAX_MODEL_LENGTH = 200;
const MAX_ERROR_LENGTH = 500;

export interface AiRunStartInput extends AiRunContext {
  provider: string;
  model: string;
  inputChars: number;
}

export interface AiRunFinishInput {
  status: "succeeded" | "failed" | "cancelled";
  attempts: number;
  outputChars?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  totalTokens?: number | null;
  httpStatus?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
}

function boundedText(value: string, limit: number): string {
  return value.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, limit);
}

function safeErrorText(value: string): string {
  return boundedText(value, MAX_ERROR_LENGTH)
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .replace(/(?:api[-_ ]?key|token|password|secret)\s*[:=]\s*[^\s,;}]+/gi, (match) => `${match.slice(0, match.search(/[:=]/) + 1)}[REDACTED]`)
    .replace(/\b(?:sk|rk)-[A-Za-z0-9_-]{8,}\b/g, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{20,}\b/g, "[REDACTED]");
}

function nonNegativeInt(value: number | null | undefined): number | null {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  return Math.max(0, Math.floor(value));
}

function safeMetadata(value: AiRunContext["metadata"]): Record<string, string | number | boolean | null> {
  if (!value) return {};
  const result: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    if (!/^[A-Za-z0-9_.:-]{1,80}$/.test(key)) continue;
    if (item === null || typeof item === "boolean") result[key] = item;
    else if (typeof item === "string") result[key] = boundedText(item, 300);
    else if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
  }
  return result;
}

/** A provider call must never fail only because the observability database is unavailable. */
export async function beginAiRun(input: AiRunStartInput): Promise<{ id: string; traceId: string } | null> {
  const traceId = input.traceId && /^[0-9a-f-]{36}$/i.test(input.traceId) ? input.traceId : randomUUID();
  try {
    const [row] = await getDb().insert(aiRuns).values({
      traceId,
      operation: boundedText(input.operation || "ai.call", MAX_OPERATION_LENGTH),
      provider: boundedText(input.provider, MAX_PROVIDER_LENGTH),
      model: boundedText(input.model, MAX_MODEL_LENGTH),
      status: "running",
      attempts: 0,
      inputChars: nonNegativeInt(input.inputChars) ?? 0,
      metadata: safeMetadata(input.metadata),
      actorId: input.actorId && /^[0-9a-f-]{36}$/i.test(input.actorId) ? input.actorId : null,
      conversationId: input.conversationId && /^[0-9a-f-]{36}$/i.test(input.conversationId) ? input.conversationId : null,
    }).returning({ id: aiRuns.id });
    return row ? { id: row.id, traceId } : null;
  } catch {
    return null;
  }
}

export async function finishAiRun(id: string | null, startedAt: number, result: AiRunFinishInput): Promise<void> {
  if (!id) return;
  const inputTokens = nonNegativeInt(result.inputTokens);
  const outputTokens = nonNegativeInt(result.outputTokens);
  const totalTokens = nonNegativeInt(result.totalTokens)
    ?? (inputTokens !== null || outputTokens !== null ? (inputTokens ?? 0) + (outputTokens ?? 0) : null);
  try {
    await getDb().update(aiRuns).set({
      status: result.status,
      attempts: nonNegativeInt(result.attempts) ?? 0,
      outputChars: nonNegativeInt(result.outputChars) ?? 0,
      inputTokens,
      outputTokens,
      totalTokens,
      httpStatus: result.httpStatus && result.httpStatus >= 100 && result.httpStatus <= 599 ? Math.floor(result.httpStatus) : null,
      errorCode: result.errorCode ? boundedText(result.errorCode, 120) : null,
      errorMessage: result.errorMessage ? safeErrorText(result.errorMessage) : null,
      latencyMs: Math.max(0, Math.floor(performance.now() - startedAt)),
      finishedAt: new Date(),
    }).where(eq(aiRuns.id, id));
  } catch {
    // A failed metrics write must not turn a successful provider response into an error.
  }
}

/** Marks calls left in `running` by a crashed request so the dashboard cannot
 * report them as active forever. Provider timeouts normally finish through the
 * regular path; this covers process termination and deployment restarts. */
export async function reconcileStaleAiRuns(maxAgeMs = 15 * 60 * 1_000): Promise<number> {
  const age = Number.isFinite(maxAgeMs) ? Math.max(60_000, maxAgeMs) : 15 * 60 * 1_000;
  const staleBefore = new Date(Date.now() - age);
  try {
    const rows = await getDb().update(aiRuns).set({
      status: "failed",
      errorCode: "stale_run",
      errorMessage: "호출 프로세스가 종료되어 완료되지 않았습니다.",
      finishedAt: new Date(),
    }).where(and(
      eq(aiRuns.status, "running"),
      lt(aiRuns.startedAt, staleBefore),
    )).returning({ id: aiRuns.id });
    return rows.length;
  } catch {
    return 0;
  }
}

/** Converts provider failures to stable dashboard labels without persisting secrets or prompts. */
export function providerErrorCode(error: unknown): string {
  const status = error && typeof error === "object" && "status" in error && typeof error.status === "number"
    ? error.status : undefined;
  if (status === 401 || status === 403) return "authentication";
  if (status === 404) return "model_not_found";
  if (status === 429) return "rate_limited";
  if (status !== undefined && status >= 400 && status < 500) return "provider_request";
  if (status !== undefined && status >= 500) return "provider_unavailable";
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (message.includes("timeout") || message.includes("timed out") || message.includes("abort")) return "timeout";
  if (message.includes("연결") || message.includes("connect") || message.includes("network")) return "network";
  if (message.includes("토큰 상한") || message.includes("잘렸") || message.includes("truncat")) return "truncated";
  if (message.includes("응답") || message.includes("json") || message.includes("차원")) return "invalid_response";
  return "internal";
}

function numberValue(value: unknown): number {
  const number = typeof value === "number" ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
}

function nullableNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Returns privacy-safe, aggregate metrics for the administrator dashboard. */
export async function getAiObservabilitySnapshot(windowHours = 24): Promise<AiObservabilitySnapshot> {
  const hours = Math.max(1, Math.min(24 * 30, Math.floor(windowHours)));
  const since = new Date(Date.now() - hours * 60 * 60 * 1_000);
  await reconcileStaleAiRuns();
  const db = getDb();
  const [summaryRow, operationRows, failureRows] = await Promise.all([
    db.select({
      requests: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${aiRuns.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${aiRuns.status} = 'failed')::int`,
      cancelled: sql<number>`count(*) filter (where ${aiRuns.status} = 'cancelled')::int`,
      running: sql<number>`count(*) filter (where ${aiRuns.status} = 'running')::int`,
      averageLatencyMs: sql<number | null>`avg(${aiRuns.latencyMs}) filter (where ${aiRuns.latencyMs} is not null)`,
      p95LatencyMs: sql<number | null>`percentile_cont(0.95) within group (order by ${aiRuns.latencyMs}) filter (where ${aiRuns.latencyMs} is not null)`,
      inputTokens: sql<number>`coalesce(sum(${aiRuns.inputTokens}), 0)::bigint`,
      outputTokens: sql<number>`coalesce(sum(${aiRuns.outputTokens}), 0)::bigint`,
      totalTokens: sql<number>`coalesce(sum(${aiRuns.totalTokens}), 0)::bigint`,
    }).from(aiRuns).where(gte(aiRuns.startedAt, since)),
    db.select({
      operation: aiRuns.operation,
      provider: aiRuns.provider,
      model: aiRuns.model,
      requests: sql<number>`count(*)::int`,
      succeeded: sql<number>`count(*) filter (where ${aiRuns.status} = 'succeeded')::int`,
      failed: sql<number>`count(*) filter (where ${aiRuns.status} = 'failed')::int`,
      averageLatencyMs: sql<number | null>`avg(${aiRuns.latencyMs}) filter (where ${aiRuns.latencyMs} is not null)`,
      p95LatencyMs: sql<number | null>`percentile_cont(0.95) within group (order by ${aiRuns.latencyMs}) filter (where ${aiRuns.latencyMs} is not null)`,
      totalTokens: sql<number>`coalesce(sum(${aiRuns.totalTokens}), 0)::bigint`,
    }).from(aiRuns).where(gte(aiRuns.startedAt, since))
      .groupBy(aiRuns.operation, aiRuns.provider, aiRuns.model)
      .orderBy(desc(sql`count(*)`)).limit(100),
    db.select({
      id: aiRuns.id,
      traceId: aiRuns.traceId,
      operation: aiRuns.operation,
      provider: aiRuns.provider,
      model: aiRuns.model,
      status: aiRuns.status,
      attempts: aiRuns.attempts,
      httpStatus: aiRuns.httpStatus,
      errorCode: aiRuns.errorCode,
      errorMessage: aiRuns.errorMessage,
      latencyMs: aiRuns.latencyMs,
      startedAt: aiRuns.startedAt,
    }).from(aiRuns).where(and(
      gte(aiRuns.startedAt, since),
      sql`${aiRuns.status} in ('failed', 'cancelled')`,
    )).orderBy(desc(aiRuns.startedAt)).limit(20),
  ]);
  const summary = summaryRow[0];
  const completed = numberValue(summary?.succeeded) + numberValue(summary?.failed) + numberValue(summary?.cancelled);
  return {
    windowHours: hours,
    since: since.toISOString(),
    generatedAt: new Date().toISOString(),
    summary: {
      requests: numberValue(summary?.requests),
      succeeded: numberValue(summary?.succeeded),
      failed: numberValue(summary?.failed),
      cancelled: numberValue(summary?.cancelled),
      running: numberValue(summary?.running),
      successRate: completed ? numberValue(summary?.succeeded) / completed : 0,
      averageLatencyMs: nullableNumber(summary?.averageLatencyMs),
      p95LatencyMs: nullableNumber(summary?.p95LatencyMs),
      inputTokens: numberValue(summary?.inputTokens),
      outputTokens: numberValue(summary?.outputTokens),
      totalTokens: numberValue(summary?.totalTokens),
    },
    operations: operationRows.map((row): AiOperationSummary => ({
      operation: row.operation,
      provider: row.provider,
      model: row.model,
      requests: numberValue(row.requests),
      succeeded: numberValue(row.succeeded),
      failed: numberValue(row.failed),
      averageLatencyMs: nullableNumber(row.averageLatencyMs),
      p95LatencyMs: nullableNumber(row.p95LatencyMs),
      totalTokens: numberValue(row.totalTokens),
    })),
    recentFailures: failureRows.map((row): AiRecentFailure => ({
      id: row.id,
      traceId: row.traceId,
      operation: row.operation,
      provider: row.provider,
      model: row.model,
      status: row.status === "cancelled" ? "cancelled" : "failed",
      attempts: row.attempts,
      httpStatus: row.httpStatus,
      errorCode: row.errorCode,
      errorMessage: row.errorMessage,
      latencyMs: row.latencyMs,
      startedAt: row.startedAt.toISOString(),
    })),
  };
}
