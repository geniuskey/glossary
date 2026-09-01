"use client";

import { useState } from "react";
import type { ManagedBusinessCategory } from "@/lib/terms/categories";
import { cx } from "@/lib/ui/format";

type Message = { kind: "ok" | "bad"; text: string } | null;

async function errorMessage(response: Response, fallback: string): Promise<string> {
  const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
  return body?.error?.message ?? `${fallback} (${response.status})`;
}

export function CategoriesPanel({ initialCategories }: { initialCategories: ManagedBusinessCategory[] }) {
  const [categories, setCategories] = useState(initialCategories);
  const [newLabel, setNewLabel] = useState("");
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<Message>(null);

  async function addCategory(event: React.FormEvent) {
    event.preventDefault();
    const label = newLabel.trim();
    if (!label || busyKey) return;
    setBusyKey("__new__");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/categories", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "업무 분류를 추가하지 못했습니다"));
      const body = await response.json() as { category: ManagedBusinessCategory };
      setCategories((current) => [...current, body.category]);
      setNewLabel("");
      setMessage({ kind: "ok", text: `‘${body.category.label}’ 업무 분류를 추가했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "업무 분류를 추가하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  function editLabel(key: string, label: string) {
    setCategories((current) => current.map((category) => category.key === key ? { ...category, label } : category));
    setMessage(null);
  }

  async function saveLabel(category: ManagedBusinessCategory) {
    const label = category.label.trim();
    if (!label || busyKey) return;
    setBusyKey(category.key);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/categories/${encodeURIComponent(category.key)}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ label }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "이름을 저장하지 못했습니다"));
      editLabel(category.key, label);
      setMessage({ kind: "ok", text: "업무 분류 이름을 저장했습니다. 기존 용어에도 바로 반영됩니다." });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "이름을 저장하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  async function move(index: number, offset: -1 | 1) {
    const destination = index + offset;
    if (destination < 0 || destination >= categories.length || busyKey) return;
    const previous = categories;
    const reordered = [...categories];
    [reordered[index], reordered[destination]] = [reordered[destination]!, reordered[index]!];
    setCategories(reordered.map((category, sortOrder) => ({ ...category, sortOrder })));
    setBusyKey("__order__");
    setMessage(null);
    try {
      const response = await fetch("/api/v1/admin/categories", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ keys: reordered.map((category) => category.key) }),
      });
      if (!response.ok) throw new Error(await errorMessage(response, "순서를 저장하지 못했습니다"));
      setMessage({ kind: "ok", text: "업무 분류 순서를 저장했습니다." });
    } catch (error) {
      setCategories(previous);
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "순서를 저장하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  async function remove(category: ManagedBusinessCategory) {
    if (category.usageCount > 0 || busyKey) return;
    if (!window.confirm(`‘${category.label}’ 업무 분류를 삭제할까요?`)) return;
    setBusyKey(category.key);
    setMessage(null);
    try {
      const response = await fetch(`/api/v1/admin/categories/${encodeURIComponent(category.key)}`, { method: "DELETE" });
      if (!response.ok) throw new Error(await errorMessage(response, "업무 분류를 삭제하지 못했습니다"));
      setCategories((current) => current.filter((item) => item.key !== category.key));
      setMessage({ kind: "ok", text: `‘${category.label}’ 업무 분류를 삭제했습니다.` });
    } catch (error) {
      setMessage({ kind: "bad", text: error instanceof Error ? error.message : "업무 분류를 삭제하지 못했습니다." });
    } finally {
      setBusyKey(null);
    }
  }

  return (
    <section aria-labelledby="categories-heading">
      <div className="mb-3">
        <h2 id="categories-heading" className="text-base font-semibold text-ink">업무 분류</h2>
        <p className="mt-1 text-xs leading-5 text-ink-3">조직에 맞는 목록을 추가하고 이름과 표시 순서를 관리합니다. 내부 키는 공유 URL의 호환성을 위해 유지됩니다.</p>
      </div>

      <div className="card overflow-hidden">
        <form onSubmit={(event) => void addCategory(event)} className="flex flex-col gap-2 border-b border-line bg-panel-2/50 p-4 sm:flex-row sm:items-end">
          <label className="min-w-0 flex-1">
            <span className="label">새 업무 분류</span>
            <input value={newLabel} onChange={(event) => setNewLabel(event.target.value)} maxLength={60} disabled={Boolean(busyKey)} placeholder="예: 보안" className="field h-9 py-0" />
          </label>
          <button type="submit" disabled={!newLabel.trim() || Boolean(busyKey)} className="btn-primary btn-sm h-9">추가</button>
        </form>

        <ol className="divide-y divide-line">
          {categories.map((category, index) => (
            <li key={category.key} className="grid gap-3 px-4 py-3 sm:grid-cols-[auto_minmax(12rem,1fr)_minmax(8rem,0.6fr)_auto] sm:items-center">
              <span className="w-6 text-center font-mono text-xs tabular-nums text-ink-3">{index + 1}</span>
              <label className="min-w-0">
                <span className="sr-only">{category.key} 표시 이름</span>
                <input value={category.label} onChange={(event) => editLabel(category.key, event.target.value)} maxLength={60} disabled={Boolean(busyKey)} className="field h-9 py-0" />
              </label>
              <div className="min-w-0 text-xs text-ink-3">
                <code className="block truncate" title={category.key}>{category.key}</code>
                <span>사용 중 {category.usageCount.toLocaleString("ko-KR")}개</span>
              </div>
              <div className="flex flex-wrap justify-end gap-1">
                <button type="button" onClick={() => void move(index, -1)} disabled={index === 0 || Boolean(busyKey)} className="btn-quiet btn-sm" aria-label={`${category.label} 위로 이동`}>↑</button>
                <button type="button" onClick={() => void move(index, 1)} disabled={index === categories.length - 1 || Boolean(busyKey)} className="btn-quiet btn-sm" aria-label={`${category.label} 아래로 이동`}>↓</button>
                <button type="button" onClick={() => void saveLabel(category)} disabled={!category.label.trim() || Boolean(busyKey)} className="btn-ghost btn-sm">저장</button>
                <button type="button" onClick={() => void remove(category)} disabled={category.usageCount > 0 || Boolean(busyKey)} title={category.usageCount > 0 ? "사용 중인 분류는 삭제할 수 없습니다." : undefined} className="btn-quiet btn-sm text-danger">삭제</button>
              </div>
            </li>
          ))}
        </ol>
        {categories.length === 0 && <p className="px-4 py-10 text-center text-sm text-ink-3">등록된 업무 분류가 없습니다.</p>}
      </div>
      {message && <p role={message.kind === "bad" ? "alert" : "status"} className={cx("mt-3", message.kind === "bad" ? "note-danger" : "note-ok")}>{message.text}</p>}
    </section>
  );
}
