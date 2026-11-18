"use client";

import { useState } from "react";

export function DataExportPanel() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  async function downloadSnapshot() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/exports/terms", { cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        setMessage(body?.error?.message ?? `스냅샷을 내려받지 못했습니다 (${response.status}).`);
        return;
      }

      const blob = await response.blob();
      const disposition = response.headers.get("content-disposition");
      const filename = /filename="([^"]+)"/.exec(disposition ?? "")?.[1]
        ?? `glossary-snapshot-${new Date().toISOString().slice(0, 10)}.json`;
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.click();
      // click() 직후 바로 해제하면 일부 브라우저(Safari·Firefox)는 내려받기를 시작하기
      // 전에 URL이 사라져 빈 파일이나 실패로 끝난다.
      window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
      setMessage("전체 용어집 스냅샷을 내려받았습니다.");
    } catch {
      setMessage("네트워크 오류로 스냅샷을 내려받지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card p-5 sm:p-6" aria-labelledby="data-export-heading">
      <div>
        <h3 id="data-export-heading" className="text-sm font-semibold text-ink">백업 스냅샷</h3>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">
          서버에 저장된 전체 용어와 추가 표기, 분류, 의미 관계를 읽기 전용 JSON으로 내려받습니다.
          현재 화면의 페이지만 내보내는 <code className="font-mono text-xs">/sheet</code> CSV와 달리 전체 데이터를 포함하며,
          사용자 인증 정보나 AI 연결 비밀값은 포함하지 않습니다.
        </p>
        <p className="note-warn mt-4" role="note">
          이 파일은 백업·검토용 형식이며 가져오기에서 그대로 반영할 수 없습니다. 다른 서버로 데이터를 옮기려면 아래 서버 동기화 번들을 사용하세요.
        </p>
        <button type="button" onClick={() => void downloadSnapshot()} disabled={busy} className="btn-primary btn-sm mt-5">
          {busy ? "스냅샷 준비 중…" : "전체 용어집 스냅샷 다운로드"}
        </button>
        {message && <p className="mt-3 text-xs text-ink-2" role="status">{message}</p>}
      </div>
    </section>
  );
}
