"use client";

import { useState, type ChangeEvent, type DragEvent, type ReactNode } from "react";
import {
  forceEligibleRowNumbers,
  interpretImportResponse,
  type ApplySkipWire,
  type ImportReportWire,
} from "@/lib/import/form-response";
import { cx } from "@/lib/ui/format";

interface AppliedState {
  created: number;
  skipped: ApplySkipWire[];
}

// 충돌(이미 등록된 용어와 겹침)과 파일 안 중복은 사용자가 내리는 판단이 같다 —
// "이 행을 그래도 등록할까". 그래서 두 목록을 한 표로 합치고 구분만 열로 둔다.
// 행 번호 오름차순은 forceEligibleRowNumbers와 같은 순서라, "모두 선택"이 켜는
// 순서와 눈에 보이는 순서가 어긋나지 않는다.
type ForceRow = { rowNumber: number; kind: "conflict" | "duplicate"; detail: string };

function forceRowsOf(report: ImportReportWire): ForceRow[] {
  const rows: ForceRow[] = [];
  for (const c of report.conflicts) {
    rows.push({ rowNumber: c.rowNumber, kind: "conflict", detail: `${c.name} → ${c.conflictingSlugs.join(", ")}` });
  }
  for (const d of report.duplicatesInFile) {
    for (const rn of d.rowNumbers) rows.push({ rowNumber: rn, kind: "duplicate", detail: d.key });
  }
  return rows.sort((a, b) => a.rowNumber - b.rowNumber);
}

async function postImport(file: File, dryRun: boolean, forceRowNumbers: number[]) {
  const body = new FormData();
  body.set("file", file);
  body.set("dryRun", String(dryRun));
  if (forceRowNumbers.length > 0) body.set("force", forceRowNumbers.join(","));

  let res: Response;
  try {
    res = await fetch("/api/v1/import", { method: "POST", body });
  } catch {
    return { kind: "error" as const, message: "네트워크 오류로 요청하지 못했습니다." };
  }

  const parsedBody = await res.json().catch(() => null);
  return interpretImportResponse(res.ok, parsedBody, dryRun);
}

