/** 챗봇이 답을 만들며 거친 단계. 서버가 만들어 저장하며 클라이언트는 그대로 보여 주기만 한다. */
export interface ChatTraceStep {
  id: number;
  kind: "task" | "plan" | "search" | "answer";
  label: string;
  detail?: string;
  status: "running" | "done" | "failed";
  resultCount?: number;
  /** 요청 시작부터 이 단계가 시작될 때까지. 검색은 병렬로 돌기 때문에 단계 시간을 더하면 전체 시간이 부풀려진다. */
  offsetMs?: number;
  durationMs?: number;
}

export interface ChatTraceSummary {
  searches: number;
  durationMs: number;
}

export function summarizeTrace(steps: readonly ChatTraceStep[]): ChatTraceSummary {
  return {
    searches: steps.filter((step) => step.kind === "search").length,
    durationMs: steps.reduce((max, step) => Math.max(max, (step.offsetMs ?? 0) + (step.durationMs ?? 0)), 0),
  };
}

export function formatTraceDuration(ms: number): string {
  if (ms < 1_000) return `${Math.max(0, Math.round(ms))}ms`;
  const seconds = ms / 1_000;
  return seconds < 60 ? `${seconds.toFixed(seconds < 10 ? 1 : 0)}초` : `${Math.floor(seconds / 60)}분 ${Math.round(seconds % 60)}초`;
}

/** 같은 id의 단계는 최신 상태로 바꾸고, 새 id는 순서대로 덧붙인다. 스트림 이벤트가 중복돼도 목록이 늘지 않는다. */
export function upsertTraceStep(steps: readonly ChatTraceStep[], step: ChatTraceStep): ChatTraceStep[] {
  const index = steps.findIndex((item) => item.id === step.id);
  if (index < 0) return [...steps, step];
  return steps.map((item, current) => current === index ? step : item);
}
