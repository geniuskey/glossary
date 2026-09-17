export interface AiRunContext {
  operation?: string;
  traceId?: string;
  actorId?: string;
  conversationId?: string;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface AiRunSummary {
  requests: number;
  succeeded: number;
  failed: number;
  cancelled: number;
  running: number;
  successRate: number;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AiOperationSummary {
  operation: string;
  provider: string;
  model: string;
  requests: number;
  succeeded: number;
  failed: number;
  averageLatencyMs: number | null;
  p95LatencyMs: number | null;
  totalTokens: number;
}

export interface AiRecentFailure {
  id: string;
  traceId: string;
  operation: string;
  provider: string;
  model: string;
  status: "failed" | "cancelled";
  attempts: number;
  httpStatus: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  latencyMs: number | null;
  startedAt: string;
}

export interface AiObservabilitySnapshot {
  windowHours: number;
  since: string;
  generatedAt: string;
  summary: AiRunSummary;
  operations: AiOperationSummary[];
  recentFailures: AiRecentFailure[];
}
