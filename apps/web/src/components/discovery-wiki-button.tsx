"use client";

import Link from "next/link";
import { useState } from "react";
import type { DiscoveryWikiDraft } from "@/lib/discovery/ideas";

type State = { kind: "idle" } | { kind: "saving" } | { kind: "saved"; slug: string } | { kind: "failed"; message: string };

/** 가설을 위키 초안으로 남긴다. 초안은 공식 근거가 아니며, 실험 결과를 이어 적은 뒤 사람이 공개를 결정한다. */
export function DiscoveryWikiButton({ draft }: { draft: DiscoveryWikiDraft }) {
  const [state, setState] = useState<State>({ kind: "idle" });
  if (state.kind === "saved") {
    return <p className="mt-2 text-xs text-ink-2">위키 초안으로 저장했습니다. <Link href={`/w/${state.slug}`} className="text-brand underline">초안 열기</Link></p>;
  }
  const save = async () => {
    setState({ kind: "saving" });
    try {
      const response = await fetch("/api/v1/wiki", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(draft) });
      const body = await response.json().catch(() => null) as { page?: { slug?: string }; slug?: string; error?: { message?: string } } | null;
      const slug = body?.page?.slug ?? body?.slug;
      if (!response.ok || !slug) throw new Error(body?.error?.message ?? "위키 초안을 저장하지 못했습니다.");
      setState({ kind: "saved", slug });
    } catch (error) {
      setState({ kind: "failed", message: error instanceof Error ? error.message : "위키 초안을 저장하지 못했습니다." });
    }
  };
  return <div className="mt-2">
    <button type="button" onClick={save} disabled={state.kind === "saving"} className="rounded-md border border-line px-2 py-1 text-xs font-medium text-ink hover:bg-panel-2 disabled:opacity-60">
      {state.kind === "saving" ? "저장 중…" : "위키 초안으로 저장"}
    </button>
    {state.kind === "failed" && <p className="mt-1 text-xs text-danger" role="alert">{state.message}</p>}
  </div>;
}
