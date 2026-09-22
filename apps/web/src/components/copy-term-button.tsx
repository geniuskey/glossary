"use client";

import { useState } from "react";

export function CopyTermButton({ text }: { text: string }) {
  const [message, setMessage] = useState("");
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setMessage("복사했습니다");
    } catch {
      setMessage("복사하지 못했습니다. 용어명을 선택해 복사해 주세요.");
    }
  }
  return <div className="flex flex-wrap items-center gap-2">
    <button type="button" onClick={copy} className="btn-quiet btn-sm" aria-label="대표 표기 복사">
      <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden><rect x="5" y="5" width="8" height="9" rx="1.5" /><path d="M10 3V2H2v9h1" strokeLinecap="round" strokeLinejoin="round" /></svg>
      표기 복사
    </button>
    <span role="status" className="text-xs text-ink-2">{message}</span>
  </div>;
}
