"use client";

import { useState } from "react";
import type { SyncImportReport } from "@/lib/sync/import";
import type { SyncStatus } from "@/lib/sync/status";
import { cx } from "@/lib/ui/format";

const DATE_TIME = new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium", timeStyle: "short" });
const ENTITY_LABEL = {
  terms: "용어",
  wikiPages: "위키",
  relations: "관계",
  domains: "도메인",
  businessCategories: "업무 분류",
} as const;
const ISSUE_LABEL = { conflicts: "충돌", overwritten: "덮어씀", kept: "남김", stale: "누락" } as const;

type Message = { kind: "ok" | "bad"; text: string } | null;

function formatBytes(bytes: number | null): string {
  if (bytes === null) return "-";
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${response.status})`;
}

export function SyncPanel({ initialStatus }: { initialStatus: SyncStatus }) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState<"full" | "incremental" | "preview" | "apply" | "forget" | null>(null);
  const [exportMessage, setExportMessage] = useState<Message>(null);
  const [importMessage, setImportMessage] = useState<Message>(null);
  const [base, setBase] = useState(initialStatus.exports[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [keepLocal, setKeepLocal] = useState(false);
  const [report, setReport] = useState<SyncImportReport | null>(null);

  async function refresh() {
    const response = await fetch("/api/v1/admin/sync", { cache: "no-store" });
    if (!response.ok) return;
    const next = await response.json() as SyncStatus;
    setStatus(next);
    setBase((current) => next.exports.some((item) => item.id === current) ? current : next.exports[0]?.id ?? "");
  }

  async function download(mode: "full" | "incremental") {
    if (busy) return;
    setBusy(mode);
    setExportMessage(null);
    try {
      const params = new URLSearchParams({ mode, ...(mode === "incremental" && base ? { base } : {}) });
      const response = await fetch(`/api/v1/admin/sync/export?${params}`, { cache: "no-store" });
      if (!response.ok) {
        setExportMessage({ kind: "bad", text: await errorMessage(response, "번들을 만들지 못했습니다") });
        return;
      }
      const blob = await response.blob();
      const filename = /filename="([^"]+)"/.exec(response.headers.get("content-disposition") ?? "")?.[1] ?? "glossary.glossary-sync.json.gz";
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      URL.revokeObjectURL(url);
      setExportMessage({ kind: "ok", text: `${filename} (${formatBytes(blob.size)})을 내려받았습니다. 받는 서버의 관리자 > 서버 동기화에서 가져오세요.` });
      await refresh();
    } catch {
      setExportMessage({ kind: "bad", text: "네트워크 오류로 번들을 내려받지 못했습니다." });
    } finally {
      setBusy(null);
    }
  }

  async function upload(apply: boolean) {
    if (busy || !file) return;
    setBusy(apply ? "apply" : "preview");
    setImportMessage(null);
    try {
      const params = new URLSearchParams({ dryRun: apply ? "false" : "true", localEdits: keepLocal ? "keep" : "source" });
      const response = await fetch(`/api/v1/admin/sync/import?${params}`, {
        method: "POST",
        headers: { "content-type": "application/gzip" },
        body: file,
      });
      if (!response.ok) {
        setReport(null);
        setImportMessage({ kind: "bad", text: await errorMessage(response, "번들을 가져오지 못했습니다") });
        return;
      }
      const body = await response.json() as { report: SyncImportReport };
      setReport(body.report);
      if (apply) {
        setImportMessage({ kind: "ok", text: "번들을 반영했습니다. 검색 색인은 작업자가 이어서 갱신합니다." });
        setFile(null);
        await refresh();
      }
    } catch {
      setImportMessage({ kind: "bad", text: "네트워크 오류로 번들을 가져오지 못했습니다." });
    } finally {
      setBusy(null);
    }
  }

  async function forget(instanceId: string, label: string) {
    if (busy) return;
    if (!window.confirm(`${label} 서버와의 동기화 연결을 해제할까요? 이미 들어온 데이터는 남고, 이후 이 서버의 데이터로 취급됩니다.`)) return;
    setBusy("forget");
    try {
      const response = await fetch(`/api/v1/admin/sync?source=${instanceId}`, { method: "DELETE" });
      if (!response.ok) setImportMessage({ kind: "bad", text: await errorMessage(response, "연결을 해제하지 못했습니다") });
      await refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="grid gap-8">
      <header>
        <h2 className="text-lg font-semibold tracking-tight text-ink">서버 동기화</h2>
        <p className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-2">
          네트워크로 연결되지 않은 두 서버 사이에서 용어·표기·분류·승인된 관계·위키·이미지를 파일로 옮깁니다.
          보내는 서버에서 번들을 내보내고, 받는 서버에서 같은 번들을 가져오면 추가·수정·삭제가 한 번에 반영됩니다.
          같은 번들을 여러 번 가져와도 결과는 같습니다.
        </p>
        <p className="mt-2 text-xs text-ink-3">
          이 서버: <span className="font-medium text-ink-2">{status.label}</span>{" "}
          <code className="font-mono">{status.instanceId}</code>
        </p>
      </header>

      <section className="card p-5 sm:p-6" aria-labelledby="sync-export-heading">
        <h3 id="sync-export-heading" className="text-sm font-semibold text-ink">내보내기 (보내는 서버)</h3>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          처음에는 전체 번들을, 이후에는 변경분 번들을 보내면 됩니다. 변경분을 하나 빠뜨려도 받는 서버가 누락을 알려 주고,
          그때 전체 번들을 한 번 보내면 다시 맞춰집니다. 사용자 계정, 담당자, AI 설정은 포함하지 않습니다.
        </p>
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <button type="button" className="btn-primary btn-sm" disabled={busy !== null} onClick={() => void download("full")}>
            {busy === "full" ? "번들 준비 중…" : "전체 번들 내보내기"}
          </button>
          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 text-xs text-ink-3">
              변경분 기준
              <select className="field py-1.5 text-xs" value={base} onChange={(event) => setBase(event.target.value)} disabled={status.exports.length === 0}>
                {status.exports.length === 0 && <option value="">이전 내보내기 없음</option>}
                {status.exports.map((item) => (
                  <option key={item.id} value={item.id}>
                    {DATE_TIME.format(new Date(item.createdAt))} · {item.mode === "full" ? "전체" : "변경분"}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn-ghost btn-sm" disabled={busy !== null || status.exports.length === 0} onClick={() => void download("incremental")}>
              {busy === "incremental" ? "번들 준비 중…" : "변경분 내보내기"}
            </button>
          </div>
        </div>
        {exportMessage && (
          <p role={exportMessage.kind === "bad" ? "alert" : "status"} className={cx("mt-3", exportMessage.kind === "bad" ? "note-danger" : "note-ok")}>
            {exportMessage.text}
          </p>
        )}
        {status.exports.length > 0 && (
          <div className="mt-5 overflow-x-auto">
            <table className="w-full min-w-[560px] border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-line text-ink-3">
                  <th scope="col" className="py-2 pr-3 font-medium">내보낸 시각</th>
                  <th scope="col" className="px-3 py-2 font-medium">종류</th>
                  <th scope="col" className="px-3 py-2 font-medium">용어</th>
                  <th scope="col" className="px-3 py-2 font-medium">위키</th>
                  <th scope="col" className="px-3 py-2 font-medium">이미지</th>
                  <th scope="col" className="px-3 py-2 font-medium">크기</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line text-ink-2">
                {status.exports.map((item) => (
                  <tr key={item.id}>
                    <td className="whitespace-nowrap py-2 pr-3" title={item.id}>{DATE_TIME.format(new Date(item.createdAt))}</td>
                    <td className="px-3 py-2"><span className="chip">{item.mode === "full" ? "전체" : "변경분"}</span></td>
                    <td className="px-3 py-2 font-mono tabular-nums">{item.counts.terms ?? 0}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{item.counts.wikiPages ?? 0}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{item.counts.attachments ?? 0}</td>
                    <td className="px-3 py-2 font-mono tabular-nums">{formatBytes(item.byteSize)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card p-5 sm:p-6" aria-labelledby="sync-import-heading">
        <h3 id="sync-import-heading" className="text-sm font-semibold text-ink">가져오기 (받는 서버)</h3>
        <p className="mt-2 text-sm leading-6 text-ink-2">
          번들은 내보낸 순서대로 가져옵니다. 이미 반영한 것보다 오래된 번들은 최신 내용을 되돌리므로 거부됩니다.
          이 서버에서 직접 만든 용어·문서는 출처 삭제에 영향을 받지 않습니다.
        </p>
        <div className="mt-4 grid gap-3">
          <label className="grid max-w-xl gap-1 text-xs text-ink-3">
            번들 파일
            <input
              type="file"
              accept=".gz,.json,application/gzip,application/json"
              className="field py-1.5 text-xs"
              onChange={(event) => { setFile(event.target.files?.[0] ?? null); setReport(null); setImportMessage(null); }}
            />
          </label>
          <label className="flex items-start gap-2 text-sm text-ink-2">
            <input type="checkbox" className="mt-1" checked={keepLocal} onChange={(event) => { setKeepLocal(event.target.checked); setReport(null); }} />
            <span>
              이 서버에서 고친 항목은 덮지 않음
              <span className="block text-xs text-ink-3">
                끄면 양쪽에서 모두 바뀐 항목은 출처 내용으로 덮습니다(이력에 남아 되돌릴 수 있음). 출처가 그대로인 항목은 어느 쪽이든 건드리지 않습니다.
              </span>
            </span>
          </label>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn-ghost btn-sm" disabled={!file || busy !== null} onClick={() => void upload(false)}>
              {busy === "preview" ? "계산 중…" : "미리보기"}
            </button>
            <button type="button" className="btn-primary btn-sm" disabled={!file || !report || report.localEdits !== (keepLocal ? "keep" : "source") || busy !== null} onClick={() => void upload(true)}>
              {busy === "apply" ? "반영 중…" : "반영"}
            </button>
          </div>
          {!report && file && <p className="text-xs text-ink-3">미리보기로 결과를 확인한 뒤 반영할 수 있습니다.</p>}
        </div>
        {importMessage && (
          <p role={importMessage.kind === "bad" ? "alert" : "status"} className={cx("mt-3", importMessage.kind === "bad" ? "note-danger" : "note-ok")}>
            {importMessage.text}
          </p>
        )}
        {report && <SyncReportView report={report} />}
      </section>

      <section aria-labelledby="sync-sources-heading">
        <h3 id="sync-sources-heading" className="mb-3 text-sm font-semibold text-ink">가져온 출처 서버</h3>
        {status.sources.length === 0 ? (
          <p className="text-sm text-ink-3">아직 가져온 번들이 없습니다.</p>
        ) : (
          <div className="grid gap-3">
            {status.sources.map((source) => (
              <div key={source.instanceId} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0 text-sm">
                  <p className="font-medium text-ink">{source.label}</p>
                  <p className="mt-1 text-xs text-ink-3">
                    마지막 번들 {DATE_TIME.format(new Date(source.lastExportedAt))} · 반영 {DATE_TIME.format(new Date(source.lastImportedAt))} · 추적 {source.trackedCount}건
                  </p>
                  {source.lastReport && source.lastReport.issueTotals.stale > 0 && (
                    <p className="note-warn mt-2 text-xs">누락 {source.lastReport.issueTotals.stale}건 — 보내는 서버에서 전체 번들을 한 번 내보내 가져오세요.</p>
                  )}
                </div>
                <button type="button" className="btn-quiet btn-sm self-start sm:self-center" disabled={busy !== null} onClick={() => void forget(source.instanceId, source.label)}>
                  연결 해제
                </button>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function SyncReportView({ report }: { report: SyncImportReport }) {
  const issueKinds = (Object.keys(ISSUE_LABEL) as (keyof typeof ISSUE_LABEL)[]).filter((kind) => report.issueTotals[kind] > 0);
  return (
    <div className="mt-5 grid gap-4">
      <p className="text-xs text-ink-3">
        {report.dryRun ? "미리보기 — 아직 반영하지 않았습니다." : "반영 완료."} {report.source.label} ·{" "}
        {report.mode === "full" ? "전체" : "변경분"} · {DATE_TIME.format(new Date(report.exportedAt))}
        {report.alreadyApplied && " · 이미 반영한 번들입니다"}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[480px] border-collapse text-left text-xs">
          <thead>
            <tr className="border-b border-line text-ink-3">
              <th scope="col" className="py-2 pr-3 font-medium">항목</th>
              <th scope="col" className="px-3 py-2 font-medium">추가</th>
              <th scope="col" className="px-3 py-2 font-medium">수정</th>
              <th scope="col" className="px-3 py-2 font-medium">삭제</th>
              <th scope="col" className="px-3 py-2 font-medium">변경 없음</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line font-mono tabular-nums text-ink-2">
            {(Object.keys(ENTITY_LABEL) as (keyof typeof ENTITY_LABEL)[]).map((key) => (
              <tr key={key}>
                <th scope="row" className="py-2 pr-3 font-sans font-normal text-ink">{ENTITY_LABEL[key]}</th>
                <td className="px-3 py-2">{report.counts[key].created}</td>
                <td className="px-3 py-2">{report.counts[key].updated}</td>
                <td className="px-3 py-2">{report.counts[key].deleted}</td>
                <td className="px-3 py-2">{report.counts[key].unchanged}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-ink-3">새 이미지 {report.attachmentsAdded}개</p>
      {issueKinds.map((kind) => (
        <details key={kind} className={cx(kind === "conflicts" || kind === "stale" ? "note-warn" : "note")} open={kind === "stale"}>
          <summary className="cursor-pointer text-sm font-medium">
            {ISSUE_LABEL[kind]} {report.issueTotals[kind]}건
          </summary>
          <ul className="mt-2 grid gap-1 text-xs">
            {report[kind].map((item) => (
              <li key={`${item.type}:${item.id}`}><span className="font-medium">{item.label}</span> — {item.reason}</li>
            ))}
            {report.issueTotals[kind] > report[kind].length && <li>외 {report.issueTotals[kind] - report[kind].length}건</li>}
          </ul>
        </details>
      ))}
    </div>
  );
}
