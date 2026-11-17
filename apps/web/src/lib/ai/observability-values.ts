export interface AiRunContext {
  operation?: string;
  traceId?: string;
  actorId?: string;
  conversationId?: string;
  metadata?: Record<string, string | number | boolean | null>;
  /**
   * 요청자가 끊으면 진행 중인 AI 호출도 끊는다. 모든 AI 호출에 이미 전달되는 값이 이것뿐이라
   * 여기에 둔다. signal을 인자로 따로 넘기면 한 곳만 빠져도 중단된 요청이 LLM 호출을 끝까지 쓴다.
   * 기록에는 남지 않는다(beginAiRun은 필드를 골라 저장한다).
   */
  signal?: AbortSignal;
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
