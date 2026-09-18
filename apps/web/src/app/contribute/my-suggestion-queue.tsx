"use client";

import Link from "next/link";
import { useState } from "react";

type Task = {
  id: string;
  termId: string;
  revision: number;
  feature: string;
  suggestionId: string;
  reason: string;
  payload: { title?: string; field?: string; value?: unknown; reason?: string; href?: string };
  termSlug: string;
  termName: string;
  updatedAt: string;
};

function valueText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string").join(" · ");
  if (value && typeof value === "object") return JSON.stringify(value);
  return "값을 확인해 주세요.";
}

function featureLabel(feature: string): string {
  return ({ agent: "제안 검토", identity: "표기 정비", definition: "한줄 정의", classification: "분류 추천", duplicate: "중복 후보" } as Record<string, string>)[feature] ?? "AI 제안";
}

function reviewHref(task: Task): string {
  if (task.payload.href) return task.payload.href;
  if (task.feature === "agent") return `/contribute?tab=agent&termId=${encodeURIComponent(task.termId)}`;
  if (task.feature === "identity") return `/contribute/fields?field=identity&q=${encodeURIComponent(task.termSlug)}`;
  if (task.feature === "definition") return "/contribute/fields?field=definition";
  if (task.feature === "classification") return `/contribute/fields?field=${task.payload.field === "category" ? "category" : "domain"}`;
  return `/contribute?tab=duplicates&term=${encodeURIComponent(task.termSlug)}`;
}

export function MySuggestionQueue({ initialItems }: { initialItems: Task[] }) {
  const [items, setItems] = useState(initialItems);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function remove(task: Task): Promise<boolean> {
    setBusyId(task.id);
    setError(null);
    try {
      const response = await fetch("/api/v1/contributions/suggestion-dispositions", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decisionId: task.id }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
        throw new Error(body?.error?.message ?? "내 작업을 처리하지 못했습니다.");
      }
      setItems((current) => current.filter((item) => item.id !== task.id));
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "내 작업을 처리하지 못했습니다.");
      return false;
    } finally {
      setBusyId(null);
    }
  }

  async function open(task: Task): Promise<void> {
    if (!(await remove(task))) return;
    window.location.assign(reviewHref(task));
  }

  return (
    <section aria-label="내 AI 제안 작업" className="space-y-3">
      <header className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-lg font-semibold text-ink">내 작업</h2>
          <p className="mt-1 text-xs text-ink-3">나중에 확인하기로 저장한 AI 제안입니다. 검토를 시작하면 개인 작업 표시가 해제됩니다.</p>
        </div>
        <span className="font-mono text-xs tabular-nums text-ink-3">{items.length.toLocaleString("ko-KR")}개</span>
      </header>
      {error && <p role="alert" className="rounded-lg bg-danger-soft px-3 py-2 text-xs text-danger">{error}</p>}
      {items.length === 0 ? (
        <div className="card px-5 py-12 text-center">
          <p className="text-sm font-medium text-ink">저장한 작업이 없습니다.</p>
          <p className="mt-1 text-xs text-ink-3">AI 제안에서 ‘내 작업에 저장’을 누르면 여기에서 다시 볼 수 있습니다.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {items.map((task) => (
            <article key={task.id} className="card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="chip chip-on !py-0.5 !text-[11px]">{featureLabel(task.feature)}</span>
                    <Link href={`/edit/${task.termSlug}`} className="font-semibold text-ink hover:text-brand">{task.termName}</Link>
                    <span className="font-mono text-[11px] text-ink-3">리비전 {task.revision}</span>
                  </div>
                  <p className="mt-2 text-sm font-medium text-ink">{task.payload.title ?? "AI 제안"}: {valueText(task.payload.value)}</p>
                  {(task.payload.reason || task.reason) && <p className="mt-1 text-xs leading-5 text-ink-2">{task.payload.reason || task.reason}</p>}
                </div>
                <div className="flex shrink-0 gap-2">
                  <button type="button" className="btn-primary btn-sm" disabled={busyId !== null} onClick={() => void open(task)}>{busyId === task.id ? "여는 중…" : "검토하기"}</button>
                  <button type="button" className="btn-quiet btn-sm" disabled={busyId !== null} onClick={() => void remove(task)}>삭제</button>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
