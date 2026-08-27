"use client";

import { useState, type ChangeEvent } from "react";
import {
  forceEligibleRowNumbers,
  interpretImportResponse,
  type ApplySkipWire,
  type ImportReportWire,
} from "@/lib/import/form-response";

interface AppliedState {
  created: number;
  skipped: ApplySkipWire[];
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

  function onFileChange(e: ChangeEvent<HTMLInputElement>) {
    setFile(e.target.files?.[0] ?? null);
    setReport(null);
    setApplied(null);
    setErrorMessage(null);
    setForced(new Set());
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

  return (
    <div className="max-w-2xl space-y-6">
      <input type="file" accept=".xlsx" onChange={onFileChange} disabled={locked} className="block text-sm" />

      {errorMessage && (
        <div className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-900">{errorMessage}</div>
      )}

      {applied && (
        <div className="rounded border border-emerald-300 bg-emerald-50 p-3 text-sm text-emerald-900">
          <p>{applied.created}개 용어를 등록했습니다.</p>
          {applied.skipped.length > 0 && <p>{applied.skipped.length}개 행은 충돌/중복으로 건너뛰었습니다.</p>}
        </div>
      )}

      {!applied && (
        <button
          type="button"
          onClick={runDryRun}
          disabled={!file || busy}
          className="rounded bg-slate-900 px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {busy ? "검사 중..." : "검사만 실행 (dry-run)"}
        </button>
      )}

      {report && !applied && (
        <section className="space-y-4 text-sm">
          <p>
            총 {report.total}행 중 {report.ready}행 바로 등록 가능
          </p>

          {report.fileErrors.length > 0 && (
            <div className="rounded border border-red-200 bg-red-50 p-3">
              <p className="mb-1 font-medium text-red-900">파일을 읽을 수 없습니다</p>
              <ul className="list-disc pl-5">
                {report.fileErrors.map((e, i) => (
                  <li key={i}>{e.message}</li>
                ))}
              </ul>
            </div>
          )}

          {report.ignoredHeaders.length > 0 && (
            <div className="rounded border border-slate-200 bg-slate-50 p-3">
              <p className="mb-1 font-medium">인식하지 못해 무시한 열</p>
              <p>{report.ignoredHeaders.join(", ")}</p>
            </div>
          )}

          {report.errors.length > 0 && (
            <div className="rounded border border-red-200 bg-red-50 p-3">
              <p className="mb-1 font-medium text-red-900">건너뛸 행 {report.errors.length}개</p>
              <ul className="list-disc pl-5">
                {report.errors.map((e, i) => (
                  <li key={i}>
                    {e.rowNumber}행: {e.message}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.duplicatesInFile.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 font-medium text-amber-900">파일 안에서 중복된 표기 (기본값: 건너뜀)</p>
              <ul className="space-y-1">
                {report.duplicatesInFile.map((d) => (
                  <li key={d.key}>
                    <span className="font-mono">{d.key}</span>:{" "}
                    {d.rowNumbers.map((rn) => (
                      <label key={rn} className="ml-2 inline-flex items-center gap-1">
                        <input type="checkbox" checked={forced.has(rn)} onChange={() => toggleForce(rn)} />
                        {rn}행
                      </label>
                    ))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {report.conflicts.length > 0 && (
            <div className="rounded border border-amber-200 bg-amber-50 p-3">
              <p className="mb-1 font-medium text-amber-900">이미 등록된 용어와 겹침 (기본값: 건너뜀)</p>
              <ul className="space-y-1">
                {report.conflicts.map((c) => (
                  <li key={c.rowNumber}>
                    <label className="inline-flex items-center gap-2">
                      <input type="checkbox" checked={forced.has(c.rowNumber)} onChange={() => toggleForce(c.rowNumber)} />
                      {c.rowNumber}행 {c.name} → {c.conflictingSlugs.join(", ")}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {eligible.length > 0 && (
            <button type="button" onClick={selectAllEligible} className="text-xs underline">
              충돌/중복 행 모두 강제 등록으로 선택
            </button>
          )}

          <div>
            <button
              type="button"
              onClick={runApply}
              disabled={busy || (report.total === 0 && forced.size === 0)}
              className="rounded bg-emerald-700 px-4 py-2 text-sm text-white disabled:opacity-50"
            >
              {busy ? "등록 중..." : `${report.ready + forced.size}개 실제로 등록하기`}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
