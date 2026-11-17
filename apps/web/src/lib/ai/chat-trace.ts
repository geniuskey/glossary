import type { ChatTraceStep } from "./chat-trace-values";

export class ChatAbortedError extends Error {
  constructor() {
    super("CHAT_ABORTED");
  }
}

export interface ChatRunHooks {
  onStep?: (step: ChatTraceStep) => void;
  signal?: AbortSignal;
}

export type ChatTracer = ReturnType<typeof createChatTracer>;

/** 단계 기록과 중단 확인을 한곳에 둔다. 단계마다 signal을 따로 넘기면 한 곳만 빠져도 끊긴 요청이 LLM 호출을 계속 쓴다. */
export function createChatTracer(hooks: ChatRunHooks = {}, now: () => number = () => performance.now()) {
  const origin = now();
  const steps: ChatTraceStep[] = [];
  const startedAt = new Map<number, number>();
  let currentTask: number | null = null;

  const emit = (step: ChatTraceStep) => hooks.onStep?.({ ...step });

  function finish(id: number, patch: Partial<Pick<ChatTraceStep, "status" | "detail" | "resultCount" | "label">> = {}) {
    const index = steps.findIndex((step) => step.id === id);
    const step = steps[index];
    if (!step || step.status !== "running") return;
    const next: ChatTraceStep = { ...step, status: "done", ...patch, durationMs: Math.round(now() - (startedAt.get(id) ?? origin)) };
    steps[index] = next;
    if (currentTask === id) currentTask = null;
    emit(next);
  }

  function start(kind: ChatTraceStep["kind"], label: string, detail?: string): number {
    // 진행 문구는 다음 단계가 시작되면 끝난 것이다. 남겨 두면 답이 끝날 때까지 돌고 있는 것처럼 보인다.
    if (kind !== "task" && currentTask !== null) finish(currentTask);
    const id = steps.length + 1;
    const at = now();
    startedAt.set(id, at);
    const step: ChatTraceStep = { id, kind, label, status: "running", offsetMs: Math.round(at - origin), ...(detail ? { detail } : {}) };
    steps.push(step);
    emit(step);
    return id;
  }

  return {
    steps,
    start,
    finish,
    /** 진행 문구 하나짜리 단계. 다음 task가 시작되면 앞의 것은 끝난 것으로 본다. */
    task(label: string): number {
      if (currentTask !== null) finish(currentTask);
      const id = start("task", label);
      currentTask = id;
      return id;
    },
    /** 남은 running 단계를 닫는다. 실패·중단이면 failed로 남겨 어디서 멈췄는지 보이게 한다. */
    close(status: "done" | "failed" = "done") {
      for (const step of [...steps]) if (step.status === "running") finish(step.id, { status });
    },
    checkAborted() {
      if (hooks.signal?.aborted) throw new ChatAbortedError();
    },
    get aborted() {
      return Boolean(hooks.signal?.aborted);
    },
  };
}
