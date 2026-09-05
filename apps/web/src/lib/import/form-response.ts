// R121: 계획서 스케치는 fetch 응답을 곧장 성공으로 가정했다
// (`if (dryRun) setReport(data.report); else setApplied(data.created);`) —
// res.ok를 확인하지 않고 바로 바디 모양을 믿으므로, 401(미인증)/413(파일
// 크기 초과)/400(형식 오류) 같은 실패 응답에서도 report/created가 그냥
// undefined인 채로 조용히 넘어가 화면에 아무 것도 뜨지 않았다(재현 확인).
// term-form.tsx의 R116/interpretResponse와 같은 이유로, "상태 코드 + 파싱된
// 바디"에서 "화면에 무엇을 보여줄지" 판정하는 순수 함수로 분리해 jsdom 없이
// 테스트한다.
//
// R114와 같은 이유로 apply.ts/parse-xlsx.ts의 타입을 그대로 import하지
// 않는다 — 그 두 파일은 @glossary/db(drizzle-orm)와 lib/terms/create.ts를
// 끌어오는 서버 전용 모듈이다. import-form.tsx는 Client Component이므로,
// 여기서 독립된 wire 타입을 다시 선언해 서버 전용 코드가 클라이언트 번들로
// 새는 걸 막는다.

export interface RowErrorWire {
  rowNumber: number;
  message: string;
}

export interface FileErrorWire {
  message: string;
}

export interface ImportConflictWire {
  rowNumber: number;
  name: string;
  conflictingSlugs: string[];
}

export interface DuplicateInFileWire {
  key: string;
  rowNumbers: number[];
}

export interface ImportReportWire {
  total: number;
  ready: number;
  conflicts: ImportConflictWire[];
  duplicatesInFile: DuplicateInFileWire[];
  errors: RowErrorWire[];
  fileErrors: FileErrorWire[];
  ignoredHeaders: string[];
}

export interface ApplySkipWire {
  rowNumber: number;
  reason: "conflict" | "duplicate_in_file";
}

export type ImportOutcome =
  | { kind: "dryRunSuccess"; report: ImportReportWire }
  | {
      kind: "applySuccess";
      created: number;
      skipped: ApplySkipWire[];
      parseErrors: RowErrorWire[];
      fileErrors: FileErrorWire[];
      ignoredHeaders: string[];
    }
  | { kind: "error"; message: string };

interface ApiErrorBody {
  error?: { code?: string; message?: string; details?: unknown };
}

const DEFAULT_ERROR_MESSAGE = "임포트 요청을 처리하지 못했습니다.";

function isReport(value: unknown): value is ImportReportWire {
  if (!value || typeof value !== "object") return false;
  const r = value as Partial<ImportReportWire>;
  return typeof r.total === "number" && typeof r.ready === "number" && Array.isArray(r.conflicts) && Array.isArray(r.duplicatesInFile) && Array.isArray(r.errors);
}

/**
 * fetch 응답의 ok 여부와 파싱된 JSON 바디로부터 화면에 보여줄 결과를
 * 판정한다. body가 JSON 파싱에 실패한 경우(null)에도, 서버가 예상과 다른
 * 모양의 성공 바디를 보낸 경우에도 항상 안전한 fallback(kind: "error")을
 * 반환한다 — 어떤 입력에도 예외를 던지지 않는다. (이 라우트는 term-form의
 * interpretResponse와 달리 상태 코드별로 details 모양이 갈리지 않으므로 —
 * 401/413/400 모두 { error: { message } } 하나뿐이라 — status 자체는
 * 판정에 쓰지 않는다.)
 */
export function interpretImportResponse(ok: boolean, body: unknown, dryRun: boolean): ImportOutcome {
  if (!ok) {
    const err = (body as ApiErrorBody | null)?.error;
    return { kind: "error", message: err?.message ?? DEFAULT_ERROR_MESSAGE };
  }

  const b = body as Record<string, unknown> | null;

  if (dryRun) {
    const report = b?.report;
    if (!isReport(report)) return { kind: "error", message: "서버 응답 형식이 올바르지 않습니다." };
    return { kind: "dryRunSuccess", report };
  }

  const created = b?.created;
  if (typeof created !== "number") return { kind: "error", message: "서버 응답 형식이 올바르지 않습니다." };

  return {
    kind: "applySuccess",
    created,
    skipped: Array.isArray(b?.skipped) ? (b.skipped as ApplySkipWire[]) : [],
    parseErrors: Array.isArray(b?.parseErrors) ? (b.parseErrors as RowErrorWire[]) : [],
    fileErrors: Array.isArray(b?.fileErrors) ? (b.fileErrors as FileErrorWire[]) : [],
    ignoredHeaders: Array.isArray(b?.ignoredHeaders) ? (b.ignoredHeaders as string[]) : [],
  };
}

/**
 * dry-run 리포트에서 "강제 등록"을 선택할 수 있는 행 번호 전체(충돌 + 파일
 * 내 중복, 합집합, 오름차순 중복 제거)를 계산한다. "모두 선택" 버튼과 표시
 * 순서 양쪽에 쓰는 로직을 화면 컴포넌트 밖으로 빼서 jsdom 없이 테스트한다.
 */
export function forceEligibleRowNumbers(report: Pick<ImportReportWire, "conflicts" | "duplicatesInFile">): number[] {
  const set = new Set<number>();
  for (const c of report.conflicts) set.add(c.rowNumber);
  for (const d of report.duplicatesInFile) for (const rn of d.rowNumbers) set.add(rn);
  return [...set].sort((a, b) => a - b);
}
