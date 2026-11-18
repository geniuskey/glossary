import type { ReactNode } from "react";
import { cx } from "@/lib/ui/format";

/**
 * 관리자 탭 공통 머리말. 탭마다 제목 크기(text-base/lg/2xl)와 설명 크기가 제각각이라
 * 탭을 오갈 때 화면이 흔들려 보였다. 머리말은 이 컴포넌트 하나로만 그린다.
 */
export function AdminPanelHeader({
  id,
  title,
  description,
  help,
  status,
  actions,
}: {
  id: string;
  title: string;
  description?: ReactNode;
  help?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="mb-6 flex flex-wrap items-start gap-3">
      <div className="mr-auto min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h2 id={id} className="text-lg font-semibold tracking-tight text-ink text-balance">{title}</h2>
          {help}
          {status}
        </div>
        {description && <div className="mt-1.5 max-w-3xl text-sm leading-6 text-ink-2">{description}</div>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

export type AdminTone = "ok" | "warn" | "danger" | "neutral";

export function StatusBadge({ tone, children }: { tone: AdminTone; children: ReactNode }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        tone === "ok" && "border-ok/35 bg-ok-soft text-ok",
        tone === "warn" && "border-warn/35 bg-warn-soft text-warn",
        tone === "danger" && "border-danger/35 bg-danger-soft text-danger",
        tone === "neutral" && "border-line bg-panel-2 text-ink-3",
      )}
    >
      <span
        className={cx(
          "h-1.5 w-1.5 rounded-full",
          tone === "ok" && "bg-ok",
          tone === "warn" && "bg-warn",
          tone === "danger" && "bg-danger",
          tone === "neutral" && "bg-ink-3",
        )}
        aria-hidden="true"
      />
      {children}
    </span>
  );
}

export type AdminMessage = { kind: "ok" | "bad"; text: string } | null;

/**
 * 설정형 탭(홈·대표 색·메뉴·AI·검색 인프라)의 저장 바. 화면 아래에 붙어 있어
 * 긴 폼 중간에서도 변경 여부와 저장 버튼이 보인다. 결과 메시지도 여기에만 띄워
 * "저장 결과가 어디 나왔는지" 탭마다 찾지 않게 한다.
 */
export function AdminSaveBar({
  dirty,
  saving,
  canSave = true,
  blockedReason,
  dirtyText = "저장하지 않은 변경사항이 있습니다",
  message,
  saveLabel,
  onSave,
  onReset,
  children,
}: {
  dirty: boolean;
  saving: boolean;
  canSave?: boolean;
  blockedReason?: string;
  dirtyText?: string;
  message?: AdminMessage;
  saveLabel: string;
  onSave: () => void;
  onReset?: () => void;
  children?: ReactNode;
}) {
  const statusText = message?.text
    ?? (dirty ? (canSave ? dirtyText : blockedReason ?? "입력값을 확인해 주세요") : "저장된 설정과 같습니다");
  return (
    <div className="sticky bottom-0 z-20 -mx-1 mt-6 rounded-t-xl border border-b-0 border-line bg-panel/95 px-4 py-3 shadow-[0_-6px_16px_-12px_rgba(0,0,0,0.35)] backdrop-blur">
      <div className="flex flex-wrap items-center justify-end gap-2">
        <p
          role={message?.kind === "bad" ? "alert" : "status"}
          className={cx(
            "mr-auto flex min-w-0 items-center gap-2 text-xs",
            message?.kind === "bad" ? "text-danger" : message?.kind === "ok" ? "text-ok" : dirty ? "text-warn" : "text-ink-3",
          )}
        >
          {!message && dirty && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />}
          <span className="min-w-0">{statusText}</span>
        </p>
        {children}
        {onReset && (
          <button type="button" className="btn-quiet btn-sm" disabled={saving || !dirty} onClick={onReset}>되돌리기</button>
        )}
        <button type="button" className="btn-primary btn-sm" disabled={saving || !dirty || !canSave} onClick={onSave}>
          {saving ? "저장 중…" : saveLabel}
        </button>
      </div>
    </div>
  );
}

/** 화면 어디서 실행했든 결과가 보이도록 화면 아래 고정 위치에 띄우는 알림. */
export function AdminToast({ message, onClose }: { message: AdminMessage; onClose: () => void }) {
  if (!message) return null;
  return (
    <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[80] flex justify-center sm:inset-x-auto sm:right-6">
      <div
        role={message.kind === "bad" ? "alert" : "status"}
        className={cx(
          "pointer-events-auto flex max-w-md items-start gap-3 rounded-xl border px-4 py-3 text-sm shadow-lg",
          message.kind === "bad" ? "border-danger/35 bg-danger-soft text-danger" : "border-ok/35 bg-ok-soft text-ok",
        )}
      >
        <span className="min-w-0 flex-1 leading-6">{message.text}</span>
        <button type="button" onClick={onClose} className="-mr-1 grid h-6 w-6 shrink-0 place-items-center rounded text-base leading-none opacity-70 hover:opacity-100" aria-label="알림 닫기">×</button>
      </div>
    </div>
  );
}