export function ImportForm() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [report, setReport] = useState<ImportReportWire | null>(null);
  const [applied, setApplied] = useState<AppliedState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [forced, setForced] = useState<Set<number>>(new Set());
  const [dragging, setDragging] = useState(false);

  // 파일이 바뀌면 이전 검사 결과는 더 이상 그 파일의 것이 아니다. 파일을 고르는
  // 경로가 둘(입력 상자, 끌어다 놓기)이라 초기화를 한 함수로 모은다.
  function acceptFile(next: File | null) {
    setFile(next);
    setReport(null);
    setApplied(null);
    setErrorMessage(null);
    setForced(new Set());
  }

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    acceptFile(e.target.files?.[0] ?? null);
  }

  function toggleForce(rowNumber: number) {
    setForced((prev) => {
      const next = new Set(prev);
      if (next.has(rowNumber)) next.delete(rowNumber);
      else next.add(rowNumber);
      return next;
    });
  }

  function selectAllEligible() {
    if (!report) return;
    setForced(new Set(forceEligibleRowNumbers(report)));
  }

  async function runDryRun() {
    if (!file || busy) return;
    setBusy(true);
    setErrorMessage(null);
    setApplied(null);

    const outcome = await postImport(file, true, []);
    setBusy(false);

    if (outcome.kind === "error") {
      setErrorMessage(outcome.message);
      setReport(null);
      return;
    }
    if (outcome.kind === "dryRunSuccess") {
      setReport(outcome.report);
      setForced(new Set());
    }
  }

  async function runApply() {
    if (!file || busy) return;
    setBusy(true);
    setErrorMessage(null);

    const outcome = await postImport(file, false, [...forced]);
    setBusy(false);

    if (outcome.kind === "error") {
      setErrorMessage(outcome.message);
      return;
    }
    if (outcome.kind === "applySuccess") {
      setApplied({ created: outcome.created, skipped: outcome.skipped });
      setReport(null);
    }
  }

  const locked = busy || applied !== null;
  const eligible = report ? forceEligibleRowNumbers(report) : [];

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragging(false);
    if (locked) return;
    const dropped = e.dataTransfer.files?.[0];
    if (dropped) acceptFile(dropped);
  }

  return (
    <div className="max-w-3xl space-y-6">
      {/* 끌어다 놓기는 덤이다 — 파일 선택 자체는 그대로 <input type="file">이
          맡고(label이 감싸므로 영역 어디를 눌러도 열린다), drop은 같은
          acceptFile로 합류시킨다. */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!locked) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={cx(
          "card border-dashed border-line-strong transition",
          dragging && !locked && "border-brand bg-brand/10",
          locked && "opacity-60",
        )}
      >
        <label
          className={cx(
            "flex flex-col items-center gap-2 px-6 py-10 text-center",
            locked ? "cursor-not-allowed" : "cursor-pointer",
          )}
        >
          <input type="file" accept=".xlsx" onChange={onFileChange} disabled={locked} className="sr-only" />
          <IconSheet />
          {file ? (
            <>
              <span className="font-mono text-sm text-ink">{file.name}</span>
              <span className="text-xs text-ink-3">다시 누르거나 다른 파일을 끌어다 놓으면 바뀝니다</span>
            </>
          ) : (
            <>
              <span className="text-sm font-medium text-ink">xlsx 파일을 끌어다 놓거나 눌러서 선택</span>
              <span className="text-xs text-ink-3">첫 행은 열 이름으로 읽습니다</span>
            </>
          )}
        </label>
      </div>

      {errorMessage && <p className="note-danger animate-fade-up">{errorMessage}</p>}

      {applied && (
        <div className="note-ok animate-fade-up space-y-1">
          <p className="font-medium">{applied.created}개 용어를 등록했습니다.</p>
          {applied.skipped.length > 0 && <p>{applied.skipped.length}개 행은 충돌/중복으로 건너뛰었습니다.</p>}
        </div>
      )}

      {!applied && (
        <button type="button" onClick={runDryRun} disabled={!file || busy} className="btn-primary">
          {busy ? "검사 중..." : "검사만 실행 (dry-run)"}
        </button>
      )}

      {report && !applied && (
        <section className="animate-fade-up space-y-5">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <StatCard label="전체 행" value={report.total} />
            <StatCard label="바로 등록" value={report.ready} tone="ok" />
            <StatCard label="충돌·중복" value={eligible.length} tone="warn" />
            <StatCard label="건너뛸 행" value={report.errors.length} tone="danger" />
          </div>

          {report.fileErrors.length > 0 && (
            <div className="note-danger space-y-1">
              <p className="font-medium">파일을 읽을 수 없습니다</p>
              <ul className="list-disc pl-5">
                {report.fileErrors.map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            </div>
          )}

          {report.ignoredHeaders.length > 0 && (
            <div className="card px-4 py-3">
              <p className="text-xs font-medium tracking-wide text-ink-2">인식하지 못해 무시한 열</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {report.ignoredHeaders.map((h) => (
                  <span key={h} className="chip font-mono">
                    {h}
                  </span>
                ))}
              </div>
            </div>
          )}

          {report.errors.length > 0 && (
            <TablePanel title="건너뛸 행" hint={`${report.errors.length}개 · 값이 모자라거나 형식이 맞지 않습니다`}>
              <thead>
                <tr>
                  <Th className="w-16">행</Th>
                  <Th>문제</Th>
                </tr>
              </thead>
              <tbody>
                {report.errors.map((e, i) => (
                  <tr key={i}>
                    <Td className="font-mono text-xs text-ink-3">{e.rowNumber}</Td>
                    <Td className="text-danger">{e.message}</Td>
                  </tr>
                ))}
              </tbody>
            </TablePanel>
          )}

          {eligible.length > 0 && (
            <>
              <TablePanel
                title="충돌·중복"
                hint={`${eligible.length}개 · 기본값은 건너뜀`}
                action={
                  <button type="button" onClick={selectAllEligible} className="btn-quiet btn-sm">
                    모두 강제 등록으로 선택
                  </button>
                }
              >
                <thead>
                  <tr>
                    <Th className="w-14">등록</Th>
                    <Th className="w-16">행</Th>
                    <Th className="w-28">구분</Th>
                    <Th>내용</Th>
                  </tr>
                </thead>
                <tbody>
                  {forceRowsOf(report).map((r) => (
                    <tr key={`${r.kind}-${r.rowNumber}`}>
                      <Td>
                        <input
                          type="checkbox"
                          checked={forced.has(r.rowNumber)}
                          onChange={() => toggleForce(r.rowNumber)}
                          aria-label={`${r.rowNumber}행 강제 등록`}
                          className="accent-brand"
                        />
                      </Td>
                      <Td className="font-mono text-xs text-ink-3">{r.rowNumber}</Td>
                      <Td>
                        <span className="chip">{r.kind === "conflict" ? "기존 겹침" : "파일 내 중복"}</span>
                      </Td>
                      <Td className="font-mono text-xs text-ink-2">{r.detail}</Td>
                    </tr>
                  ))}
                </tbody>
              </TablePanel>
              <p className="note-warn">
                체크하지 않은 충돌·중복 행은 등록되지 않습니다. 그래도 올릴 행만 위에서 골라주세요.
              </p>
            </>
          )}

          <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
            <button
              type="button"
              onClick={runApply}
              disabled={busy || (report.total === 0 && forced.size === 0)}
              className="btn-primary"
            >
              {busy ? "등록 중..." : `${report.ready + forced.size}개 실제로 등록하기`}
            </button>
            <span className="text-xs text-ink-3">
              바로 등록 {report.ready}개 + 강제 등록 {forced.size}개
            </span>
          </div>
        </section>
      )}
    </div>
  );
}

