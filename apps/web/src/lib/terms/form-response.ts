import type { TermWriteResponse } from "./wire";

// R116: fetch 자체는 순수 함수로 감쌀 수 없지만(네트워크), "받은 상태 코드와
// 파싱된 바디를 보고 화면에 무엇을 보여줄지 결정하는" 분기 로직은 순수하다.
// logout.ts가 fetch/router를 주입받아 분리한 것과 같은 이유로, 이 판단을
// 별도 함수로 빼서 jsdom 없이 테스트한다(R97).
//
// R113: 서버가 400을 돌려주는 경로가 두 가지 다른 모양의 details를 싣는다.
// - POST/PATCH의 zod 검증 실패: `parsed.error.flatten()` → { fieldErrors,
//   formErrors } (route.ts:112, [idOrSlug]/route.ts:44).
// - PATCH의 updateTerm "invalid"(표기 모순, R52): { issues: string[] }
//   ([idOrSlug]/route.ts:63).
// 두 모양을 구분해서 처리하지 않으면(한쪽만 읽으면) 다른 쪽은 항상
// "message만 있는 일반 오류"로 뭉개져 사용자가 정확히 어느 필드가 문제인지
// 알 수 없다.
export type FormOutcome =
  | { kind: "success"; term: { slug: string; status?: TermWriteResponse["term"]["status"] }; surfaces: TermWriteResponse["surfaces"]; warnings: TermWriteResponse["warnings"] }
  | { kind: "conflict"; message: string; currentRevision: number | null }
  | { kind: "issues"; message: string; issues: string[] }
  | { kind: "fieldErrors"; message: string; fieldErrors: Record<string, string[]>; formErrors: string[] }
  | { kind: "error"; message: string };

interface ApiErrorBody {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
}

const DEFAULT_ERROR_MESSAGE = "저장에 실패했습니다.";

/**
 * fetch 응답의 상태 코드와 파싱된 JSON 바디로부터 화면에 보여줄 결과를
 * 판정한다. body가 JSON 파싱에 실패한 경우(null)에도 항상 안전한 fallback
 * (kind: "error")을 반환한다 — 어떤 입력에도 예외를 던지지 않는다.
 */
export function interpretResponse(status: number, ok: boolean, body: unknown): FormOutcome {
  if (ok) {
    const b = body as Partial<TermWriteResponse> | null;
    if (b && typeof b === "object" && b.term && typeof b.term.slug === "string") {
      return {
        kind: "success",
        term: { slug: b.term.slug, ...(b.term.status ? { status: b.term.status } : {}) },
        surfaces: b.surfaces ?? [],
        warnings: b.warnings ?? [],
      };
    }
    return { kind: "error", message: "서버 응답을 이해할 수 없습니다." };
  }

  const err = (body as ApiErrorBody | null)?.error;
  const message = err?.message ?? DEFAULT_ERROR_MESSAGE;

  if (status === 409) {
    const details = err?.details as { currentRevision?: number } | undefined;
    return {
      kind: "conflict",
      message: "다른 사람이 먼저 수정했습니다. 새로고침 후 다시 시도하세요.",
      currentRevision: typeof details?.currentRevision === "number" ? details.currentRevision : null,
    };
  }

  if (status === 400) {
    const details = err?.details as
      | { issues?: string[]; fieldErrors?: Record<string, string[]>; formErrors?: string[] }
      | undefined;

    if (Array.isArray(details?.issues)) {
      return { kind: "issues", message, issues: details.issues };
    }
    if (details?.fieldErrors || details?.formErrors) {
      return {
        kind: "fieldErrors",
        message,
        fieldErrors: details.fieldErrors ?? {},
        formErrors: details.formErrors ?? [],
      };
    }
  }

  return { kind: "error", message };
}
