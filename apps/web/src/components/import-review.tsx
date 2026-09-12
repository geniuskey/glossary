"use client";

import { useRef, useState } from "react";
import { DEFAULT_SPLIT_OPTIONS, needsReview, REVIEW_OPTIONAL_COLUMNS, reviewColumns, type ReviewOptionalColumn, type ReviewDecision, type ReviewReport, type ReviewRow } from "@/lib/import/review";
import { MAX_IMPORT_BYTES } from "@/lib/import/format";

export function ImportReview({ initialText = "", onApplied, onBusyChange }: { initialText?: string; onApplied?: () => void; onBusyChange?: (busy: boolean) => void }) {
  const [text, setText] = useState(initialText);
  const [file, setFile] = useState<File | null>(null);
  const [hasHeaders, setHasHeaders] = useState(false);
  const [options, setOptions] = useState(DEFAULT_SPLIT_OPTIONS);
  const [selectedColumns, setSelectedColumns] = useState<ReviewOptionalColumn[]>([]);
  const columns = reviewColumns(selectedColumns);
  const [report, setReport] = useState<ReviewReport | null>(null);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [index, setIndex] = useState(0);
  const [onlyPending, setOnlyPending] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [finished, setFinished] = useState(false);
  const [completed, setCompleted] = useState<number[]>([]);
  const [uncertain, setUncertain] = useState(false);
  const sourceInput = useRef<HTMLInputElement>(null);

  function reset() {
    setReport(null); setIndex(0); setDirty(false); setError(""); setMessage("");
    setFinished(false); setCompleted([]); setUncertain(false);
  }

  async function inspect(apply = false) {
    if (busyRef.current || (!file && !text.trim())) return;
    busyRef.current = true; setBusy(true); onBusyChange?.(true); setError(""); setMessage("");
    const body = new FormData();
    if (file) body.set("file", file); else body.set("text", text);
    body.set("hasHeaders", String(hasHeaders));
    const clean = (values: string[]) => [...new Set(values.map((v) => v.trim()).filter(Boolean))];
    body.set("review", JSON.stringify({ options, columns: selectedColumns, decisions: report?.rows.map(({ rowNumber, en, ko, skip, approval }) => ({ rowNumber, en: clean(en), ko: clean(ko), skip, approval })) ?? [] }));
    body.set("apply", String(apply));
    try {
      const response = await fetch("/api/v1/import/review", { method: "POST", body });
      const result = await response.json();
      if (!response.ok || !result.report) throw new Error(result.error?.message ?? "검토 결과를 읽지 못했습니다.");
      const next = result.report as ReviewReport;
      const saved = [...completed, ...(result.completed as number[] | undefined ?? [])];
      setCompleted(saved);
      const savedSet = new Set(saved);
      next.rows = next.rows.map((row) => savedSet.has(row.rowNumber) ? { ...row, skip: true } : row);
      setReport(next); setDirty(false);
      if (result.needsReview) {
        setMessage("검사 결과가 바뀐 행이 있습니다. 내용을 확인하고 다시 승인해 주세요.");
        setOnlyPending(true); setIndex(0);
      } else if (apply) {
        const failure = result.failures?.[0];
        setMessage(`${saved.length}개 용어를 등록했습니다.${failure ? ` ${failure.rowNumber}행에서 저장이 중단됐습니다. 완료한 행은 재등록하지 않습니다.` : ""}`);
        if (failure) { setError(failure.message); setDirty(true); }
        else setFinished(true);
        onApplied?.();
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "네트워크 오류가 발생했습니다.");
      if (apply) {
        setUncertain(true);
        setMessage("저장 응답을 확인하지 못했습니다. 시트에서 등록 결과를 확인한 뒤 새로 검사해 주세요.");
      }
    } finally { busyRef.current = false; setBusy(false); onBusyChange?.(false); }
  }

  function update(row: ReviewRow, patch: Partial<ReviewDecision>) {
    if (completed.includes(row.rowNumber)) return;
    setReport((previous) => previous && ({ ...previous, rows: previous.rows.map((r) => r.rowNumber === row.rowNumber ? { ...r, ...patch, approval: undefined } : r) }));
    setDirty(true);
  }

  const pending = report?.rows.filter(needsReview) ?? [];
  const visible = report?.rows.filter((row) => !onlyPending || needsReview(row)) ?? [];
  const position = Math.min(index, Math.max(0, visible.length - 1));
  const current = visible[position];
  const included = report?.rows.filter((row) => !row.skip).length ?? 0;

  function approve(row: ReviewRow) {
    if (dirty || row.errors.length) return;
    setReport((previous) => previous && ({ ...previous, rows: previous.rows.map((r) => r.rowNumber === row.rowNumber ? { ...r, approval: r.fingerprint } : r) }));
    if (!onlyPending) setIndex(Math.min(position + 1, visible.length - 1));
  }

  function downloadReview() {
    const url = URL.createObjectURL(new Blob([JSON.stringify({ source: file?.name ?? "엑셀 붙여넣기", options, columns: selectedColumns, report, completed }, null, 2)], { type: "application/json" }));
    const link = document.createElement("a"); link.href = url; link.download = "glossary-review.json"; link.click();
    URL.revokeObjectURL(url);
  }

  return <section className="space-y-5" aria-label="영문·한글 용어 가져오기">
    <div>
      <h2 className="text-lg font-semibold">가져올 열 선택</h2>
      <p className="mt-1 text-sm text-ink-2">한 행에 하나의 개념을 넣어 주세요. 여러 표기는 나누어 검색에 사용하며, 첫 표기를 대표로 보여줍니다. 약어·확장명 구분은 나중에 해도 됩니다.</p>
    </div>
    <fieldset disabled={busy || !!report} className="space-y-3 disabled:opacity-60">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <label className="flex items-center gap-1.5"><input type="checkbox" checked disabled />영문 (필수)</label>
        <label className="flex items-center gap-1.5"><input type="checkbox" checked disabled />한글 (필수)</label>
        {REVIEW_OPTIONAL_COLUMNS.map((column) => <label key={column.key} className="flex items-center gap-1.5">
          <input type="checkbox" checked={selectedColumns.includes(column.key)} onChange={(event) => {
            reset();
            setSelectedColumns((previous) => event.target.checked ? [...previous, column.key] : previous.filter((key) => key !== column.key));
          }} />{column.label}
        </label>)}
      </div>
      <p className="rounded border border-line bg-panel-2 px-3 py-2 text-sm" aria-live="polite">입력 열 순서: {columns.map((column, i) => `${i + 1}. ${column.label}`).join(" → ")}</p>
      <p className="text-xs text-ink-3">영문·한글 두 열은 항상 포함해 주세요. 한쪽 언어의 값은 비워둘 수 있습니다. 선택한 추가 열은 위 순서로 뒤에 붙이고, 값이 없으면 셀을 비워두세요.</p>
      <label className="block text-sm font-medium">xlsx 파일 (첫 행은 열 이름)
        <input ref={sourceInput} className="mt-2 block w-full text-sm" type="file" accept=".xlsx" onChange={(event) => {
          const next = event.target.files?.[0] ?? null; reset();
          if (next && (next.size > MAX_IMPORT_BYTES || !next.name.toLowerCase().endsWith(".xlsx"))) {
            setError("10MB 이하의 xlsx 파일을 선택해 주세요."); setFile(null); event.target.value = ""; return;
          }
          setFile(next); if (next) setText("");
        }} />
      </label>
      <label className="block text-sm font-medium">또는 엑셀에서 복사해 붙여넣기
        <textarea className="mt-2 min-h-28 w-full rounded border border-line bg-panel p-3 font-mono text-sm" value={text}
          placeholder={`${columns.map((column) => column.label).join("\t")}\n${columns.map((column) => column.example).join("\t")}`}
          onChange={(event) => { reset(); setText(event.target.value); setFile(null); if (sourceInput.current) sourceInput.current.value = ""; }} />
      </label>
      {!file && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={hasHeaders} onChange={(event) => { reset(); setHasHeaders(event.target.checked); }} />첫 행이 열 이름입니다 (영문·한글 헤더는 자동 인식)</label>}
      <div className="flex flex-wrap items-center gap-4 text-sm"><span>표기 구분자</span>
        {([["comma", "쉼표 ,"], ["semicolon", "세미콜론 ;"], ["newline", "셀 안 줄바꿈"]] as const).map(([key, label]) =>
          <label key={key} className="flex items-center gap-1.5"><input type="checkbox" checked={options[key]} onChange={(event) => { reset(); setOptions({ ...options, [key]: event.target.checked }); }} />{label}</label>)}
      </div>
      <p className="text-xs text-ink-3">괄호·따옴표 안 구분자는 유지합니다. 헤더가 없으면 위 열 순서대로 읽고, 헤더가 있으면 열 이름으로 연결합니다. 도메인은 쉼표·줄바꿈으로 구분하며, 한줄 정의·본문은 나누지 않습니다. 최대 5,000행.</p>
    </fieldset>
    {!report && <button type="button" className="btn-primary" disabled={busy || (!file && !text.trim())} onClick={() => void inspect()}>분리 결과 미리보기</button>}
    {busy && <p role="status" className="text-sm text-ink-2">{report ? "검사·저장 처리 중…" : "표기를 나누고 충돌을 검사하고 있습니다…"}</p>}
    {error && <p role="alert" className="note-danger">{error}</p>}
    {message && <p role="status" className="note-warn">{message}</p>}
    {report && <>
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span>전체 {report.rows.length + report.errors.length}행 · 검토 필요 {pending.length}행 · 등록 대상 {included}행</span>
        <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={downloadReview}>원본·검토 기록 내려받기</button>
        <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={reset}>입력부터 다시 시작</button>
      </div>
      {report.fileErrors.map((item, i) => <p key={i} className="note-danger">{item.message}</p>)}
      {report.ignoredHeaders.length > 0 && <p className="note-warn">가져오지 않는 열: {report.ignoredHeaders.join(", ")}</p>}
      {report.errors.length > 0 && <details className="note-warn"><summary>가져올 수 없는 {report.errors.length}행 (등록에서 제외)</summary>
        {report.errors.map((item) => <p key={item.rowNumber}>{item.rowNumber}행: {item.message}</p>)}
      </details>}
      {!finished && <fieldset disabled={busy || uncertain} className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={onlyPending} onChange={(event) => { setOnlyPending(event.target.checked); setIndex(0); }} />검토 필요한 행만</label>
          <button className="btn-quiet btn-sm" type="button" disabled={position === 0} onClick={() => setIndex(position - 1)}>이전</button>
          <span className="text-sm tabular-nums">{visible.length ? position + 1 : 0} / {visible.length}</span>
          <button className="btn-quiet btn-sm" type="button" disabled={position >= visible.length - 1} onClick={() => setIndex(position + 1)}>다음</button>
          <label className="text-sm">행 찾기 <input aria-label="원본 행 번호로 이동" type="number" min={1} className="w-20 rounded border border-line bg-panel px-2 py-1" onChange={(event) => {
            const target = visible.findIndex((row) => row.rowNumber === Number(event.target.value)); if (target >= 0) setIndex(target);
          }} /></label>
        </div>
        {current ? <article className="card space-y-4 p-4" aria-label={`${current.rowNumber}행 검토`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h3 className="font-semibold">원본 {current.rowNumber}행 {completed.includes(current.rowNumber) ? "· 등록 완료" : current.skip ? "· 건너뜀" : current.approval === current.fingerprint ? "· 승인됨" : current.reasons.length ? "· 검토 필요" : "· 등록 가능"}</h3>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={completed.includes(current.rowNumber)} checked={current.skip} onChange={(event) => update(current, { skip: event.target.checked })} />이 행 건너뛰기</label>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><p className="text-xs text-ink-3">원본 영문</p><p className="whitespace-pre-wrap break-words text-sm">{current.originalEn || "—"}</p></div>
            <div><p className="text-xs text-ink-3">원본 한글</p><p className="whitespace-pre-wrap break-words text-sm">{current.originalKo || "—"}</p></div>
          </div>
          {current.reasons.length > 0 && <ul className="note-warn list-inside list-disc text-sm">{current.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>}
          {current.errors.length > 0 && <ul className="note-danger list-inside list-disc text-sm">{current.errors.map((reason, i) => <li key={i}>{reason}</li>)}</ul>}
          <p className="text-xs text-ink-2">한 줄에 표기 하나씩 입력하세요. 첫 줄이 대표 표기입니다. 분리가 잘못됐다면 한 줄로 합치거나 새 줄로 나누고, 대표로 쓸 표기를 첫 줄로 옮겨 주세요.</p>
          <div className="grid gap-3 sm:grid-cols-2">
            {(["en", "ko"] as const).map((lang) => <label key={lang} className="text-sm font-medium">{lang === "en" ? "영문 표기" : "한글 표기"}
              <textarea disabled={current.skip || completed.includes(current.rowNumber)} className="mt-2 min-h-28 w-full rounded border border-line bg-panel p-2 text-sm" value={current[lang].join("\n")}
                onChange={(event) => update(current, { [lang]: event.target.value.split("\n") })} />
            </label>)}
          </div>
          {selectedColumns.length > 0 && <dl className="space-y-3 rounded border border-line bg-panel-2 p-3 text-sm">
            {REVIEW_OPTIONAL_COLUMNS.filter((column) => selectedColumns.includes(column.key)).map((column) => <div key={column.key}>
              <dt className="text-xs text-ink-3">{column.label}</dt>
              <dd className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-words">{column.key === "domain" ? current.domain?.join(", ") || "—" : current[column.key] || "—"}</dd>
            </div>)}
          </dl>}
          <button type="button" className="btn-primary" disabled={dirty || current.skip || current.errors.length > 0} onClick={() => approve(current)}>이 행 승인하고 다음</button>
        </article> : <p className="text-sm text-ink-2">검토할 행이 없습니다. 전체 행을 보려면 필터를 해제하세요.</p>}
        <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
          {dirty && <button type="button" className="btn-primary" onClick={() => void inspect()}>수정 결과 다시 검사</button>}
          <button type="button" className="btn-primary" disabled={dirty || pending.length > 0 || included === 0 || report.fileErrors.length > 0} onClick={() => void inspect(true)}>{included}개 용어 등록하기</button>
          <p className="text-xs text-ink-2">{dirty ? "수정 후 다시 검사하면 행별 승인을 할 수 있습니다." : "애매한 행은 각각 승인하거나 건너뛰어야 등록할 수 있습니다."}</p>
        </div>
      </fieldset>}
    </>}
  </section>;
}