const STAT_TONE = {
  plain: "text-ink",
  ok: "text-ok",
  warn: "text-warn",
  danger: "text-danger",
} as const;

// 0은 "문제 없음"이라 강조하면 안 된다 — 색을 그대로 두면 0건짜리 경고 카드가
// 실제 경고와 같은 무게로 읽힌다.
function StatCard({ label, value, tone = "plain" }: { label: string; value: number; tone?: keyof typeof STAT_TONE }) {
  return (
    <div className="card px-3.5 py-3">
      <p className={cx("text-2xl font-semibold tabular-nums", value === 0 ? "text-ink-3" : STAT_TONE[tone])}>{value}</p>
      <p className="mt-0.5 text-xs text-ink-2">{label}</p>
    </div>
  );
}

function TablePanel({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-line px-4 py-2.5">
        <h2 className="text-sm font-medium text-ink">{title}</h2>
        <p className="text-xs text-ink-3">{hint}</p>
        {action && <span className="ml-auto">{action}</span>}
      </div>
      {/* 표는 좁은 화면에서 가로로 넘칠 수 있다 — 넘치는 축을 표 자신이 감당하게
          해서 화면 전체가 가로로 밀리지 않게 한다. */}
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-0 text-sm">{children}</table>
      </div>
    </div>
  );
}

function Th({ className, children }: { className?: string; children?: ReactNode }) {
  return (
    <th
      className={cx(
        "border-b border-grid bg-panel-2 px-3 py-2 text-left text-[11px] font-medium tracking-wide text-ink-2",
        className,
      )}
    >
      {children}
    </th>
  );
}

function Td({ className, children }: { className?: string; children?: ReactNode }) {
  return <td className={cx("border-b border-grid px-3 py-2 align-middle text-ink-2", className)}>{children}</td>;
}

/** 표(스프레드시트) 한 장 — 이 화면이 받는 것이 xlsx라는 걸 먼저 그림으로 말한다. */
function IconSheet() {
  return (
    <svg width="30" height="30" viewBox="0 0 24 24" fill="none" aria-hidden className="mb-1 text-ink-3">
      <rect x="3.5" y="3" width="17" height="18" rx="2.5" stroke="currentColor" strokeWidth="1.4" />
      <path d="M3.5 9h17M9.5 9v12" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  );
}
