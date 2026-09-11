"use client";

import Link from "next/link";
import { EDIT_FIELD_LABELS, editValueText, type ChatEditProposal, type ChatEditPatch } from "@/lib/ai/chat-edit-values";

export function ChatEditCard({ edit, busy, processing, error, onAction }: {
  edit: ChatEditProposal; busy: boolean; processing?: boolean; error?: string;
  onAction: (action: "apply" | "cancel") => void;
}) {
  return <section className="mt-3 rounded-xl border border-brand/30 bg-brand-soft/30 p-3 text-ink" aria-label={`${edit.title} 수정안`}>
    <div className="flex flex-wrap items-center gap-2">
      <Link href={`/w/${edit.slug}`} className="font-semibold text-brand underline underline-offset-4">{edit.title}</Link>
      <span className="text-xs text-ink-3">{edit.status === "applied" ? "적용 완료" : edit.status === "cancelled" ? "취소됨" : "수정안 · 확인 필요"}</span>
    </div>
    <p className="mt-2 text-xs text-ink-2">{edit.reason}</p>
    <p className="mt-1 text-xs text-ink-3">기준 리비전 {edit.expectedRevision} · 사용자 요청을 반영한 제안</p>
    <div className="mt-3 space-y-3">
      {(Object.keys(edit.patch) as Array<keyof ChatEditPatch>).map((field) => <details key={field} open className="rounded-lg border border-line bg-panel p-2">
        <summary className="cursor-pointer text-xs font-semibold">{EDIT_FIELD_LABELS[field]}</summary>
        <div className="mt-2 grid gap-2 lg:grid-cols-2">
          <div className="min-w-0"><p className="text-xs text-ink-3">변경 전</p><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs">{editValueText(edit.before[field])}</pre></div>
          <div className="min-w-0"><p className="text-xs font-semibold text-brand">변경 후</p><pre className="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-sans text-xs">{editValueText(edit.patch[field])}</pre></div>
        </div>
      </details>)}
    </div>
    {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
    {processing && <p role="status" className="mt-2 text-xs text-ink-3">수정안을 처리하는 중…</p>}
    {edit.status === "pending" ? <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
      <p className="mr-auto text-xs text-ink-3">고칠 내용은 대화로 알려주세요.</p>
      <button type="button" className="btn-quiet btn-sm" disabled={busy} onClick={() => onAction("cancel")}>수정안 취소</button>
      <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => onAction("apply")}>수정 적용</button>
    </div> : edit.status === "applied" && <p className="mt-3 text-xs" role="status">리비전 {edit.appliedRevision}에 저장했습니다. <Link className="text-brand underline" href={`/history/${edit.slug}`}>변경 이력 보기</Link></p>}
  </section>;
}
